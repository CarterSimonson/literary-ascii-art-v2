import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "../ideas/run.ts";
import { createProvenance, writeTextArtifact } from "./artifact.ts";
import {
  cleanupPrompt,
  collectCleanupPlan,
  planWithCodex,
  type CleanupGenerator,
  type CleanupProgress,
} from "./codex.ts";
import { downloadBook, type FetchTransport } from "./download.ts";
import {
  acquireFetchLock,
  fetchPaths,
  finishFetchFiles,
  prepareTextStaging,
  publishText,
  restorePreviousText,
} from "./publication.ts";
import { fetchRequestSchema, type FetchRequest } from "./schema.ts";
import { cleanBody, extractBody } from "./text.ts";

export interface FetchOptions {
  transport?: FetchTransport;
  generate?: CleanupGenerator;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

type FetchStatus = "running" | "ready" | "completed" | "failed";

export async function runFetch(
  input: FetchRequest,
  options: FetchOptions = {},
): Promise<string> {
  const request = fetchRequestSchema.parse(input);
  const paths = fetchPaths(request);
  await acquireFetchLock(paths, request.slug);

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort(
      new Error(
        `Fetch timed out after ${String(request.timeoutSeconds)} seconds`,
      ),
    );
  }, request.timeoutSeconds * 1000);

  let signal = timeoutController.signal;
  if (options.signal) {
    signal = AbortSignal.any([options.signal, timeoutController.signal]);
  }

  const prompt = cleanupPrompt(request);
  const provenance = createProvenance(request, prompt);
  const progress: CleanupProgress = { threadId: null, usage: null };
  let published = false;
  let completed = false;

  const writeTrace = async (
    status: FetchStatus,
    error?: string,
  ): Promise<void> => {
    let finishedAt: string | null = null;
    if (status !== "running") {
      finishedAt = new Date().toISOString();
    }

    const trace = {
      ...provenance,
      thread_id: progress.threadId,
      usage: progress.usage,
      status,
      finished_at: finishedAt,
      error,
    };

    await writeFile(
      join(paths.traceDirectory, "run.json"),
      JSON.stringify(trace, null, 2) + "\n",
    );
  };

  try {
    await prepareTextStaging(paths);
    await rm(paths.traceDirectory, { recursive: true, force: true });
    await mkdir(paths.traceDirectory, { recursive: true });
    await writeFile(join(paths.traceDirectory, "prompt.txt"), prompt);
    await writeFile(join(paths.traceDirectory, "events.jsonl"), "");
    await writeTrace("running");

    signal.throwIfAborted();
    options.onProgress?.(
      `Downloading Gutenberg ebook ${String(request.gutenberg_id)}`,
    );
    const source = await downloadBook(
      request.gutenberg_id,
      signal,
      options.transport,
    );
    await writeFile(join(paths.traceDirectory, "source.txt"), source.bytes);
    const body = extractBody(source.bytes, request.gutenberg_id);

    options.onProgress?.("Identifying non-book sections with Codex");
    const generate = options.generate ?? planWithCodex;
    const cleanupPlan = await collectCleanupPlan(
      { body, prompt, model: request.model, signal },
      generate,
      paths.traceDirectory,
      progress,
    );
    const cleanedText = cleanBody(body, cleanupPlan);

    await writeTextArtifact({
      stagingDirectory: paths.stagingDirectory,
      request,
      source,
      body,
      cleanupPlan,
      cleanedText,
      provenance,
      progress,
    });

    signal.throwIfAborted();
    await writeTrace("ready");
    await publishText(paths);
    published = true;

    // Retain the backup until the successful run trace has also been written.
    await writeTrace("completed");
    completed = true;
    return join(paths.textDirectory, "manifest.yaml");
  } catch (error) {
    if (published) {
      await restorePreviousText(paths);
    }

    let failure: unknown = error;
    if (signal.aborted) {
      failure = signal.reason;
    }

    await mkdir(paths.traceDirectory, { recursive: true });
    await writeTrace("failed", errorMessage(failure));
    throw new Error(
      `Fetch failed: ${errorMessage(failure)}. Trace: ${paths.traceDirectory}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
    await finishFetchFiles(paths, completed, options.onProgress);
  }
}
