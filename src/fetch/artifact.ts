import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { stringify } from "yaml";

import packageJson from "../../package.json";
import { CLEANUP_VERSION, type CleanupProgress } from "./codex.ts";
import type { DownloadedBook } from "./download.ts";
import type { Cleanup, FetchRequest } from "./schema.ts";
import type { BookBody } from "./text.ts";

export interface FetchProvenance {
  schema_version: 1;
  book: {
    slug: string;
    title: string;
    author: string;
    gutenberg_id: number;
    language: "en";
  };
  started_at: string;
  bookgen_version: string;
  sdk_version: string;
  cleanup_version: number;
  prompt_sha256: string;
  requested_model: string | null;
  edition_context: string | null;
  timeout_seconds: number;
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function createProvenance(
  request: FetchRequest,
  prompt: string,
): FetchProvenance {
  return {
    schema_version: 1,
    book: {
      slug: request.slug,
      title: request.title,
      author: request.author,
      gutenberg_id: request.gutenberg_id,
      language: "en",
    },
    started_at: new Date().toISOString(),
    bookgen_version: packageJson.version,
    sdk_version: packageJson.dependencies["@openai/codex-sdk"],
    cleanup_version: CLEANUP_VERSION,
    prompt_sha256: sha256(prompt),
    requested_model: request.model ?? null,
    edition_context: request.editionContext ?? null,
    timeout_seconds: request.timeoutSeconds,
  };
}

interface TextArtifactInput {
  stagingDirectory: string;
  request: FetchRequest;
  source: DownloadedBook;
  body: BookBody;
  cleanupPlan: Cleanup;
  cleanedText: string;
  provenance: FetchProvenance;
  progress: CleanupProgress;
}

export async function writeTextArtifact(
  input: TextArtifactInput,
): Promise<void> {
  const {
    stagingDirectory,
    request,
    source,
    body,
    cleanupPlan,
    cleanedText,
    provenance,
    progress,
  } = input;

  const manifest = {
    ...provenance,
    fetched_at: new Date().toISOString(),
    source: {
      provider: "project-gutenberg",
      url: source.url,
      catalog_url: `https://www.gutenberg.org/ebooks/${String(request.gutenberg_id)}`,
      path: "source.txt",
      sha256: sha256(source.bytes),
      bytes: source.bytes.length,
    },
    text: {
      path: "book.txt",
      sha256: sha256(cleanedText),
      bytes: Buffer.byteLength(cleanedText),
      unicode_code_points: Array.from(cleanedText).length,
      encoding: "UTF-8",
      newlines: "LF",
    },
    cleanup: {
      provider: "codex-cli",
      thread_id: progress.threadId,
      usage: progress.usage,
      review_status: "unapproved",
      body_start_line: body.startLine,
      body_end_line: body.endLine,
      range_coordinates:
        "1-based inclusive lines in body after LF normalization and Gutenberg wrapper removal",
      normalization:
        "remove selected lines; insert blank line at each removal; trim outer blank lines; preserve all retained line text and wrapping; one final LF",
      ...cleanupPlan,
    },
  };

  await writeFile(join(stagingDirectory, "source.txt"), source.bytes);
  await writeFile(join(stagingDirectory, "book.txt"), cleanedText);
  await writeFile(
    join(stagingDirectory, "manifest.yaml"),
    stringify(manifest, { lineWidth: 80 }),
  );
}
