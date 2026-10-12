import { mkdir, readFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { json, save, sha, root } from "./files";
import { goJob } from "./go";
import type { RunState } from "./workflow";
const Proof = z.object({
  version: z.literal("1"),
  title: z.string(),
  author: z.string(),
  source: z.string(),
  textHash: z.string(),
  fontHash: z.string(),
  candidates: z.array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9-]*$/),
      name: z.string(),
      raw: z.string(),
      rawHash: z.string(),
      prepared: z.string(),
      preparedHash: z.string(),
      palette: z.array(z.string()),
      background: z.string(),
      expectedPixelHash: z.string(),
    }),
  ),
});
export async function retainProof(run: string, out: string) {
  const state = await json<RunState>(join(run, "run.json"));
  if (state.status !== "awaiting-review" || state.candidates.length !== 3)
    throw new Error("Retain only a complete, visually inspected draft run.");
  const book = await json<{
    title: string;
    author: string;
    source: string;
    bodyPath: string;
  }>(join(run, "book.json"));
  await mkdir(out, { recursive: true });
  for (const file of ["raw.txt", "research.json", "concepts.json"])
    await copyFile(join(run, file), join(out, file), 1);
  await copyFile(book.bodyPath, join(out, "body.txt"), 1);
  await save(join(out, "book.json"), { ...book, bodyPath: "body.txt" });
  const candidates = [];
  for (const c of state.candidates) {
    await copyFile(c.rawPath, join(out, `${c.id}.png`), 1);
    await copyFile(c.preparedPath, join(out, `${c.id}.prepared.png`), 1);
    await copyFile(
      join(run, "candidates", c.id, "recipe.json"),
      join(out, `${c.id}.recipe.json`),
      1,
    );
    candidates.push({
      id: c.id,
      name: c.concept.name,
      raw: `${c.id}.png`,
      rawHash: sha(await readFile(c.rawPath)),
      prepared: `${c.id}.prepared.png`,
      preparedHash: sha(await readFile(c.preparedPath)),
      palette: [
        c.concept.dominant,
        ...(c.concept.accent ? [c.concept.accent] : []),
      ],
      background: c.concept.background,
      expectedPixelHash: c.render.pixelHash,
    });
  }
  const proof = {
    version: "1",
    title: book.title,
    author: book.author,
    source: book.source,
    textHash: sha(await readFile(book.bodyPath)),
    fontHash: sha(await readFile(join(root, "assets/fonts/Go-Mono.ttf"))),
    candidates,
  };
  await save(join(out, "proof.json"), proof);
  return proof;
}
export async function replay(proofPath: string, out: string) {
  const proof = Proof.parse(await json(proofPath));
  const inputs = dirname(resolve(proofPath));
  const text = join(inputs, "body.txt"),
    font = join(root, "assets/fonts/Go-Mono.ttf");
  if (
    sha(await readFile(text)) !== proof.textHash ||
    sha(await readFile(font)) !== proof.fontHash
  )
    throw new Error("Retained text/font hash differs from proof.");
  const results = [];
  for (const c of proof.candidates) {
    const input = resolve(inputs, c.raw);
    if (sha(await readFile(input)) !== c.rawHash)
      throw new Error(`Master hash differs: ${c.id}`);
    const dir = join(resolve(out), c.id);
    await mkdir(dir, { recursive: true });
    const prepared = await goJob(
      "prepare",
      {
        input,
        output: join(dir, "prepared.png"),
        palette: c.palette,
        alphaThreshold: 128,
      },
      dir,
    );
    if (prepared.sha256 !== c.preparedHash)
      throw new Error(`Prepared master hash differs: ${c.id}`);
    const mapping = await goJob(
      "map",
      {
        input: prepared.path,
        output: join(dir, "mapping.json"),
        text,
        font,
        width: 3600,
        height: 5400,
        margin: 225,
        columns: 420,
      },
      dir,
    );
    const poster = await goJob(
      "render",
      {
        input: mapping.path,
        output: join(dir, "poster.png"),
        background: c.background,
      },
      dir,
    );
    if (poster.pixelHash !== c.expectedPixelHash)
      throw new Error(`Replay pixel hash differs: ${c.id}`);
    results.push(poster);
  }
  await save(join(resolve(out), "replay.json"), results);
  return results;
}
