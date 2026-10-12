import { test, expect, setDefaultTimeout } from "bun:test";
setDefaultTimeout(20_000);
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addBook, runDirectory } from "../src/workflow";
import { json, sha, exists } from "../src/files";
import { chunks, stripGutenberg } from "../src/book";
import { validateEvidence } from "../src/contracts";
import { subscriptionEnv, type AgentCall } from "../src/agent";
const story =
  "A traveler returned home across a stormy sea. His companion waited by a doorway, keeping faith through the changing seasons.";
const evidence = {
  paragraphId: "p1",
  quote: "A traveler returned home across a stormy sea.",
};
const motif = {
  name: "Homecoming",
  meaning: "The journey and waiting belong together.",
  evidence: [evidence],
};
const concepts = {
  concepts: ["sea", "door", "weave"].map((id) => ({
    id,
    name: id,
    dominantMass: id,
    subject: "traveler",
    negativeSpace: id,
    secondaryMotif: "waiting",
    rationale: "The journey links to homecoming.",
    evidence: [evidence],
    dominant: "#164B63",
    accent: null,
    background: "#F4EFE4",
    conversionRationale: "Broad silhouette.",
  })),
  recommendedId: "sea",
  recommendation: "Readable.",
};
async function setup() {
  const out = await mkdtemp(join(tmpdir(), "literary-test-"));
  const textPath = join(out, "body.txt");
  await writeFile(textPath, story);
  const request = {
    title: "A fixture book",
    author: "Fixture Author",
    textPath,
  };
  const calls: string[] = [];
  const agent = {
    run: async (call: AgentCall) => {
      calls.push(call.name);
      if (call.name.startsWith("research"))
        return {
          summary: story,
          themes: [motif, motif],
          objects: [motif, motif],
          relationships: [motif],
          uncertainties: [],
        };
      if (call.name === "concepts") return concepts;
      return { path: "native.png", success: true };
    },
  };
  const retain = async (_source: string, destination: string) => {
    await writeFile(destination, "raw-image");
    return { sha256: sha("raw-image"), bytes: 9, source: "native.png" };
  };
  const go = async (
    command: string,
    job: Record<string, unknown>,
    dir: string,
  ) => {
    await writeFile(String(job.output), command);
    const result = {
      version: "1",
      command,
      path: String(job.output),
      sha256: sha(command),
      width: 3600,
      height: 5400,
      bytes: command.length,
      durationMs: 1,
      charactersUsed: 10,
      textLength: story.length,
    };
    await writeFile(
      join(dir, `${command}.result.json`),
      JSON.stringify(result),
    );
    return result;
  };
  return { out, textPath, request, calls, agent, retain, go };
}
test("adding a book generates three drafts and never promotes a recommendation", async () => {
  const f = await setup();
  const result = (await addBook(f.request, f)) as {
    dir: string;
    status: string;
    candidates: unknown[];
  };
  expect(result.status).toBe("awaiting-review");
  expect(result.candidates).toHaveLength(3);
  expect(f.calls.filter((c) => c.startsWith("image"))).toHaveLength(3);
  expect(await exists(join(result.dir, "reviews"))).toBe(false);
});
test("repeating a completed book makes no new model or image calls", async () => {
  const f = await setup();
  await addBook(f.request, f);
  f.calls.length = 0;
  await addBook(f.request, f);
  expect(f.calls).toHaveLength(0);
});
test("an interrupted image run retains successful candidates without duplicate requests", async () => {
  const f = await setup();
  const original = f.agent.run;
  f.agent.run = async (call) => {
    if (call.name === "image-door") throw new Error("subscription limit");
    return original(call);
  };
  await expect(addBook(f.request, f)).rejects.toThrow("subscription limit");
  const dir = runDirectory(f.request, f.out);
  const before = await readFile(join(dir, "candidates/sea/raw.png"), "utf8");
  f.calls.length = 0;
  await expect(addBook(f.request, f)).rejects.toThrow("unknown/failed outcome");
  expect(f.calls).toHaveLength(0);
  expect(await readFile(join(dir, "candidates/sea/raw.png"), "utf8")).toBe(
    before,
  );
  expect((await json<{ status: string }>(join(dir, "run.json"))).status).toBe(
    "failed",
  );
});
test("an exhausted image budget stops before further generation", async () => {
  const f = await setup();
  await expect(addBook(f.request, { ...f, imageBudget: 1 })).rejects.toThrow(
    "budget 1 reached",
  );
  expect(f.calls.filter((c) => c.startsWith("image"))).toHaveLength(1);
});
test("source evidence must identify real paragraphs and exact quotations", () => {
  expect(() =>
    validateEvidence({ evidence: [{ paragraphId: "p9", quote: story }] }, [
      { id: "p1", text: story },
    ]),
  ).toThrow("Invalid source evidence");
  expect(() =>
    validateEvidence({ evidence: [evidence] }, [{ id: "p1", text: story }]),
  ).not.toThrow();
});
test("whole-story research chunks preserve the ending", () => {
  const paragraphs = [
    { id: "p1", text: "first" },
    { id: "p2", text: "middle" },
    { id: "p3", text: "ending" },
  ];
  expect(chunks(paragraphs, 11).flat()).toEqual(paragraphs);
  expect(chunks(paragraphs, 11).at(-1)?.at(-1)?.id).toBe("p3");
});
test("Gutenberg notices are excluded using explicit markers", () => {
  expect(
    stripGutenberg(
      "metadata\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\nStory\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nlicense",
    ),
  ).toBe("Story");
  expect(() => stripGutenberg("unmarked")).toThrow("boundaries");
});
test("subscription subprocesses do not inherit API billing credentials", () => {
  const old = process.env.CODEX_API_KEY;
  process.env.CODEX_API_KEY = "test-key";
  expect(subscriptionEnv().CODEX_API_KEY).toBeUndefined();
  if (old === undefined) delete process.env.CODEX_API_KEY;
  else process.env.CODEX_API_KEY = old;
});

test("short exact quotations remain valid and empty evidence is rejected", () => {
  expect(() =>
    validateEvidence({ paragraphId: "p1", quote: "old friend" }, [
      { id: "p1", text: "I called him my old friend." },
    ]),
  ).not.toThrow();
  expect(() =>
    validateEvidence({ paragraphId: "p1", quote: "" }, [
      { id: "p1", text: "Story." },
    ]),
  ).toThrow("Invalid source evidence");
});

test("a changed local body is rejected instead of using stale research", async () => {
  const f = await setup();
  await addBook(f.request, { ...f, ideateOnly: true });
  await writeFile(f.textPath, "A different story.");
  f.calls.length = 0;
  await expect(addBook(f.request, f)).rejects.toThrow("Local source changed");
  expect(f.calls).toHaveLength(0);
});
test("a fresh image batch reuses grounded research and retains earlier drafts", async () => {
  const f = await setup();
  const original = (await addBook(f.request, f)) as { dir: string };
  f.calls.length = 0;
  const next = (await addBook(f.request, {
    ...f,
    revision: "another-batch",
    reuseFrom: original.dir,
    reuseConcepts: true,
  })) as { dir: string };
  expect(f.calls).toEqual(["image-sea", "image-door", "image-weave"]);
  expect(next.dir).not.toBe(original.dir);
  expect(await exists(join(original.dir, "candidates/sea/raw.png"))).toBe(true);
});

test("Go process arguments are passed literally rather than through a shell", async () => {
  const { processJSON } = await import("../src/go");
  const value = "a title with spaces; $(this-is-literal)";
  const result = await processJSON(process.execPath, [
    "-e",
    "console.log(JSON.stringify({value:process.argv[1]}))",
    value,
  ]);
  expect((result as unknown as { value: string }).value).toBe(value);
});
test("Go process failures preserve actionable stderr", async () => {
  const { processJSON } = await import("../src/go");
  await expect(
    processJSON(process.execPath, [
      "-e",
      'console.error("invalid font hash"); process.exit(1)',
    ]),
  ).rejects.toThrow("invalid font hash");
});

test("a wrong paragraph ID is corrected only when its exact quote has one source match", async () => {
  const { resolveEvidence } = await import("../src/contracts");
  const result = resolveEvidence({ paragraphId: "p9", quote: "old friend" }, [
    { id: "p1", text: "I called him my old friend." },
  ]);
  expect(result.value.paragraphId).toBe("p1");
  expect(result.corrections).toEqual([
    { from: "p9", to: "p1", quote: "old friend" },
  ]);
  expect(() =>
    resolveEvidence({ paragraphId: "p9", quote: "old friend" }, [
      { id: "p1", text: "old friend" },
      { id: "p2", text: "old friend" },
    ]),
  ).toThrow("Invalid source evidence");
  expect(() =>
    resolveEvidence({ paragraphId: "p9", quote: "invented quote" }, [
      { id: "p1", text: "old friend" },
    ]),
  ).toThrow("Invalid source evidence");
});

test("aliases resolving to the same source reuse existing drafts", async () => {
  const f = await setup();
  const first = (await addBook(f.request, f)) as { dir: string };
  f.calls.length = 0;
  const alias = (await addBook(
    { ...f.request, title: "Another name for this edition" },
    f,
  )) as { dir: string };
  expect(alias.dir).toBe(first.dir);
  expect(f.calls).toHaveLength(0);
});
