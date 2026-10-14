import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { downloadBook } from "../src/fetch/download.ts";
import { cleanBody, extractBody } from "../src/fetch/text.ts";

type Book = {
  id: number;
  name: string;
};

type BookHeader = ReturnType<typeof extractBody>["header"];

type ValidationResult = Book &
  (
    | {
        status: "passed";
        sha256: string;
        bytes: number;
        body_lines: number;
        start_line: number;
        end_line: number;
        header: BookHeader;
      }
    | {
        status: "failed";
        error: string;
      }
  );

type HeaderFixture = Book & {
  source_sha256: string;
  source_url: string;
  header: BookHeader;
  start_marker: string | undefined;
  end_marker: string | undefined;
  newline: "\r\n" | "\n";
  bom: boolean;
};

const books: Book[] = [
  { id: 345, name: "Dracula" },
  { id: 11, name: "Alice's Adventures in Wonderland" },
  { id: 1342, name: "Pride and Prejudice" },
  { id: 84, name: "Frankenstein" },
  { id: 2701, name: "Moby Dick" },
  { id: 1661, name: "The Adventures of Sherlock Holmes" },
  { id: 2600, name: "War and Peace" },
  { id: 1514, name: "A Midsummer Night's Dream" },
  { id: 132, name: "The Art of War" },
  { id: 1322, name: "Leaves of Grass" },
];

const offline = process.argv.includes("--offline");
const updateFixtures = process.argv.includes("--update-fixtures");

const directory = resolve(".artifacts/gutenberg-validation");
const reportPath = join(directory, "report.json");
const fixturesPath = resolve("tests/fixtures/gutenberg-headers.json");

await mkdir(directory, { recursive: true });

const results: ValidationResult[] = [];
const fixtures: HeaderFixture[] = [];
let failures = 0;

for (const book of books) {
  try {
    const sourcePath = join(directory, `${String(book.id)}.txt`);
    let source: Buffer;

    if (offline) {
      source = await readFile(sourcePath);
    } else {
      const download = await downloadBook(book.id, AbortSignal.timeout(60_000));
      source = download.bytes;
      await writeFile(sourcePath, source);
    }

    const body = extractBody(source, book.id);
    const normalizedSource = new TextDecoder("utf-8", { fatal: true })
      .decode(source)
      .replace(/\r\n?/g, "\n");

    // The manifest uses inclusive one-based lines; slice uses a zero-based start.
    const sourceLines = normalizedSource.split("\n");
    const expectedBody = sourceLines
      .slice(body.startLine - 1, body.endLine)
      .join("\n");

    if (body.lines.join("\n") !== expectedBody) {
      throw new Error("Body coordinates do not reproduce source text");
    }

    const cleanedBody = cleanBody(body, {
      matches_book: true,
      english: true,
      complete_work: true,
      uncertainty: null,
      edition_notes: "Parser validation only; no editorial review",
      removals: [],
    });

    // With no removals, only surrounding newlines may change.
    const expectedCleanedBody = expectedBody.replace(/^\n+|\n+$/g, "") + "\n";

    if (cleanedBody !== expectedCleanedBody) {
      throw new Error("No-removal cleanup changed book text");
    }

    const sourceHash = createHash("sha256").update(source).digest("hex");

    results.push({
      ...book,
      status: "passed",
      sha256: sourceHash,
      bytes: source.length,
      body_lines: body.lines.length,
      start_line: body.startLine,
      end_line: body.endLine,
      header: body.header,
    });

    fixtures.push({
      ...book,
      source_sha256: sourceHash,
      source_url: `https://www.gutenberg.org/cache/epub/${String(book.id)}/pg${String(book.id)}.txt`,
      header: body.header,
      start_marker: sourceLines[body.startLine - 2],
      end_marker: sourceLines[body.endLine],
      newline: source.includes(Buffer.from("\r\n")) ? "\r\n" : "\n",
      bom: source.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
    });

    console.log(
      `PASS ${String(book.id)} ${book.name}: ${String(source.length)} bytes, ${String(body.lines.length)} body lines`,
    );
  } catch (error) {
    failures++;

    const message = error instanceof Error ? error.message : String(error);

    results.push({
      ...book,
      status: "failed",
      error: message,
    });

    console.error(`FAIL ${String(book.id)} ${book.name}: ${message}`);
  }

  if (!offline) {
    await Bun.sleep(2000);
  }
}

const report = {
  checked_at: new Date().toISOString(),
  scope:
    "download, metadata, boundaries, body coordinates, lossless no-removal normalization; no agent cleanup",
  results,
};

await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

// Replace the fixtures only when the entire validation run succeeds.
if (updateFixtures && failures === 0) {
  await writeFile(fixturesPath, JSON.stringify(fixtures, null, 2) + "\n");
}

const passedCount = books.length - failures;

console.log(
  `${String(passedCount)}/${String(books.length)} passed. Report: ${reportPath}`,
);

if (failures > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
