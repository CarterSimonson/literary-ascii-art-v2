import { cp, lstat, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

async function exists(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);

    if (!stat.isDirectory()) {
      throw new Error(`Print output must be a regular directory: ${path}`);
    }

    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export function publicationPaths(
  bookDirectory: string,
  idea: string,
): {
  final: string;
  staging: string;
  backup: string;
  lock: string;
} {
  const print = join(bookDirectory, "print");
  return {
    final: join(print, idea),
    staging: join(print, `.${idea}.staging`),
    backup: join(print, `.${idea}.previous`),
    lock: join(bookDirectory, ".render.lock"),
  };
}

export async function preparePublication(
  paths: ReturnType<typeof publicationPaths>,
): Promise<void> {
  if (await exists(paths.backup)) {
    if (await exists(paths.final)) {
      await rm(paths.backup, { recursive: true });
    } else {
      await rename(paths.backup, paths.final);
    }
  }

  await rm(paths.staging, { recursive: true, force: true });
  await mkdir(paths.staging, { recursive: true });

  if (await exists(paths.final)) {
    await cp(paths.final, paths.staging, { recursive: true });
  }
}

export async function publish(
  paths: ReturnType<typeof publicationPaths>,
): Promise<void> {
  if (await exists(paths.final)) {
    await rename(paths.final, paths.backup);
  }

  try {
    await rename(paths.staging, paths.final);
  } catch (error) {
    if (await exists(paths.backup)) {
      await rename(paths.backup, paths.final);
    }

    throw error;
  }
}
