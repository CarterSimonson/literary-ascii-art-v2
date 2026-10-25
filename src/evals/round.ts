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
import type { IdeaGenerator } from "../ideas/codex.ts";
import { fillIdeasPrompt } from "../ideas/prompt.ts";
import { ideaSchema, slugSchema } from "../ideas/schema.ts";
import { generateCandidate } from "../images/candidate.ts";
import type { ImageGenerator } from "../images/codex.ts";
import { fillImagePrompt } from "../images/prompt.ts";
import {
  imagesRequestSchema,
  type Idea,
  type ImagesRequest,
} from "../images/schema.ts";
import { resolveOutputTarget, type OutputTarget } from "../output-targets.ts";
import type { SourceImage } from "../render/convert.ts";
import { generateIdeas } from "./ideas.ts";
import { measureImage } from "./metrics.ts";
import { prepareBookGlyphs, renderPreview, type BookGlyphs } from "./render.ts";
import { findCaseIdea, loadSuite, type Suite } from "./suite.ts";

export const PRIMARY_TARGET_ID = "poster-24x36";
const IMAGE_SIZE = "1024x1536";
const ALPHA_THRESHOLD = 128;
const IMAGE_PROMPT_SUFFIX = ".prompt.md";
const IDEAS_PROMPT_SUFFIX = ".ideas.md";
export const IDEAS_PER_BOOK = 3;

// Image rounds vary the image prompt over the frozen suite ideas. Idea rounds
// vary the ideas prompt: each variant writes fresh ideas per suite book, and
// every idea is drawn with one fixed image prompt.
export type RoundKind = "image" | "idea";

export interface RunRoundArgs {
  roundId: string;
  outputRoot: string;
  // Required when creating a round; a round's prompts never change afterwards.
  // Image rounds: *.prompt.md templates. Idea rounds: *.ideas.md templates
  // plus exactly one *.prompt.md, the fixed image prompt.
  promptsDirectory?: string;
  suiteDirectory?: string;
  registryPath?: string;
  targetRegistry?: string;
  concurrency: number;
  timeoutSeconds: number;
  // Image keys (`<prompt>/<book>/<idea>`) to regenerate even if done.
  retry?: string[];
  // Limit the run to these image keys.
  only?: string[];
  generate?: ImageGenerator;
  generateIdeas?: IdeaGenerator;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface RoundSummary {
  directory: string;
  done: number;
  failed: number;
  skipped: number;
}

const bookIdentitySchema = z.strictObject({
  slug: slugSchema,
  title: z.string(),
  author: z.string(),
});

export type BookIdentity = z.infer<typeof bookIdentitySchema>;

const roundCaseSchema = z.strictObject({
  book: bookIdentitySchema,
  idea: ideaSchema,
});

export type RoundCase = z.infer<typeof roundCaseSchema>;

const promptEntrySchema = z.strictObject({
  id: slugSchema,
  file: z.string(),
  sha256: z.string(),
});

export type RoundPrompt = z.infer<typeof promptEntrySchema>;

const roundFileSchema = z.looseObject({
  schema_version: z.literal(1),
  round_id: slugSchema,
  kind: z.enum(["image", "idea"]).default("image"),
  // Image rounds: image templates. Idea rounds: ideas templates.
  prompts: z.array(promptEntrySchema),
  // Idea rounds only: the image template every idea is drawn with.
  image_prompt: promptEntrySchema.optional(),
  // Idea rounds only: the books each ideas template writes for.
  books: z.array(bookIdentitySchema).optional(),
});

export type RoundFile = z.infer<typeof roundFileSchema>;

export const imageResultSchema = z.looseObject({
  status: z.enum(["done", "failed"]),
  attempt: z.number().int().min(1),
});

export type ImageResult = z.infer<typeof imageResultSchema>;

// One cell on the rating page: a prompt (column) applied to one row.
export interface RoundItem {
  key: string;
  promptId: string;
  // Image rounds: `<book>/<idea>`. Idea rounds: `<book>#<n>`.
  rowKey: string;
  book: BookIdentity;
  // Null while an idea round's ideas are being written, or if that failed.
  idea: Idea | null;
  ideasError: string | null;
  directory: string;
}

export function roundDirectory(outputRoot: string, roundId: string): string {
  return resolve(outputRoot, "evals", "rounds", slugSchema.parse(roundId));
}

// Round IDs in natural order, oldest first (round-2 before round-10).
export async function listRoundIds(outputRoot: string): Promise<string[]> {
  try {
    const rounds = resolve(outputRoot, "evals", "rounds");
    const entries = await readdir(rounds);
    const ids: string[] = [];

    // A round exists once its round.yaml does; a directory holding only a
    // prompt agent's draft is not a round yet.
    for (const entry of entries) {
      if (await Bun.file(join(rounds, entry, "round.yaml")).exists()) {
        ids.push(entry);
      }
    }

    return ids.sort((left, right) =>
      left.localeCompare(right, "en", { numeric: true }),
    );
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
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

// Every cell of the round, in row-major order, from the round's own records.
// Old image rounds without a case snapshot get one from the suite.
export async function loadRoundItems(
  round: string,
  roundFile: RoundFile,
  suiteDirectory?: string,
): Promise<RoundItem[]> {
  if (roundFile.kind === "idea") {
    return loadIdeaRoundItems(round, roundFile);
  }

  const cases = await loadCaseSnapshot(round, roundFile, suiteDirectory);
  const items: RoundItem[] = [];

  for (const roundCase of cases) {
    for (const prompt of roundFile.prompts) {
      const rowKey = `${roundCase.book.slug}/${roundCase.idea.id}`;

      items.push({
        key: `${prompt.id}/${rowKey}`,
        promptId: prompt.id,
        rowKey,
        book: roundCase.book,
        idea: roundCase.idea,
        ideasError: null,
        directory: join(
          round,
          "images",
          prompt.id,
          roundCase.book.slug,
          roundCase.idea.id,
        ),
      });
    }
  }

  return items;
}

export async function runRound(args: RunRoundArgs): Promise<RoundSummary> {
  const target = await resolveOutputTarget(
    PRIMARY_TARGET_ID,
    args.targetRegistry,
  );
  const round = roundDirectory(args.outputRoot, args.roundId);
  const roundFile = await openRound(round, args);

  if (roundFile.kind === "idea") {
    await writeMissingIdeas(round, roundFile, args);
  }

  const items = await loadRoundItems(round, roundFile, args.suiteDirectory);
  const books = new Map(items.map((item) => [item.book.slug, item.book]));

  // Fail before any generation if a book has no fetched text to render with.
  const glyphs = await loadBookGlyphs(args.outputRoot, [...books.values()]);
  const templates = await loadImageTemplates(round, roundFile);
  const jobs = await pendingJobs(items, args);

  const summary: RoundSummary = {
    directory: round,
    done: 0,
    failed: 0,
    skipped: items.length - jobs.length,
  };

  args.onProgress?.(
    `Generating ${String(jobs.length)} images (${String(summary.skipped)} skipped)`,
  );

  await runPool(jobs, args.concurrency, async (item) => {
    const result = await runImage({
      args,
      item,
      template: templates.get(item.promptId) ?? "",
      glyphs: glyphs.get(item.book.slug),
      target,
    });

    if (result === null) {
      summary.skipped++;
      return;
    }

    if (result.status === "done") {
      summary.done++;
    } else {
      summary.failed++;
    }

    args.onProgress?.(`${item.key}: ${result.status}`);
  });

  return summary;
}

async function loadBookGlyphs(
  outputRoot: string,
  books: BookIdentity[],
): Promise<Map<string, BookGlyphs>> {
  const glyphs = new Map<string, BookGlyphs>();

  for (const book of books) {
    const path = resolve(outputRoot, book.slug, "text", "book.txt");
    let text: string;

    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`Missing ${path}; run bookgen fetch ${book.slug} first`, {
        cause: error,
      });
    }

    glyphs.set(book.slug, await prepareBookGlyphs(text));
  }

  return glyphs;
}

// Creates the round from a prompts directory, or reopens an existing round.
async function openRound(
  round: string,
  args: RunRoundArgs,
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

    return existing;
  }

  if (!args.promptsDirectory) {
    throw new Error(
      `Round ${args.roundId} does not exist; pass --prompts <directory> to create it`,
    );
  }

  const suite = await loadSuite({
    ...(args.suiteDirectory ? { directory: args.suiteDirectory } : {}),
    ...(args.registryPath ? { registryPath: args.registryPath } : {}),
  });

  await mkdir(join(round, "prompts"), { recursive: true });

  const files = (await readdir(args.promptsDirectory))
    .filter((file) => file.endsWith(".md"))
    .sort();

  for (const file of files) {
    await copyFile(
      join(args.promptsDirectory, file),
      join(round, "prompts", file),
    );
  }

  const ideaTemplates = files.filter((file) =>
    file.endsWith(IDEAS_PROMPT_SUFFIX),
  );

  let roundFile: Record<string, unknown>;

  if (ideaTemplates.length > 0) {
    roundFile = await describeIdeaRound(round, files, suite);
  } else {
    roundFile = await describeImageRound(round, files, suite);
  }

  const complete = {
    schema_version: 1,
    round_id: args.roundId,
    created_at: new Date().toISOString(),
    bookgen_version: packageJson.version,
    suite: { version: suite.suiteVersion, sha256: suite.sha256 },
    ...roundFile,
    image: {
      size: IMAGE_SIZE,
      alpha_threshold: ALPHA_THRESHOLD,
      timeout_seconds: args.timeoutSeconds,
    },
    target: PRIMARY_TARGET_ID,
  };

  await writeFile(join(round, "round.yaml"), stringify(complete));

  return roundFileSchema.parse(complete);
}

async function describeImageRound(
  round: string,
  files: string[],
  suite: Suite,
): Promise<Record<string, unknown>> {
  const cases = suite.cases.map((suiteCase) => ({
    book: bookIdentity(suiteCase.book),
    idea: suiteCase.idea,
  }));
  const prompts: RoundPrompt[] = [];

  for (const file of files.filter((name) =>
    name.endsWith(IMAGE_PROMPT_SUFFIX),
  )) {
    const template = await readFile(join(round, "prompts", file), "utf8");

    for (const roundCase of cases) {
      fillImagePrompt(template, promptBook(roundCase.book), roundCase.idea);
    }

    prompts.push(promptEntry(file, IMAGE_PROMPT_SUFFIX, template));
  }

  if (prompts.length === 0) {
    throw new Error(`No *${IMAGE_PROMPT_SUFFIX} prompt templates were given`);
  }

  await writeFile(join(round, "cases.yaml"), stringify({ cases }));

  return { kind: "image", prompts };
}

async function describeIdeaRound(
  round: string,
  files: string[],
  suite: Suite,
): Promise<Record<string, unknown>> {
  const imageFiles = files.filter((name) => name.endsWith(IMAGE_PROMPT_SUFFIX));

  if (imageFiles.length !== 1 || !imageFiles[0]) {
    throw new Error(
      `An idea round needs exactly one *${IMAGE_PROMPT_SUFFIX} image prompt`,
    );
  }

  const books = [
    ...new Map(
      suite.cases.map((suiteCase) => [
        suiteCase.book.slug,
        bookIdentity(suiteCase.book),
      ]),
    ).values(),
  ];
  const imageTemplate = await readFile(
    join(round, "prompts", imageFiles[0]),
    "utf8",
  );
  // New ideas have the same fields as suite ideas, so suite ideas check it.
  for (const suiteCase of suite.cases) {
    fillImagePrompt(imageTemplate, promptBook(suiteCase.book), suiteCase.idea);
  }

  const prompts: RoundPrompt[] = [];

  for (const file of files.filter((name) =>
    name.endsWith(IDEAS_PROMPT_SUFFIX),
  )) {
    const template = await readFile(join(round, "prompts", file), "utf8");

    for (const book of books) {
      fillIdeasPrompt(template, { ...book, count: IDEAS_PER_BOOK });
    }

    prompts.push(promptEntry(file, IDEAS_PROMPT_SUFFIX, template));
  }

  return {
    kind: "idea",
    prompts,
    image_prompt: promptEntry(
      imageFiles[0],
      IMAGE_PROMPT_SUFFIX,
      imageTemplate,
    ),
    books,
    ideas_per_book: IDEAS_PER_BOOK,
  };
}

function promptEntry(
  file: string,
  suffix: string,
  template: string,
): RoundPrompt {
  return {
    id: slugSchema.parse(file.slice(0, -suffix.length)),
    file: `prompts/${file}`,
    sha256: sha256(template),
  };
}

function bookIdentity(book: BookIdentity): BookIdentity {
  return { slug: book.slug, title: book.title, author: book.author };
}

const caseSnapshotSchema = z.strictObject({
  cases: z.array(roundCaseSchema),
});

async function loadCaseSnapshot(
  round: string,
  roundFile: RoundFile,
  suiteDirectory: string | undefined,
): Promise<RoundCase[]> {
  const path = join(round, "cases.yaml");

  try {
    return caseSnapshotSchema.parse(parse(await readFile(path, "utf8"))).cases;
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }

  // Rounds created before snapshots listed cases by ID only; recover each
  // idea from the suite (or its retired cases) and save the snapshot.
  const legacy = z
    .array(
      z.looseObject({
        book: slugSchema,
        book_title: z.string(),
        idea: slugSchema,
      }),
    )
    .parse(roundFile.cases);
  const cases: RoundCase[] = [];

  for (const entry of legacy) {
    const found = await findCaseIdea({
      book: entry.book,
      idea: entry.idea,
      ...(suiteDirectory ? { directory: suiteDirectory } : {}),
    });
    cases.push({ book: found.book, idea: found.idea });
  }

  await writeFile(path, stringify({ cases }));

  return cases;
}

async function loadImageTemplates(
  round: string,
  roundFile: RoundFile,
): Promise<Map<string, string>> {
  const templates = new Map<string, string>();

  if (roundFile.kind === "idea") {
    const entry = roundFile.image_prompt;

    if (!entry) {
      throw new Error("Idea round is missing its image prompt");
    }

    const template = await readVerified(round, entry);

    for (const prompt of roundFile.prompts) {
      templates.set(prompt.id, template);
    }

    return templates;
  }

  for (const prompt of roundFile.prompts) {
    templates.set(prompt.id, await readVerified(round, prompt));
  }

  return templates;
}

export async function readVerified(
  round: string,
  entry: RoundPrompt,
): Promise<string> {
  const template = await readFile(join(round, entry.file), "utf8");

  if (sha256(template) !== entry.sha256) {
    throw new Error(`${entry.file} changed after the round was created`);
  }

  return template;
}

const ideasFileSchema = z.looseObject({
  status: z.enum(["done", "failed"]),
  ideas: z.array(ideaSchema).optional(),
  error: z.string().optional(),
});

function ideasFilePath(round: string, promptId: string, book: string): string {
  return join(round, "ideas", promptId, `${book}.yaml`);
}

async function readIdeasFile(
  path: string,
): Promise<z.infer<typeof ideasFileSchema> | null> {
  try {
    return ideasFileSchema.parse(parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }

    throw error;
  }
}

// Idea rounds: each ideas template writes ideas for each book, in parallel.
// Failed or missing sets are written again on the next run.
async function writeMissingIdeas(
  round: string,
  roundFile: RoundFile,
  args: RunRoundArgs,
): Promise<void> {
  const tasks: { prompt: RoundPrompt; book: BookIdentity }[] = [];

  for (const prompt of roundFile.prompts) {
    for (const book of roundFile.books ?? []) {
      const existing = await readIdeasFile(
        ideasFilePath(round, prompt.id, book.slug),
      );

      if (existing?.status !== "done") {
        tasks.push({ prompt, book });
      }
    }
  }

  if (tasks.length > 0) {
    args.onProgress?.(`Writing ${String(tasks.length)} idea sets`);
  }

  await runPool(tasks, args.concurrency, async ({ prompt, book }) => {
    const path = ideasFilePath(round, prompt.id, book.slug);
    const template = await readVerified(round, prompt);
    let record: Record<string, unknown>;

    try {
      const ideas = await generateIdeas({
        prompt: fillIdeasPrompt(template, { ...book, count: IDEAS_PER_BOOK }),
        count: IDEAS_PER_BOOK,
        ...(args.generateIdeas ? { generate: args.generateIdeas } : {}),
        ...(args.signal ? { signal: args.signal } : {}),
      });
      record = {
        status: "done",
        generated_at: new Date().toISOString(),
        ideas,
      };
    } catch (error) {
      if (args.signal?.aborted) {
        throw error;
      }

      record = {
        status: "failed",
        generated_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }

    await mkdir(join(round, "ideas", prompt.id), { recursive: true });
    await writeFile(path, stringify(record));
    args.onProgress?.(
      `${prompt.id}/${book.slug} ideas: ${String(record.status)}`,
    );
  });
}

async function loadIdeaRoundItems(
  round: string,
  roundFile: RoundFile,
): Promise<RoundItem[]> {
  const items: RoundItem[] = [];

  for (const book of roundFile.books ?? []) {
    for (let slot = 0; slot < IDEAS_PER_BOOK; slot++) {
      for (const prompt of roundFile.prompts) {
        const record = await readIdeasFile(
          ideasFilePath(round, prompt.id, book.slug),
        );
        const idea = record?.ideas?.[slot] ?? null;
        const rowKey = `${book.slug}#${String(slot + 1)}`;
        let ideasError: string | null = null;

        if (record?.status === "failed") {
          ideasError = record.error ?? "Idea writing failed";
        }

        if (!idea) {
          items.push({
            key: `${prompt.id}/${rowKey}`,
            promptId: prompt.id,
            rowKey,
            book,
            idea: null,
            ideasError,
            directory: join(
              round,
              "images",
              prompt.id,
              book.slug,
              `slot-${String(slot + 1)}`,
            ),
          });
          continue;
        }

        items.push({
          key: `${prompt.id}/${book.slug}/${idea.id}`,
          promptId: prompt.id,
          rowKey,
          book,
          idea,
          ideasError: null,
          directory: join(round, "images", prompt.id, book.slug, idea.id),
        });
      }
    }
  }

  return items;
}

// Everything not yet done, plus explicit retries, limited by `only`.
async function pendingJobs(
  items: RoundItem[],
  args: RunRoundArgs,
): Promise<RoundItem[]> {
  const retry = args.retry ?? [];
  const only = args.only;
  const known = new Set(items.map((item) => item.key));

  for (const key of [...retry, ...(only ?? [])]) {
    if (!known.has(key)) {
      throw new Error(`Unknown image ${key}; use <prompt>/<book>/<idea>`);
    }
  }

  const jobs: RoundItem[] = [];

  for (const item of items) {
    if (!item.idea) {
      continue;
    }

    if (only && !only.includes(item.key)) {
      continue;
    }

    const result = await readImageResult(item.directory);

    if (result?.status === "done" && !retry.includes(item.key)) {
      continue;
    }

    jobs.push(item);
  }

  return jobs;
}

interface RunImageArgs {
  args: RunRoundArgs;
  item: RoundItem;
  template: string;
  glyphs: BookGlyphs | undefined;
  target: OutputTarget;
}

// Generates one image under its own lock, so several retries of different
// images can run at once. Returns null if the image is already being made.
async function runImage(input: RunImageArgs): Promise<ImageResult | null> {
  const { item } = input;
  const idea = item.idea;

  if (!idea || !input.glyphs) {
    throw new Error(`Image ${item.key} has no idea or book text`);
  }

  const lock = join(item.directory, ".lock");
  await mkdir(item.directory, { recursive: true });

  try {
    await mkdir(lock);
  } catch {
    return null;
  }

  try {
    return await generateImage({ ...input, idea, glyphs: input.glyphs });
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

interface GenerateImageArgs extends RunImageArgs {
  idea: Idea;
  glyphs: BookGlyphs;
}

async function generateImage(input: GenerateImageArgs): Promise<ImageResult> {
  const { args, item, idea } = input;
  const attempt = (await countAttempts(item.directory)) + 1;
  const attemptName = `attempt-${String(attempt)}`;
  const attemptDirectory = join(item.directory, attemptName);
  const startedAt = new Date();

  const request: ImagesRequest = imagesRequestSchema.parse({
    title: item.book.title,
    author: item.book.author,
    slug: item.book.slug,
    outputRoot: args.outputRoot,
    timeoutSeconds: args.timeoutSeconds,
    size: IMAGE_SIZE,
    alphaThreshold: ALPHA_THRESHOLD,
  });
  const prompt = fillImagePrompt(input.template, promptBook(item.book), idea);

  const base = {
    schema_version: 1,
    prompt_id: item.promptId,
    book: item.book.slug,
    idea: idea.id,
    attempt,
    started_at: startedAt.toISOString(),
  };

  let result: Record<string, unknown>;

  try {
    const candidate = await generateCandidate(request, idea, attemptDirectory, {
      prompt,
      ...(args.generate ? { generate: args.generate } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
    });
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
  const temporary = join(item.directory, "result.yaml.tmp");
  await writeFile(temporary, stringify(result));
  await rename(temporary, join(item.directory, "result.yaml"));

  return imageResultSchema.parse(result);
}

function promptBook(book: BookIdentity): {
  title: string;
  author: string;
  size: typeof IMAGE_SIZE;
} {
  return { title: book.title, author: book.author, size: IMAGE_SIZE };
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

export async function runPool<T>(
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

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
