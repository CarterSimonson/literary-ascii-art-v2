import { spawn } from "node:child_process";
import { join } from "node:path";
import { save, root } from "./files";
export type Artifact = {
  version: string;
  command: string;
  path: string;
  sha256: string;
  pixelHash?: string;
  width: number;
  height: number;
  bytes: number;
  durationMs: number;
  charactersUsed?: number;
  wordsUsed?: number;
  textLength?: number;
  visibleCells?: number;
  textExhausted?: boolean;
  opaquePixels?: number;
  transparentPixels?: number;
  partialPixels?: number;
};
export async function processJSON(
  executable: string,
  args: string[],
  cwd = root,
): Promise<Artifact> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${executable} exited ${code}: ${err.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`Invalid Go result: ${out.slice(0, 200)}`));
      }
    });
  });
}
export async function goJob(
  command: string,
  job: Record<string, unknown>,
  dir: string,
): Promise<Artifact> {
  const manifest = join(dir, `${command}.job.json`);
  await save(manifest, { version: "1", ...job });
  const result = await processJSON(
    process.env.LITERARY_GO_BINARY || join(root, ".artifacts/bin/literary-art"),
    [command, manifest],
  );
  await save(join(dir, `${command}.result.json`), result);
  return result;
}
