import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { registrySchema } from "../src/books.ts";
import { runCli } from "../src/cli.ts";
import { downloadBook, MAX_SOURCE_BYTES } from "../src/fetch/download.ts";
import { runFetch } from "../src/fetch/run.ts";
import type { Cleanup, FetchRequest } from "../src/fetch/schema.ts";
import { cleanBody, extractBody } from "../src/fetch/text.ts";
import { fakeGenerator, rejection, responseEvents } from "./fixtures.ts";

const lines = [
  "THE EXAMPLE",
  "By An Author",
  "",
  "To my friend",
  "",
  "Contents",
  "I. Arrival",
  "II. Departure",
  "",
  "Preface",
  "These pages record the travels of a friend, in the order they occurred.",
  "",
  "CHAPTER I",
  "“Welcome,” she said. Nothing in this story should be rewritten.",
  "The second line stays wrapped; café and em—dashes stay intact.",
  "",
  "CHAPTER II",
  "They returned home after a long journey, and told their story.",
  "",
  "[Transcriber’s Note: spelling preserved.]",
];

function bookSource(body = lines, id = 123): Buffer<ArrayBuffer> {
  return Buffer.from(
    `\ufeffThe Project Gutenberg eBook\r\nTitle: The Example\r\nAuthor: An Author\r\nRelease date: Today [eBook #${String(id)}]\r\nLanguage: English\r\n*** START OF THE PROJECT GUTENBERG EBOOK THE EXAMPLE ***\r\n${body.join("\r\n")}\r\n*** END OF THE PROJECT GUTENBERG EBOOK THE EXAMPLE ***\r\nLicense here\r\n`,
  );
}

const plan: Cleanup = {
  matches_book: true,
  english: true,
  complete_work: true,
  uncertainty: null,
  edition_notes: "No translator identified.",
  removals: [
    {
      start_line: 6,
      end_line: 8,
      first_line: "Contents",
      last_line: "II. Departure",
      reason: "contents",
      explanation: "Navigation list",
    },
    {
      start_line: 20,
      end_line: 20,
      first_line: "[Transcriber’s Note: spelling preserved.]",
      last_line: "[Transcriber’s Note: spelling preserved.]",
      reason: "transcriber_note",
      explanation: "Production note",
    },
  ],
};

function textResponse(bytes = bookSource()): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
function cleanupGenerator(cleanup = plan): ReturnType<typeof fakeGenerator> {
  return fakeGenerator(responseEvents(JSON.stringify(cleanup)));
}

let root: string;
beforeEach(async (): Promise<void> => {
  root = await mkdtemp(join(tmpdir(), "fetch-test-"));
});
afterEach(async (): Promise<void> => {
  await rm(root, { recursive: true, force: true });
});
function fetchRequest(): FetchRequest {
  return {
    title: "The Example",
    author: "An Author",
    slug: "example",
    gutenberg_id: 123,
    outputRoot: root,
    timeoutSeconds: 5,
  };
}

const transport = (): Promise<Response> => Promise.resolve(textResponse());

describe("Gutenberg content contract", (): void => {
  test("preserves original bytes and author text while removing selected production sections", async (): Promise<void> => {
    const path = await runFetch(fetchRequest(), {
      transport,
      generate: cleanupGenerator(),
    });
    expect(await readFile(join(root, "example/text/source.txt"))).toEqual(
      bookSource(),
    );
    const text = await readFile(join(root, "example/text/book.txt"), "utf8");
    expect(text).toContain("To my friend");
    expect(text).toContain("Preface\nThese pages");
    expect(text).toContain("CHAPTER I\n“Welcome,”");
    expect(text).toContain("café and em—dashes");
    expect(text).not.toMatch(/Contents|Transcriber|Gutenberg|License|\r/);
    const manifest: unknown = parse(await readFile(path, "utf8"));
    expect(manifest).toMatchObject({
      schema_version: 1,
      book: { gutenberg_id: 123, language: "en" },
      source: { path: "source.txt" },
      text: { path: "book.txt" },
      cleanup: { removals: plan.removals, review_status: "unapproved" },
    });
  });

  test("range selection is per-book and preserves poetry, footnotes, and a chapter called Contents", (): void => {
    const other = [
      "A Different Book",
      "",
      "CHAPTER I: Contents",
      "",
      "  A line of verse",
      "    another line",
      "",
      "[1] An author's footnote.",
    ];
    const body = extractBody(bookSource(other, 456), 456);
    expect(cleanBody(body, { ...plan, removals: [] })).toBe(
      other.join("\n") + "\n",
    );
  });

  test.each([0, -1, 1.5, "345", undefined])(
    "registry rejects invalid required Gutenberg ID: %j",
    (id): void => {
      expect(() =>
        registrySchema.parse({
          schema_version: 1,
          books: {
            example: { title: "Example", author: "Author", gutenberg_id: id },
          },
        }),
      ).toThrow();
    },
  );
  test("rejects mismatched IDs, non-English text, missing markers, HTML and malformed UTF-8", (): void => {
    expect(() => extractBody(bookSource(), 345)).toThrow("ID");
    expect(() =>
      extractBody(
        Buffer.from(
          bookSource()
            .toString()
            .replace("Language: English", "Language: French"),
        ),
        123,
      ),
    ).toThrow("English");
    expect(() =>
      extractBody(
        Buffer.from(bookSource().toString().replace("START OF", "BROKEN")),
        123,
      ),
    ).toThrow("markers");
    expect(() => extractBody(Buffer.from("<html>error</html>"), 123)).toThrow();
    expect(() => extractBody(Buffer.from([0xff]), 123)).toThrow();
  });

  test("rejects uncertainty, invalid anchors, overlapping or oversized removals", (): void => {
    const body = extractBody(bookSource(), 123);
    expect(() =>
      cleanBody(body, { ...plan, uncertainty: "Unclear preface authorship" }),
    ).toThrow("review");
    const first = plan.removals[0];
    if (!first) {
      throw new Error("Missing fixture range");
    }

    expect(() =>
      cleanBody(body, {
        ...plan,
        removals: [{ ...first, first_line: "wrong" }],
      }),
    ).toThrow("anchors");
    expect(() =>
      cleanBody(body, { ...plan, removals: [first, first] }),
    ).toThrow("nonoverlapping");
    expect(() =>
      cleanBody(body, { ...plan, removals: [{ ...first, end_line: 999 }] }),
    ).toThrow("within");
    expect(() =>
      cleanBody(body, {
        ...plan,
        removals: [
          {
            ...first,
            start_line: 1,
            end_line: 20,
            first_line: lines[0] ?? "",
            last_line: lines[19] ?? "",
          },
        ],
      }),
    ).toThrow("half");
  });
});

describe("fetch publication and failures", (): void => {
  test("edition context is recorded without bypassing unresolved cleanup uncertainty", async (): Promise<void> => {
    const editionContext = "The user accepts omitted illustrations.";
    const request = { ...fetchRequest(), editionContext };
    const path = await runFetch(request, {
      transport,
      generate: (input) => {
        expect(input.prompt).toContain(editionContext);
        return cleanupGenerator()();
      },
    });
    const prior = await readFile(path, "utf8");
    const manifest: unknown = parse(prior);
    expect(manifest).toMatchObject({ edition_context: editionContext });

    expect(
      await rejection(
        runFetch(request, {
          transport,
          generate: cleanupGenerator({
            ...plan,
            uncertainty: "The final chapter may be missing.",
          }),
        }),
      ),
    ).toThrow("final chapter");
    expect(await readFile(path, "utf8")).toBe(prior);
  });

  test("successful reruns replace only text and failed cleanup preserves the last set", async (): Promise<void> => {
    const options = { transport, generate: cleanupGenerator() };
    const path = await runFetch(fetchRequest(), options);
    const prior = await readFile(path, "utf8");
    await writeFile(join(root, "example/ideas.yaml"), "untouched");
    await mkdir(join(root, "example/raw"));
    await writeFile(join(root, "example/raw/master.png"), "untouched image");
    await writeFile(join(root, "example/text/obsolete.txt"), "old");
    expect(
      await rejection(
        runFetch(fetchRequest(), {
          transport,
          generate: cleanupGenerator({ ...plan, matches_book: false }),
        }),
      ),
    ).toThrow("identity");
    expect(await readFile(path, "utf8")).toBe(prior);
    expect(
      await readFile(join(root, "example/traces/fetch/run.json"), "utf8"),
    ).toContain('"failed"');
    await runFetch(fetchRequest(), options);
    expect((await readdir(join(root, "example/text"))).sort()).toEqual([
      "book.txt",
      "manifest.yaml",
      "source.txt",
    ]);
    expect(await readFile(join(root, "example/ideas.yaml"), "utf8")).toBe(
      "untouched",
    );
    expect(await readFile(join(root, "example/raw/master.png"), "utf8")).toBe(
      "untouched image",
    );
  });

  test("recovers interrupted publication before a failed download", async (): Promise<void> => {
    const path = await runFetch(fetchRequest(), {
      transport,
      generate: cleanupGenerator(),
    });
    const prior = await readFile(path, "utf8");
    await rename(
      join(root, "example/text"),
      join(root, "example/.text.previous"),
    );
    expect(
      await rejection(
        runFetch(fetchRequest(), {
          transport: () =>
            Promise.resolve(new Response("not found", { status: 404 })),
        }),
      ),
    ).toThrow("404");
    expect(await readFile(path, "utf8")).toBe(prior);
  });

  test("locking prevents concurrent publication", async (): Promise<void> => {
    await mkdir(join(root, "example/.fetch.lock"), { recursive: true });
    expect(
      await rejection(
        runFetch(fetchRequest(), { transport, generate: cleanupGenerator() }),
      ),
    ).toThrow("already active");
  });

  test("cancellation and incomplete agent turns leave no text artifact or stale lock", async (): Promise<void> => {
    expect(
      await rejection(
        runFetch(fetchRequest(), { transport, generate: fakeGenerator([]) }),
      ),
    ).toThrow("completed turn");
    expect(
      await rejection(
        runFetch(fetchRequest(), {
          transport,
          signal: AbortSignal.abort(new Error("Stopped")),
        }),
      ),
    ).toThrow("Stopped");
    expect(await readdir(join(root, "example"))).toEqual(["traces"]);
  });

  test("timeout aborts an in-flight download and releases the lock", async (): Promise<void> => {
    const pending = runFetch(
      { ...fetchRequest(), timeoutSeconds: 1 },
      {
        transport: (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => {
                reject(new Error("aborted"));
              },
              { once: true },
            );
          }),
      },
    );
    expect(await rejection(pending)).toThrow("timed out");
    expect(await readdir(join(root, "example"))).toEqual(["traces"]);
  });
});

describe("download boundary and command", (): void => {
  test("rejects HTTP errors, HTML responses, and oversized streaming bodies", async (): Promise<void> => {
    for (const res of [
      new Response("bad", { status: 429 }),
      new Response("<html>", { headers: { "content-type": "text/html" } }),
      new Response("large", {
        headers: {
          "content-type": "text/plain",
          "content-length": String(MAX_SOURCE_BYTES + 1),
        },
      }),
      textResponse(Buffer.alloc(MAX_SOURCE_BYTES + 1)),
    ]) {
      expect(
        await rejection(
          downloadBook(123, new AbortController().signal, () =>
            Promise.resolve(res),
          ),
        ),
      ).toThrow();
    }
  });

  test("CLI resolves the pinned source and passes settings", async (): Promise<void> => {
    let called = false;
    expect(
      await runCli(
        [
          "fetch",
          "dracula",
          "--output",
          root,
          "--model",
          "chosen",
          "--edition-context",
          "The user accepts omitted illustrations.",
          "--timeout",
          "60",
        ],
        {
          fetchBook: (input): Promise<string> => {
            expect(input).toEqual({
              title: "Dracula",
              author: "Bram Stoker",
              slug: "dracula",
              gutenberg_id: 345,
              outputRoot: root,
              model: "chosen",
              editionContext: "The user accepts omitted illustrations.",
              timeoutSeconds: 60,
            });
            called = true;
            return Promise.resolve("manifest.yaml");
          },
          stdout: (): void => {},
          stderr: (): void => {},
        },
      ),
    ).toBe(0);
    expect(called).toBe(true);
  });

  test.each(
    [
      ["fetch"],
      ["fetch", "unknown"],
      ["fetch", "dracula", "--timeout", "0"],
    ].map((args) => [args] as [string[]]),
  )(
    "invalid CLI arguments fail before fetching: %j",
    async (args): Promise<void> => {
      let called = false;
      expect(
        await runCli(args, {
          fetchBook: (): Promise<string> => {
            called = true;
            return Promise.resolve("bad");
          },
          stdout: (): void => {},
          stderr: (): void => {},
        }),
      ).toBe(1);
      expect(called).toBe(false);
    },
  );
  test("help requires neither registry nor authentication", async (): Promise<void> => {
    let output = "";
    expect(
      await runCli(["fetch", "--help", "--registry", "/missing"], {
        stdout: (text): void => {
          output += text;
        },
      }),
    ).toBe(0);
    expect(output).toContain("bookgen fetch");
  });
});
