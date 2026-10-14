import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import packageJson from "../../package.json";
import { errorMessage } from "../ideas/run.ts";
import type { ImageGenerator } from "./codex.ts";
import { generateCandidate } from "./candidate.ts";
import { IMAGE_PROMPT_VERSION } from "./prompt.ts";
import { PROCESS_VERSION } from "./process.ts";
import {
  imagesRequestSchema,
  parseIdeasArtifact,
  type ImagesRequest,
} from "./schema.ts";

export interface ImagesRunOptions {
  generate?: ImageGenerator;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

export async function runImages(
  input: ImagesRequest,
  options: ImagesRunOptions = {},
): Promise<string> {
  const request = imagesRequestSchema.parse(input);
  const directory = resolve(request.outputRoot, request.slug);
  const ideasPath = join(directory, "ideas.yaml");
  const lock = join(directory, ".images.lock");
  const staging = join(directory, ".raw.staging");
  const backup = join(directory, ".raw.previous");
  const raw = join(directory, "raw");
  const trace = join(directory, "traces", "images");
  const yaml = await readFile(ideasPath, "utf8");
  const parsed: unknown = parse(yaml);
  const ideas = parseIdeasArtifact(parsed, request);
  await mkdir(directory, { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error(
        `An images run is already active for ${request.slug}. Lock: ${lock}`,
        { cause: error },
      );
    throw error;
  }
  const startedAt = new Date().toISOString();
  const records: object[] = [];
  let currentIdea: string | null = null;
  let published = false;
  let completed = false;
  const provenance = {
    schema_version: 1,
    book: { title: request.title, author: request.author, slug: request.slug },
    started_at: startedAt,
    ideas_sha256: sha256(yaml),
    bookgen_version: packageJson.version,
    sdk_version: packageJson.dependencies["@openai/codex-sdk"],
    provider: "codex-cli",
    requested_model: request.model ?? null,
    requested_size: request.size,
    timeout_seconds_per_attempt: request.timeoutSeconds,
    maximum_attempts_per_image: 2,
    prompt_version: IMAGE_PROMPT_VERSION,
    processing: {
      version: PROCESS_VERSION,
      sharp_version: packageJson.dependencies.sharp,
      alpha_threshold: request.alphaThreshold,
      palette_mapping: "nearest-srgb",
      padding_width_fraction: 0.02,
    },
  };
  const writeTrace = async (status: string, error?: string): Promise<void> => {
    await writeFile(
      join(trace, "run.json"),
      JSON.stringify(
        {
          ...provenance,
          status,
          current_idea: currentIdea,
          completed_images: records.length,
          finished_at: status === "running" ? null : new Date().toISOString(),
          ...(error ? { error } : {}),
        },
        null,
        2,
      ) + "\n",
    );
  };
  try {
    if (await exists(backup)) {
      if (!(await exists(raw))) await rename(backup, raw);
      else await rm(backup, { recursive: true });
    }
    if ((await exists(raw)) && !(await lstat(raw)).isDirectory())
      throw new Error("raw must be a regular directory");
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging);
    await rm(trace, { recursive: true, force: true });
    await mkdir(trace, { recursive: true });
    await writeFile(join(trace, "ideas.yaml"), yaml);
    await writeTrace("running");
    options.signal?.throwIfAborted();
    for (const [index, idea] of ideas.entries()) {
      currentIdea = idea.id;
      options.onProgress?.(
        `Generating image ${String(index + 1)}/${String(ideas.length)}: ${idea.id}`,
      );
      await writeTrace("running");
      let previousFailure: string | undefined;
      for (const attempt of [1, 2]) {
        const attemptTrace = join(trace, idea.id, `attempt-${String(attempt)}`);
        try {
          const { image, processed, prompt, colors } = await generateCandidate(
            request,
            idea,
            attemptTrace,
            options,
            previousFailure,
          );
          await writeFile(join(staging, `${idea.id}.png`), processed.png);
          records.push({
            idea_id: idea.id,
            path: `${idea.id}.png`,
            attempt,
            prompt_sha256: sha256(prompt),
            generated_sha256: sha256(image.png),
            sha256: sha256(processed.png),
            artwork_colors: colors,
            native_review_notes: image.reviewNotes ?? [],
            thread_id: image.threadId,
            usage: image.usage,
            ...processed.metadata,
          });
          break;
        } catch (error) {
          previousFailure = errorMessage(error);
          await mkdir(attemptTrace, { recursive: true });
          await writeFile(
            join(attemptTrace, "failure.json"),
            JSON.stringify({ error: previousFailure }, null, 2) + "\n",
          );
          if (options.signal?.aborted || attempt === 2) throw error;
          options.onProgress?.(
            `Replacing failed image ${idea.id}: ${previousFailure}`,
          );
        }
      }
    }
    options.signal?.throwIfAborted();
    if (sha256(await readFile(ideasPath, "utf8")) !== provenance.ideas_sha256)
      throw new Error(
        "ideas.yaml changed during generation; rerun images against the new ideas",
      );
    await writeFile(
      join(staging, "manifest.yaml"),
      stringify(
        {
          ...provenance,
          generated_at: new Date().toISOString(),
          review_status: "unapproved",
          images: records,
        },
        { lineWidth: 80 },
      ),
    );
    options.signal?.throwIfAborted();
    await writeTrace("ready");
    if (await exists(raw)) await rename(raw, backup);
    try {
      await rename(staging, raw);
    } catch (error) {
      if (await exists(backup)) await rename(backup, raw);
      throw error;
    }
    published = true;
    await writeTrace("completed");
    completed = true;
    return join(raw, "manifest.yaml");
  } catch (error) {
    if (published) {
      await rm(raw, { recursive: true, force: true });
      if (await exists(backup)) await rename(backup, raw);
    }
    await mkdir(trace, { recursive: true });
    await writeTrace("failed", errorMessage(error));
    throw new Error(
      `Images generation failed: ${errorMessage(error)}. Trace: ${trace}`,
      { cause: error },
    );
  } finally {
    try {
      await rm(staging, { recursive: true, force: true });
      if (completed) {
        try {
          await rm(backup, { recursive: true, force: true });
        } catch (error) {
          options.onProgress?.(
            `Images published; previous-set cleanup will retry next run: ${errorMessage(error)}`,
          );
        }
      }
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}
