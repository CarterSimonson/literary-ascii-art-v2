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
import { z } from "zod";

import packageJson from "../../package.json";
import { PROCESS_VERSION, processImage } from "./process.ts";
import {
  parseIdeasArtifact,
  imagesRequestSchema,
  type ImagesRequest,
} from "./schema.ts";

export interface RecleanOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const previousManifestSchema = z.looseObject({
  ideas_sha256: hashSchema,
  processing: z.looseObject({}),
  images: z.array(
    z.looseObject({
      idea_id: z.string(),
      path: z.string(),
      attempt: z.number().int().min(1),
      generated_sha256: hashSchema,
      artwork_colors: z.array(z.string()).min(1),
    }),
  ),
});

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

// Reprocesses the native images saved in the latest images trace with the
// current cleanup, without generating anything. Prompts, attempts, review notes,
// and usage carry over; only processing output and metadata change.
export async function runReclean(
  input: ImagesRequest,
  options: RecleanOptions = {},
): Promise<string> {
  const request = imagesRequestSchema.parse(input);
  const directory = resolve(request.outputRoot, request.slug);
  const raw = join(directory, "raw");
  const staging = join(directory, ".raw.staging");
  const backup = join(directory, ".raw.previous");
  const lock = join(directory, ".images.lock");
  const trace = join(directory, "traces", "images");

  const ideasYaml = await readFile(join(directory, "ideas.yaml"), "utf8");
  const ideas = parseIdeasArtifact(parse(ideasYaml) as unknown, request);
  const previous = previousManifestSchema.parse(
    parse(await readFile(join(raw, "manifest.yaml"), "utf8")) as unknown,
  );

  if (previous.ideas_sha256 !== sha256(ideasYaml)) {
    throw new Error(
      "ideas.yaml changed since these images were generated; rerun bookgen images instead",
    );
  }

  const recordIds = previous.images.map((image) => image.idea_id).sort();
  const ideaIds = ideas.map((idea) => idea.id).sort();

  if (JSON.stringify(recordIds) !== JSON.stringify(ideaIds)) {
    throw new Error(
      "raw/manifest.yaml does not cover the current ideas; rerun bookgen images instead",
    );
  }

  try {
    await mkdir(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `An images run is already active for ${request.slug}. Lock: ${lock}`,
        { cause: error },
      );
    }

    throw error;
  }

  try {
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging);

    const images: Record<string, unknown>[] = [];

    for (const record of previous.images) {
      options.signal?.throwIfAborted();
      options.onProgress?.(`Recleaning ${record.idea_id}`);

      const nativePath = join(
        trace,
        record.idea_id,
        `attempt-${String(record.attempt)}`,
        "generated.png",
      );
      const native = await readFile(nativePath);

      // The trace is replaced on every images run, so confirm it still holds
      // the exact native image this manifest was built from.
      if (sha256(native) !== record.generated_sha256) {
        throw new Error(
          `Traced native image for ${record.idea_id} differs from raw/manifest.yaml; rerun bookgen images instead`,
        );
      }

      const processed = await processImage(
        native,
        record.artwork_colors,
        request.alphaThreshold,
      );
      await writeFile(join(staging, record.path), processed.png);

      images.push({
        ...record,
        sha256: sha256(processed.png),
        ...processed.metadata,
      });
    }

    const manifest = {
      ...previous,
      recleaned_at: new Date().toISOString(),
      processing: {
        ...previous.processing,
        version: PROCESS_VERSION,
        sharp_version: packageJson.dependencies.sharp,
        alpha_threshold: request.alphaThreshold,
      },
      review_status: "unapproved",
      images,
    };
    await writeFile(
      join(staging, "manifest.yaml"),
      stringify(manifest, { lineWidth: 80 }),
    );

    options.signal?.throwIfAborted();
    await rm(backup, { recursive: true, force: true });
    await rename(raw, backup);

    try {
      await rename(staging, raw);
    } catch (error) {
      await rename(backup, raw);
      throw error;
    }

    await rm(backup, { recursive: true, force: true });

    return join(raw, "manifest.yaml");
  } finally {
    await rm(staging, { recursive: true, force: true });

    // A failed swap restores the previous set before releasing the lock.
    if (!(await exists(raw)) && (await exists(backup))) {
      await rename(backup, raw);
    }

    await rm(lock, { recursive: true, force: true });
  }
}
