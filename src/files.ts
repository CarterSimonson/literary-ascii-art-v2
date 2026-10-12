import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
export const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const json = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8"));
export async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
}
export async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export async function lock(path: string, run: () => Promise<unknown>) {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Run already locked: ${path}. If its process has exited, remove this lock before resuming.`,
      );
    throw e;
  }
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await run();
  } finally {
    await handle.close();
    await unlink(path);
  }
}
export const root = resolve(import.meta.dir, "..");
