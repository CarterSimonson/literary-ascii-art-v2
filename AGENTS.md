# Literary ASCII Art v2

## Map

- [README](README.md): project purpose, current state, and development commands.
- [Architecture](ARCHITECTURE.md): pipeline boundaries and dependency rules.
- [Documentation](docs/index.md): decisions, designs, and execution plans.
- [Bootstrap](docs/BOOTSTRAP.md): remaining work to establish the first working pipeline.
- [Generate book art](.agents/skills/generate-book-art/SKILL.md): source-art workflow.

## Project tracking

- Linear project: [Literary ASCII Art v2](https://linear.app/codekips/project/literary-ascii-art-v2-6cfd6b18fd52).
- Linear team: Codekips (`COD`).
- [Tracking conventions and initial queue](docs/project-tracking.md). Linear owns
  current issue status and dependencies; keep durable designs and plans here.

## Product

We're building an end-to-end system for selling literary character art:

1. Create original book-inspired source artwork.
2. Resize a render-only copy to the target character grid, then convert visible pixels into monospaced characters from the book; preserve word spaces and sampled colors, and skip transparent, white, and background-colored pixels.
3. Render print-ready posters.
4. Create dropshipping products, mockups, metadata, and listings.
5. Operate and maintain the online store.

Favor reproducible pipeline stages with explicit inputs, outputs, metadata, and validation. Keep generated masters, converted art, print files, mockups, product records, and store state distinct.

## CLI and outputs

- Use Bun and TypeScript. Every pipeline step must be independently executable
  through the `bookgen` CLI; the first step is `bookgen ideas <book-id>` through the
  Codex SDK, producing ten original poster composition ideas.
- Resolve shared book IDs through root `books.yaml`. `bookgen images <book-id>`
  generates and cleans one unapproved PNG candidate per idea through Codex CLI.
- Aim for recognizable literary character-art posters in the spirit of
  Litographs, grounded in the book and the source-art skill's conversion rules.
- Render with a 6.5 pt minimum font, rectangular cells, and nearest-neighbor working grids. Fit as much text as the grid allows; keep the original master unchanged.
- Generate one reusable source master; poster rendering adapts it to other sizes
  by placing the art and filling the surrounding space. Keep image dimensions out
  of composition ideas. Follow the Litographs-style system: one text field in one
  primary ink, one iconic subject cut out as negative space, details drawn as
  unprinted channels, and at most one accent color separated by a gap. Never
  clip glyphs; separate regions with whole empty cells.
- Group local generated outputs under `output/<book-id>/`: `ideas.yaml`,
  `raw/<idea-id>.png` masters, and separate later-stage artifacts. Keep output tidy
  and ignored by Git.
- Each command regenerates its own expected outputs at stable paths so steps can
  be retried independently. Preserve the last valid artifact if generation fails;
  never silently delete or rewrite another stage's outputs. See
  [CLI contract](docs/product-specs/bookgen-cli.md) for metadata and retry details.

## Working conventions

- Keep durable knowledge in the repository. Record decisions where a future
  agent can find them, and update affected docs with the code.
- For substantial work, keep an execution plan using the convention in the
  [documentation map](docs/index.md). Small changes need no extra paperwork.
- Make behavior observable and verify the requested outcome using the project's
  tools. Include the evidence and any remaining gaps in the handoff.
- When a recurring failure reveals a missing capability, improve the relevant
  tool, check, or documentation so the next attempt has better feedback.
- Enforce important boundaries with checks; leave implementation choices open
  within those boundaries. Keep changes small enough to review and correct.
- Keep this file short. Add guidance when it captures a project-specific decision
  or prevents a demonstrated mistake; remove instructions that no longer help.

## Coding conventions

Write code for human review and maintenance. We're aiming for clarity and low cognitive complexity.

- Separate logical phases with blank lines, including inside functions.
- Always use braces for conditionals and loops.
- Prefer explicit, straightforward code over compact expressions.
- You should "never nest" wherever possible - leverage early returns and if/else statements where possible. Prefer them over ternaries.
- Use descriptive names and specific types rather than broad `object` types.
- Add comments for intent, assumptions, or non-obvious constraints. Avoid comments that merely restate the code.

This is an example of quality code standards:

```ts
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
    const source = offline
      ? await readFile(sourcePath)
      : (await downloadBook(book.id, AbortSignal.timeout(60_000))).bytes;

    if (!offline) {
      await writeFile(sourcePath, source);
    }

    const body = extractBody(source, book.id);
    const normalizedSource = new TextDecoder("utf-8", { fatal: true })
      .decode(source)
      .replace(/\r\n?/g, "\n");

    // Body coordinates are one-based and include both boundary lines.
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

process.exitCode = failures ? 1 : 0;
```
