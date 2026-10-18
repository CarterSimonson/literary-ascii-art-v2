import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { bookSchema, registeredBookSchema } from "../books.ts";
import { ideaListSchema, slugSchema } from "../ideas/schema.ts";
import {
  outputTargetRegistrySchema,
  type OutputTarget,
} from "../output-targets.ts";
import { DEFAULT_SEPARATION_RADIUS, MAX_SEPARATION_RADIUS } from "./convert.ts";

export const renderRequestSchema = registeredBookSchema.extend({
  slug: slugSchema,
  idea: slugSchema,
  target: slugSchema.optional(),
  targetRegistry: z.string().min(1).default("output-targets.yaml"),
  outputRoot: z.string().min(1).default("output"),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#FFFFFF"),
  separation: z
    .number()
    .int()
    .min(0)
    .max(MAX_SEPARATION_RADIUS)
    .default(DEFAULT_SEPARATION_RADIUS),
});
export type RenderRequest = z.infer<typeof renderRequestSchema>;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = bookSchema.extend({ slug: slugSchema });
const imagesManifestSchema = z.object({
  schema_version: z.literal(1),
  book: identitySchema,
  ideas_sha256: hashSchema,
  images: z.array(
    z.object({
      idea_id: slugSchema,
      path: z.string(),
      sha256: hashSchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  ),
});
const textManifestSchema = z.object({
  schema_version: z.literal(1),
  book: registeredBookSchema.extend({
    slug: slugSchema,
    language: z.literal("en"),
  }),
  text: z.object({ path: z.literal("book.txt"), sha256: hashSchema }),
});
const ideasSchema = z.object({
  schema_version: z.literal(2),
  book: identitySchema,
  ideas: ideaListSchema,
});

export function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

interface Snapshot {
  path: string;
  bytes: Buffer;
  sha256: string;
}

async function snapshot(path: string): Promise<Snapshot> {
  const stat = await lstat(path);

  if (!stat.isFile() || stat.size > 50 * 1024 * 1024) {
    throw new Error(
      `Render input must be a regular file of at most 50 MiB: ${path}`,
    );
  }

  const bytes = await readFile(path);
  return { path, bytes, sha256: sha256(bytes) };
}

function yaml(snapshot: Snapshot): unknown {
  return parse(
    new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes),
  );
}

function assertIdentity(
  book: z.infer<typeof identitySchema>,
  request: RenderRequest,
): void {
  if (
    book.slug !== request.slug ||
    book.title !== request.title ||
    book.author !== request.author
  ) {
    throw new Error(
      "Render input book identity differs from the registry; regenerate the upstream artifact",
    );
  }
}

export async function loadRenderInputs(request: RenderRequest): Promise<{
  snapshots: Snapshot[];
  image: Snapshot;
  imageDimensions: { width: number; height: number };
  text: Snapshot;
  targets: OutputTarget[];
}> {
  const directory = resolve(request.outputRoot, request.slug);
  const [ideas, imagesManifest, textManifest, targetRegistry] =
    await Promise.all([
      snapshot(join(directory, "ideas.yaml")),
      snapshot(join(directory, "raw", "manifest.yaml")),
      snapshot(join(directory, "text", "manifest.yaml")),
      snapshot(resolve(request.targetRegistry)),
    ]);
  const ideasData = ideasSchema.parse(yaml(ideas));
  const imagesData = imagesManifestSchema.parse(yaml(imagesManifest));
  const textData = textManifestSchema.parse(yaml(textManifest));
  const targetsData = outputTargetRegistrySchema.parse(yaml(targetRegistry));

  for (const book of [ideasData.book, imagesData.book, textData.book]) {
    assertIdentity(book, request);
  }

  if (textData.book.gutenberg_id !== request.gutenberg_id) {
    throw new Error(
      "Fetched text edition differs from the registry; rerun bookgen fetch",
    );
  }

  if (imagesData.ideas_sha256 !== ideas.sha256) {
    throw new Error(
      "Image manifest is stale relative to ideas.yaml; rerun bookgen images",
    );
  }

  if (
    new Set(imagesData.images.map((entry) => entry.idea_id)).size !==
      imagesData.images.length ||
    new Set(ideasData.ideas.map((idea) => idea.id)).size !==
      ideasData.ideas.length
  ) {
    throw new Error("Duplicate idea IDs in upstream artifacts");
  }

  const record = imagesData.images.find(
    (entry) => entry.idea_id === request.idea,
  );

  if (!record || !ideasData.ideas.some((idea) => idea.id === request.idea)) {
    throw new Error(`Unknown or ungenerated idea '${request.idea}'`);
  }

  if (record.path !== `${request.idea}.png`) {
    throw new Error(
      "Image manifest must reference the selected idea's PNG within raw/",
    );
  }

  const targets = Object.entries(targetsData.targets)
    .filter(([id]) => request.target === undefined || id === request.target)
    .map(([id, target]) => ({ ...target, id }));

  if (targets.length === 0) {
    throw new Error(`No matching output targets in ${request.targetRegistry}`);
  }

  const [image, text] = await Promise.all([
    snapshot(join(directory, "raw", record.path)),
    snapshot(join(directory, "text", textData.text.path)),
  ]);

  if (image.sha256 !== record.sha256 || text.sha256 !== textData.text.sha256) {
    throw new Error(
      "Render input hash mismatch; regenerate or restore the upstream artifact",
    );
  }

  return {
    snapshots: [
      ideas,
      imagesManifest,
      textManifest,
      targetRegistry,
      image,
      text,
    ],
    image,
    imageDimensions: { width: record.width, height: record.height },
    text,
    targets,
  };
}

export async function verifySnapshots(snapshots: Snapshot[]): Promise<void> {
  for (const previous of snapshots) {
    const current = await snapshot(previous.path);

    if (current.sha256 !== previous.sha256) {
      throw new Error(
        `Render input changed during rendering: ${previous.path}`,
      );
    }
  }
}
