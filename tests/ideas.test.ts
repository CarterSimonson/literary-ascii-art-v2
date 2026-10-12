import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadEvent } from "@openai/codex-sdk";
import { parse } from "yaml";
import { z } from "zod";
import type { IdeaGenerator } from "../src/ideas/codex.ts";
import { runIdeas } from "../src/ideas/run.ts";
import {
  ideasResponseSchema,
  parseIdeasResponse,
  titleToSlug,
} from "../src/ideas/schema.ts";
import {
  fakeGenerator,
  fixtureUsage,
  ideasResponse,
  request,
  rejection,
  responseEvents,
} from "./fixtures.ts";

let outputRoot: string;
beforeEach(async (): Promise<void> => {
  outputRoot = await mkdtemp(join(tmpdir(), "bookgen-test-"));
});
afterEach(async (): Promise<void> => {
  await rm(outputRoot, { recursive: true, force: true });
});

const traceSchema = z.object({
  status: z.enum(["running", "completed", "failed"]),
  thread_id: z.string().nullable(),
  error: z.string().optional(),
  artifact_sha256: z.string().optional(),
});

async function readTrace(): Promise<z.infer<typeof traceSchema>> {
  const input: unknown = JSON.parse(
    await readFile(join(outputRoot, "dracula/traces/ideas/run.json"), "utf8"),
  );
  return traceSchema.parse(input);
}

describe("concept validation", (): void => {
  test("requires exactly ten complete concepts", (): void => {
    const response = ideasResponse();
    response.ideas.pop();
    expect(() => parseIdeasResponse(JSON.stringify(response))).toThrow();
  });

  test("rejects duplicate IDs and names", (): void => {
    const response = ideasResponse();
    response.ideas = response.ideas.map((idea) => ({
      ...idea,
      id: "duplicate",
    }));
    expect(() => parseIdeasResponse(JSON.stringify(response))).toThrow(
      "duplicate idea IDs",
    );
    const duplicateNames = ideasResponse();
    duplicateNames.ideas = duplicateNames.ideas.map((idea) => ({
      ...idea,
      name: "Same name",
    }));
    expect(() => parseIdeasResponse(JSON.stringify(duplicateNames))).toThrow(
      "duplicate idea names",
    );
  });

  test("rejects malformed JSON, incomplete concepts, and unsafe IDs", (): void => {
    expect(() => parseIdeasResponse("```json\n{}\n```")).toThrow();
    expect(() =>
      parseIdeasResponse(
        JSON.stringify({
          ideas: Array.from({ length: 10 }, () => ({ name: "Idea" })),
        }),
      ),
    ).toThrow();
    const unsafe = ideasResponse();
    unsafe.ideas = unsafe.ideas.map((idea) => ({ ...idea, id: "../escape" }));
    expect(() => parseIdeasResponse(JSON.stringify(unsafe))).toThrow();
  });

  test("requires hex palettes", (): void => {
    const response = ideasResponse();
    response.ideas = response.ideas.map((idea) => ({
      ...idea,
      palette: [{ color: "red", use: "Castle" }],
    }));
    expect(() => parseIdeasResponse(JSON.stringify(response))).toThrow();
  });

  test("accepts a composition without separate subject or storytelling slots", (): void => {
    const response = ideasResponse();
    response.ideas = response.ideas.map((idea) => ({
      ...idea,
      composition: "A sweeping ship silhouette isolated in open space",
      palette: [{ color: "#183D49", use: "Entire ship" }],
    }));
    expect(parseIdeasResponse(JSON.stringify(response))).toEqual(response);
  });

  test("accepts granular palettes and requires a purpose for every color", (): void => {
    const response = ideasResponse();
    const palette = [
      { color: "#183D49", use: "Ship hull" },
      { color: "#80182A", use: "Sails" },
      { color: "#354D31", use: "Coastline" },
      { color: "#D3A343", use: "Moon" },
    ];
    response.ideas = response.ideas.map((idea) => ({ ...idea, palette }));
    expect(parseIdeasResponse(JSON.stringify(response))).toEqual(response);
    response.ideas = response.ideas.map((idea) => ({
      ...idea,
      palette: [{ color: "#183D49", use: " " }],
    }));
    expect(() => parseIdeasResponse(JSON.stringify(response))).toThrow();
  });

  test("requires at least one palette color", (): void => {
    const response = ideasResponse();
    response.ideas = response.ideas.map((idea) => ({ ...idea, palette: [] }));
    expect(() => parseIdeasResponse(JSON.stringify(response))).toThrow();
  });

  test("normalizes accented and punctuated book titles", (): void => {
    expect(titleToSlug("  Les Misérables!  ")).toBe("les-miserables");
    expect(titleToSlug("The Strange Case of Dr. Jekyll & Mr. Hyde")).toBe(
      "the-strange-case-of-dr-jekyll-mr-hyde",
    );
  });
});

describe("book-grouped outputs and retry behavior", (): void => {
  test("publishes ten ideas with provenance and a complete SDK trace", async (): Promise<void> => {
    const path = await runIdeas(request(outputRoot), {
      generate: fakeGenerator(),
    });
    expect(path).toBe(join(outputRoot, "dracula/ideas.yaml"));
    const input: unknown = parse(await readFile(path, "utf8"));
    const artifact = ideasResponseSchema
      .extend({
        schema_version: z.literal(2),
        book: z.object({
          title: z.literal("Dracula"),
          author: z.literal("Bram Stoker"),
          slug: z.literal("dracula"),
        }),
        generation: z.object({
          thread_id: z.literal("fixture-thread"),
          usage: z.object({
            output_tokens: z.literal(fixtureUsage.output_tokens),
          }),
          prompt_sha256: z.string().length(64),
        }),
      })
      .parse(input);
    expect(artifact.ideas).toHaveLength(10);
    const traceDirectory = join(outputRoot, "dracula/traces/ideas");
    expect((await readdir(traceDirectory)).sort()).toEqual([
      "events.jsonl",
      "prompt.txt",
      "response.json",
      "run.json",
    ]);
    expect(
      await readFile(join(traceDirectory, "prompt.txt"), "utf8"),
    ).toContain("Bram Stoker");
    expect(
      (await readFile(join(traceDirectory, "events.jsonl"), "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(4);
    expect((await readTrace()).status).toBe("completed");
    expect((await readdir(join(outputRoot, "dracula"))).sort()).toEqual([
      "ideas.yaml",
      "traces",
    ]);
  });

  test("regenerates ideas and replaces traces while preserving later-stage artifacts", async (): Promise<void> => {
    await runIdeas(request(outputRoot), { generate: fakeGenerator() });
    const rawDirectory = join(outputRoot, "dracula/raw");
    await mkdir(rawDirectory);
    await writeFile(join(rawDirectory, "selected.png"), "existing master");
    await writeFile(
      join(outputRoot, "dracula/traces/ideas/obsolete.txt"),
      "old attempt",
    );
    await runIdeas(request(outputRoot), {
      generate: fakeGenerator(
        responseEvents(JSON.stringify(ideasResponse("regenerated"))),
      ),
    });
    const yaml = await readFile(join(outputRoot, "dracula/ideas.yaml"), "utf8");
    expect(yaml).toContain("regenerated-1");
    expect(yaml).not.toContain("id: concept-1");
    expect(await readFile(join(rawDirectory, "selected.png"), "utf8")).toBe(
      "existing master",
    );
    expect(
      await readdir(join(outputRoot, "dracula/traces/ideas")),
    ).not.toContain("obsolete.txt");
  });

  test.each([
    ["invalid concepts", responseEvents('{"ideas":[]}')],
    [
      "failed turn",
      [{ type: "turn.failed", error: { message: "Authentication required" } }],
    ],
    [
      "fatal stream error",
      [{ type: "error", message: "Connection unavailable" }],
    ],
    ["incomplete stream", responseEvents().slice(0, -1)],
  ] satisfies [string, ThreadEvent[]][])(
    "preserves the last valid ideas after %s",
    async (_, events): Promise<void> => {
      const path = await runIdeas(request(outputRoot), {
        generate: fakeGenerator(),
      });
      const previous = await readFile(path, "utf8");
      expect(
        await rejection(
          runIdeas(request(outputRoot), { generate: fakeGenerator(events) }),
        ),
      ).toThrow("Trace:");
      expect(await readFile(path, "utf8")).toBe(previous);
      expect((await readTrace()).status).toBe("failed");
      expect((await readdir(join(outputRoot, "dracula"))).sort()).toEqual([
        "ideas.yaml",
        "traces",
      ]);
    },
  );

  test("a failed first run does not publish ideas", async (): Promise<void> => {
    expect(
      await rejection(
        runIdeas(request(outputRoot), {
          generate: fakeGenerator(responseEvents("not JSON")),
        }),
      ),
    ).toThrow();
    expect((await readdir(join(outputRoot, "dracula"))).sort()).toEqual([
      "traces",
    ]);
    expect(
      await readFile(
        join(outputRoot, "dracula/traces/ideas/response.json"),
        "utf8",
      ),
    ).toContain("not JSON");
  });

  test("records SDK subprocess errors and releases the lock for retry", async (): Promise<void> => {
    const failedGenerator: IdeaGenerator = (): AsyncIterable<ThreadEvent> => {
      throw new Error("Codex executable missing");
    };
    expect(
      await rejection(
        runIdeas(request(outputRoot), { generate: failedGenerator }),
      ),
    ).toThrow("Codex executable missing");
    expect((await readTrace()).error).toContain("Codex executable missing");
    expect(
      await runIdeas(request(outputRoot), { generate: fakeGenerator() }),
    ).toEndWith("ideas.yaml");
  });

  test("rejects an overlapping attempt without replacing the active trace", async (): Promise<void> => {
    await mkdir(join(outputRoot, "dracula/.ideas.lock"), { recursive: true });
    await mkdir(join(outputRoot, "dracula/traces/ideas"), { recursive: true });
    await writeFile(
      join(outputRoot, "dracula/traces/ideas/prompt.txt"),
      "active prompt",
    );
    expect(
      await rejection(
        runIdeas(request(outputRoot), { generate: fakeGenerator() }),
      ),
    ).toThrow("already active");
    expect(
      await readFile(
        join(outputRoot, "dracula/traces/ideas/prompt.txt"),
        "utf8",
      ),
    ).toBe("active prompt");
    expect((await readdir(join(outputRoot, "dracula"))).sort()).toContain(
      ".ideas.lock",
    );
  });

  test("aborts a stalled request at the timeout and keeps the previous ideas", async (): Promise<void> => {
    const path = await runIdeas(request(outputRoot), {
      generate: fakeGenerator(),
    });
    const previous = await readFile(path, "utf8");
    const stalled: IdeaGenerator = async function* ({
      signal,
    }): AsyncGenerator<ThreadEvent> {
      yield { type: "thread.started", thread_id: "stalled-thread" };
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          (): void => {
            resolve();
          },
          { once: true },
        );
      });
      signal.throwIfAborted();
    };
    expect(
      await rejection(
        runIdeas(
          { ...request(outputRoot), timeoutSeconds: 1 },
          { generate: stalled },
        ),
      ),
    ).toThrow("timed out");
    expect(await readFile(path, "utf8")).toBe(previous);
    expect(await readTrace()).toMatchObject({
      status: "failed",
      thread_id: "stalled-thread",
    });
  });

  test("cancellation records a failure and cleans up the lock", async (): Promise<void> => {
    expect(
      await rejection(
        runIdeas(request(outputRoot), {
          generate: fakeGenerator(),
          signal: AbortSignal.abort(new Error("Interrupted")),
        }),
      ),
    ).toThrow("Interrupted");
    expect((await readTrace()).status).toBe("failed");
    expect((await readdir(join(outputRoot, "dracula"))).sort()).toEqual([
      "traces",
    ]);
  });

  test("rejects unsafe folder names before creating outputs", async (): Promise<void> => {
    expect(
      await rejection(
        runIdeas(
          { ...request(outputRoot), slug: "../escape" },
          { generate: fakeGenerator() },
        ),
      ),
    ).toThrow();
    expect(await readdir(outputRoot)).toEqual([]);
  });
});
