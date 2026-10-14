import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { errorMessage } from "../ideas/run.ts";
import type { FetchRequest } from "./schema.ts";

export interface FetchPaths {
  bookDirectory: string;
  textDirectory: string;
  stagingDirectory: string;
  backupDirectory: string;
  lockDirectory: string;
  traceDirectory: string;
}

export function fetchPaths(request: FetchRequest): FetchPaths {
  const bookDirectory = resolve(request.outputRoot, request.slug);

  return {
    bookDirectory,
    textDirectory: join(bookDirectory, "text"),
    stagingDirectory: join(bookDirectory, ".text.staging"),
    backupDirectory: join(bookDirectory, ".text.previous"),
    lockDirectory: join(bookDirectory, ".fetch.lock"),
    traceDirectory: join(bookDirectory, "traces", "fetch"),
  };
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

export async function acquireFetchLock(
  paths: FetchPaths,
  bookId: string,
): Promise<void> {
  await mkdir(paths.bookDirectory, { recursive: true });

  try {
    await mkdir(paths.lockDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `A fetch run is already active for ${bookId}. Lock: ${paths.lockDirectory}`,
        { cause: error },
      );
    }

    throw error;
  }
}

export async function prepareTextStaging(paths: FetchPaths): Promise<void> {
  for (const directory of [paths.textDirectory, paths.backupDirectory]) {
    if (!(await exists(directory))) {
      continue;
    }

    if (!(await lstat(directory)).isDirectory()) {
      throw new Error(`${directory} must be a regular directory`);
    }
  }

  // A killed process may have moved the last valid set aside without publishing its replacement.
  if (await exists(paths.backupDirectory)) {
    if (await exists(paths.textDirectory)) {
      await rm(paths.backupDirectory, { recursive: true });
    } else {
      await rename(paths.backupDirectory, paths.textDirectory);
    }
  }

  await rm(paths.stagingDirectory, { recursive: true, force: true });
  await mkdir(paths.stagingDirectory);
}

export async function publishText(paths: FetchPaths): Promise<void> {
  if (await exists(paths.textDirectory)) {
    await rename(paths.textDirectory, paths.backupDirectory);
  }

  try {
    await rename(paths.stagingDirectory, paths.textDirectory);
  } catch (error) {
    if (await exists(paths.backupDirectory)) {
      await rename(paths.backupDirectory, paths.textDirectory);
    }

    throw error;
  }
}

export async function restorePreviousText(paths: FetchPaths): Promise<void> {
  await rm(paths.textDirectory, { recursive: true, force: true });

  if (await exists(paths.backupDirectory)) {
    await rename(paths.backupDirectory, paths.textDirectory);
  }
}

export async function finishFetchFiles(
  paths: FetchPaths,
  completed: boolean,
  onProgress?: (message: string) => void,
): Promise<void> {
  try {
    await rm(paths.stagingDirectory, { recursive: true, force: true });

    if (!completed) {
      return;
    }

    // Backup cleanup is best-effort: its failure must not invalidate a published artifact.
    try {
      await rm(paths.backupDirectory, { recursive: true, force: true });
    } catch (error) {
      onProgress?.(
        `Text published; previous-set cleanup will retry next run: ${errorMessage(error)}`,
      );
    }
  } finally {
    await rm(paths.lockDirectory, { recursive: true, force: true });
  }
}
