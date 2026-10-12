import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { addBook, type RunState } from "./workflow";
import { preflight } from "./agent";
import { json, save } from "./files";
import { goJob } from "./go";
import { replay, retainProof } from "./proof";
const help = `Literary character posters

bun run art add-book "Book title" [--author Author] [--gutenberg-id ID | --text body.txt]
  [--out directory] [--ideate-only] [--image-budget 3] [--revision name]
bun run art resume --run directory [--ideate-only] [--image-budget 3]
bun run art re-ideate --run directory
bun run art new-batch --run directory
bun run art render --run directory --candidate ID [--columns 420] [--width 3600] [--height 5400] [--margin 225]
bun run art review --run directory --candidate ID --decision promote|scrap
bun run art replay --proof assets/proofs/odyssey/proof.json --out .artifacts/replay
bun run art retain-proof --run directory --out assets/proofs/odyssey
bun run art doctor

New artwork uses your Codex ChatGPT subscription, never a paid API key.
Offline render uses cached inputs only. Review decisions are separate from generation.
`;
async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      author: { type: "string" },
      "gutenberg-id": { type: "string" },
      text: { type: "string" },
      out: { type: "string" },
      run: { type: "string" },
      candidate: { type: "string" },
      decision: { type: "string" },
      "ideate-only": { type: "boolean" },
      "image-budget": { type: "string" },
      revision: { type: "string" },
      columns: { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
      margin: { type: "string" },
      help: { type: "boolean" },
      proof: { type: "string" },
    },
  });
  const [command, title] = positionals;
  if (!command || values.help) {
    console.log(help);
    return;
  }
  const integer = (v: string | undefined, fallback: number) => {
    if (v === undefined) return fallback;
    if (!/^\d+$/.test(v)) throw new Error(`Expected nonnegative integer: ${v}`);
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new Error("Integer is too large");
    return n;
  };
  if (command === "replay") {
    if (!values.proof || !values.out)
      throw new Error("--proof and --out are required");
    console.log(
      JSON.stringify(
        await replay(resolve(values.proof), resolve(values.out)),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "retain-proof") {
    if (!values.run || !values.out)
      throw new Error("--run and --out are required");
    console.log(
      JSON.stringify(
        await retainProof(resolve(values.run), resolve(values.out)),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "doctor") {
    console.log(JSON.stringify(preflight(), null, 2));
    return;
  }
  if (command === "add-book") {
    if (!title) throw new Error("A book title is required.");
    if (values.text && values["gutenberg-id"])
      throw new Error("Choose --text or --gutenberg-id.");
    const id = values["gutenberg-id"]
      ? integer(values["gutenberg-id"], 0)
      : undefined;
    if (id === 0) throw new Error("Gutenberg ID must be positive.");
    const result = await addBook(
      {
        title,
        author: values.author,
        gutenbergId: id,
        textPath: values.text ? resolve(values.text) : undefined,
      },
      {
        out: values.out,
        ideateOnly: values["ideate-only"],
        imageBudget: integer(values["image-budget"], 3),
        revision: values.revision,
      },
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!values.run) throw new Error("--run is required.");
  const dir = resolve(values.run);
  const state = await json<RunState>(join(dir, "run.json"));
  if (
    command === "resume" ||
    command === "re-ideate" ||
    command === "new-batch"
  ) {
    const result = await addBook(state.request, {
      out: resolve(dir, ".."),
      ideateOnly: values["ideate-only"],
      imageBudget: integer(values["image-budget"], 3),
      revision:
        command === "resume" ? state.revision : `${command}-${randomUUID()}`,
      reuseFrom: command === "resume" ? undefined : dir,
      reuseConcepts: command === "new-batch",
      runDir: command === "resume" ? dir : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const candidate = state.candidates.find((c) => c.id === values.candidate);
  if (!candidate)
    throw new Error("Unknown --candidate; inspect run.json for available IDs.");
  if (command === "render") {
    const book = await json<{ bodyPath: string }>(join(dir, "book.json"));
    const output = join(dir, "renders", `${candidate.id}-${randomUUID()}`);
    await mkdir(output, { recursive: true });
    const mapping = await goJob(
      "map",
      {
        input: candidate.preparedPath,
        output: join(output, "mapping.json"),
        text: book.bodyPath,
        font: resolve("assets/fonts/Go-Mono.ttf"),
        width: integer(values.width, 3600),
        height: integer(values.height, 5400),
        margin: integer(values.margin, 225),
        columns: integer(values.columns, 420),
      },
      output,
    );
    const rendered = await goJob(
      "render",
      {
        input: mapping.path,
        output: join(output, "poster.png"),
        background: candidate.concept.background,
      },
      output,
    );
    console.log(JSON.stringify(rendered, null, 2));
    return;
  }
  if (command === "review") {
    if (!["promote", "scrap"].includes(values.decision || ""))
      throw new Error("--decision must be promote or scrap.");
    const review = {
      candidateId: candidate.id,
      sourceHash: (
        await json<{ sha256: string }>(
          join(dir, "candidates", candidate.id, "image-attempt.json"),
        )
      ).sha256,
      decision: values.decision,
      reviewedAt: new Date().toISOString(),
    };
    await save(
      join(dir, "reviews", `${candidate.id}-${randomUUID()}.json`),
      review,
    );
    console.log(JSON.stringify(review, null, 2));
    return;
  }
  throw new Error(`Unknown command ${command}`);
}
if (import.meta.main)
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
