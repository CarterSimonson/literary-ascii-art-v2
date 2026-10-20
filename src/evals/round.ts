import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import sharp from "sharp";
import { parse, stringify } from "yaml";
import { z } from "zod";

import packageJson from "../../package.json";
import { slugSchema } from "../ideas/schema.ts";
import { generateCandidate } from "../images/candidate.ts";
import type { ImageGenerator } from "../images/codex.ts";
import { fillImagePrompt, type ImagePromptBook } from "../images/prompt.ts";
import { imagesRequestSchema, type ImagesRequest } from "../images/schema.ts";
import { resolveOutputTarget } from "../output-targets.ts";
import type { SourceImage } from "../render/convert.ts";
import { measureImage } from "./metrics.ts";
import { prepareBookGlyphs, renderPreview, type BookGlyphs } from "./render.ts";
import { loadSuite, type Suite, type SuiteCase } from "./suite.ts";

export const PRIMARY_TARGET_ID = "poster-24x36";
const IMAGE_SIZE = "1024x1536";
const ALPHA_THRESHOLD = 128;
const PROMPT_SUFFIX = ".prompt.md";

export interface RunRoundArgs {
  roundId: string;
  outputRoot: string;
  // Required when creating a round; a round's prompts never change afterwards.
  promptsDirectory?: string;
  suiteDirectory?: string;
  registryPath?: string;
  targetRegistry?: string;
  concurrency: number;
  timeoutSeconds: number;
  // Image keys (`<prompt>/<book>/<idea>`) to regenerate even if done.
  retry?: string[];
  generate?: ImageGenerator;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface RoundSummary {
  directory: string;
  done: number;
  failed: number;
  skipped: number;
}

export interface RoundPrompt {
  id: string;
  file: string;
  sha256: string;
}

const roundFileSchema = z.looseObject({
  schema_version: z.literal(1),
  round_id: slugSchema,
  suite: z.looseObject({ sha256: z.string() }),
  prompts: z.array(
    z.strictObject({ id: slugSchema, file: z.string(), sha256: z.string() }),
  ),
  cases: z.array(
    z.strictObject({
      book: slugSchema,
      book_title: z.string(),
      idea: slugSchema,
      name: z.string(),
    }),
  ),
});

export type RoundFile = z.infer<typeof roundFileSchema>;

export const imageResultSchema = z.looseObject({
  status: z.enum(["done", "failed"]),
  attempt: z.number().int().min(1),
});

export type ImageResult = z.infer<typeof imageResultSchema>;

export function roundDirectory(outputRoot: string, roundId: string): string {
  return resolve(outputRoot, "evals", "rounds", slugSchema.parse(roundId));
}

export function imageDirectory(
  round: string,
  promptId: string,
  suiteCase: SuiteCase,
): string {
  return join(
    round,
    "images",
    promptId,
    suiteCase.book.slug,
    suiteCase.idea.id,
  );
}

export async function readRoundFile(round: string): Promise<RoundFile> {
  const text = await readFile(join(round, "round.yaml"), "utf8");

  return roundFileSchema.parse(parse(text) as unknown);
}

export async function readImageResult(
  directory: string,
): Promise<ImageResult | null> {
  try {
    const text = await readFile(join(directory, "result.yaml"), "utf8");

    return imageResultSchema.parse(parse(text) as unknown);
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }

    throw error;
  }
}

export async function runRound(args: RunRoundArgs): Promise<RoundSummary> {
  const suite = await loadSuite({
    ...(args.suiteDirectory ? { directory: args.suiteDirectory } : {}),
    ...(args.registryPath ? { registryPath: args.registryPath } : {}),
  });
  const target = await resolveOutputTarget(
    PRIMARY_TARGET_ID,
    args.targetRegistry,
  );
  const round = roundDirectory(args.outputRoot, args.roundId);

  // Fail before any generation if a book has no fetched text to render with.
  const glyphs = await loadBookGlyphs(args.outputRoot, suite);

  const lock = join(round, ".lock");
  await mkdir(round, { recursive: true });

  try {
    await mkdir(lock);
  } catch (error) {
    throw new Error(
      `Round ${args.roundId} is already running. After a forced kill, remove ${lock}`,
      { cause: error },
    );
  }

  try {
    const roundFile = await openRound(round, args, suite);
    const prompts = await loadPromptTemplates(round, roundFile);
    const jobs = await pendingJobs(round, roundFile, suite, args.retry ?? []);

    const summary: RoundSummary = {
      directory: round,
      done: 0,
      failed: 0,
      skipped: roundFile.prompts.length * suite.cases.length - jobs.length,
    };

    args.onProgress?.(
      `Generating ${String(jobs.length)} images (${String(summary.skipped)} already done)`,
    );

    await runPool(jobs, args.concurrency, async (job) => {
      const template = prompts.get(job.promptId) ?? "";
      const bookGlyphs = glyphs.get(job.suiteCase.book.slug);

      if (!bookGlyphs) {
        throw new Error(`No text loaded for ${job.suiteCase.book.slug}`);
      }

      const result = await runImage({
        args,
        round,
        job,
        template,
        glyphs: bookGlyphs,
        target,
      });

      if (result.status === "done") {
        summary.done++;
      } else {
        summary.failed++;
      }

      args.onProgress?.(
        `${job.promptId}/${job.suiteCase.id}: ${result.status}`,
      );
    });

    return summary;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function loadBookGlyphs(
  outputRoot: string,
  suite: Suite,
): Promise<Map<string, BookGlyphs>> {
  const glyphs = new Map<string, BookGlyphs>();

  for (const suiteCase of suite.cases) {
    const slug = suiteCase.book.slug;

    if (glyphs.has(slug)) {
      continue;
    }

    const path = resolve(outputRoot, slug, "text", "book.txt");
    let text: string;

    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`Missing ${path}; run bookgen fetch ${slug} first`, {
        cause: error,
      });
    }

    glyphs.set(slug, await prepareBookGlyphs(text));
  }

  return glyphs;
}

// Creates the round from a prompts directory, or reopens an existing round.
async function openRound(
  round: string,
  args: RunRoundArgs,
  suite: Suite,
): Promise<RoundFile> {
  let existing: RoundFile | null = null;

  try {
    existing = await readRoundFile(round);
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }

  if (existing) {
    if (args.promptsDirectory) {
      throw new Error(
        `Round ${args.roundId} already exists with fixed prompts; omit --prompts to resume, or start a new round`,
      );
    }

    if (existing.suite.sha256 !== suite.sha256) {
      throw new Error(
        `The suite changed since round ${args.roundId} started; start a new round`,
      );
    }

    return existing;
  }

  if (!args.promptsDirectory) {
    throw new Error(
      `Round ${args.roundId} does not exist; pass --prompts <directory> to create it`,
    );
  }

  const prompts = await copyPrompts(args.promptsDirectory, round, suite);

  const roundFile = {
    schema_version: 1 as const,
    round_id: args.roundId,
    created_at: new Date().toISOString(),
    bookgen_version: packageJson.version,
    suite: { version: suite.suiteVersion, sha256: suite.sha256 },
    prompts,
    cases: suite.cases.map((suiteCase) => ({
      book: suiteCase.book.slug,
      book_title: suiteCase.book.title,
      idea: suiteCase.idea.id,
      name: suiteCase.idea.name,
    })),
    image: {
      size: IMAGE_SIZE,
      alpha_threshold: ALPHA_THRESHOLD,
      timeout_seconds: args.timeoutSeconds,
    },
    target: PRIMARY_TARGET_ID,
  };

  await writeFile(join(round, "round.yaml"), stringify(roundFile));

  return roundFile;
}

// Copies every Markdown file (templates and any notes) into the round, and
// checks each template fills cleanly before anything is generated.
async function copyPrompts(
  source: string,
  round: string,
  suite: Suite,
): Promise<RoundPrompt[]> {
  const destination = join(round, "prompts");
  await mkdir(destination, { recursive: true });

  const files = (await readdir(source))
    .filter((file) => file.endsWith(".md"))
    .sort();
  const prompts: RoundPrompt[] = [];

  for (const file of files) {
    await copyFile(join(source, file), join(destination, file));

    if (!file.endsWith(PROMPT_SUFFIX)) {
      continue;
    }

    const id = slugSchema.parse(file.slice(0, -PROMPT_SUFFIX.length));
    const template = await readFile(join(source, file), "utf8");

    for (const suiteCase of suite.cases) {
      fillImagePrompt(template, promptBook(suiteCase), suiteCase.idea);
    }

    prompts.push({ id, file: `prompts/${file}`, sha256: sha256(template) });
  }

  if (prompts.length === 0) {
    throw new Error(`${source} has no *${PROMPT_SUFFIX} prompt templates`);
  }

  return prompts;
}

async function loadPromptTemplates(
  round: string,
  roundFile: RoundFile,
): Promise<Map<string, string>> {
  const templates = new Map<string, string>();

  for (const prompt of roundFile.prompts) {
    const template = await readFile(join(round, prompt.file), "utf8");

    if (sha256(template) !== prompt.sha256) {
      throw new Error(`${prompt.file} changed after the round was created`);
    }

    templates.set(prompt.id, template);
  }

  return templates;
}

interface ImageJob {
  promptId: string;
  suiteCase: SuiteCase;
  directory: string;
}

// Everything not yet done, plus explicit retries.
async function pendingJobs(
  round: string,
  roundFile: RoundFile,
  suite: Suite,
  retry: string[],
): Promise<ImageJob[]> {
  const jobs: ImageJob[] = [];
  const known = new Set<string>();

  for (const prompt of roundFile.prompts) {
    for (const suiteCase of suite.cases) {
      const key = `${prompt.id}/${suiteCase.id}`;
      const directory = imageDirectory(round, prompt.id, suiteCase);
      const result = await readImageResult(directory);
      known.add(key);

      if (result?.status === "done" && !retry.includes(key)) {
        continue;
      }

      jobs.push({ promptId: prompt.id, suiteCase, directory });
    }
  }

  for (const key of retry) {
    if (!known.has(key)) {
      throw new Error(`Unknown image ${key}; use <prompt>/<book>/<idea>`);
    }
  }

  return jobs;
}

interface RunImageArgs {
  args: RunRoundArgs;
  round: string;
  job: ImageJob;
  template: string;
  glyphs: BookGlyphs;
  target: Awaited<ReturnType<typeof resolveOutputTarget>>;
}

async function runImage(input: RunImageArgs): Promise<ImageResult> {
  const { args, job } = input;
  const attempt = (await countAttempts(job.directory)) + 1;
  const attemptName = `attempt-${String(attempt)}`;
  const attemptDirectory = join(job.directory, attemptName);
  const startedAt = new Date();

  const request: ImagesRequest = imagesRequestSchema.parse({
    title: job.suiteCase.book.title,
    author: job.suiteCase.book.author,
    slug: job.suiteCase.book.slug,
    outputRoot: args.outputRoot,
    timeoutSeconds: args.timeoutSeconds,
    size: IMAGE_SIZE,
    alphaThreshold: ALPHA_THRESHOLD,
  });
  const prompt = fillImagePrompt(
    input.template,
    promptBook(job.suiteCase),
    job.suiteCase.idea,
  );

  const base = {
    schema_version: 1,
    prompt_id: job.promptId,
    book: job.suiteCase.book.slug,
    idea: job.suiteCase.idea.id,
    attempt,
    started_at: startedAt.toISOString(),
  };

  let result: Record<string, unknown>;

  try {
    const candidate = await generateCandidate(
      request,
      job.suiteCase.idea,
      attemptDirectory,
      {
        prompt,
        ...(args.generate ? { generate: args.generate } : {}),
        ...(args.signal ? { signal: args.signal } : {}),
      },
    );
    const master = candidate.processed.png;
    await writeFile(join(attemptDirectory, "master.png"), master);

    const preview = await renderPreview({
      master,
      glyphs: input.glyphs,
      target: input.target,
      ...(args.signal ? { signal: args.signal } : {}),
    });
    await writeFile(join(attemptDirectory, "preview.png"), preview);

    const metrics = measureImage(
      await decodeRgba(candidate.image.png),
      await decodeRgba(master),
    );

    result = {
      ...base,
      status: "done",
      finished_at: new Date().toISOString(),
      seconds: secondsSince(startedAt),
      files: {
        prompt: `${attemptName}/prompt.txt`,
        native: `${attemptName}/generated.png`,
        master: `${attemptName}/master.png`,
        preview: `${attemptName}/preview.png`,
        response: `${attemptName}/response.json`,
        events: `${attemptName}/events.jsonl`,
      },
      master_sha256: sha256(master),
      artwork_colors: candidate.colors,
      review_notes: candidate.image.reviewNotes ?? [],
      usage: candidate.image.usage,
      cleanup: candidate.processed.metadata,
      metrics,
    };
  } catch (error) {
    if (args.signal?.aborted) {
      throw error;
    }

    result = {
      ...base,
      status: "failed",
      finished_at: new Date().toISOString(),
      seconds: secondsSince(startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Write then rename, so readers never see a partial result.
  const temporary = join(job.directory, "result.yaml.tmp");
  await mkdir(job.directory, { recursive: true });
  await writeFile(temporary, stringify(result));
  await rename(temporary, join(job.directory, "result.yaml"));

  return imageResultSchema.parse(result);
}

function promptBook(suiteCase: SuiteCase): ImagePromptBook {
  return {
    title: suiteCase.book.title,
    author: suiteCase.book.author,
    size: IMAGE_SIZE,
  };
}

async function countAttempts(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory);

    return entries.filter((entry) => entry.startsWith("attempt-")).length;
  } catch (error) {
    if (isMissing(error)) {
      return 0;
    }

    throw error;
  }
}

async function decodeRgba(png: Buffer): Promise<SourceImage> {
  const { data, info } = await sharp(png, { limitInputPixels: 16_777_216 })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { width: info.width, height: info.height, rgba: data };
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;

  const take = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next++;

      if (item !== undefined) {
        await worker(item);
      }
    }
  };

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    take,
  );

  await Promise.all(workers);
}

function secondsSince(start: Date): number {
  return Math.round((Date.now() - start.getTime()) / 1000);
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
