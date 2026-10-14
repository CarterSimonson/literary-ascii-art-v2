import { describe, expect, test } from "bun:test";
import headers from "./fixtures/gutenberg-headers.json";
import { cleanBody, extractBody } from "../src/fetch/text.ts";

const retainedLines = [
  "",
  "A title",
  "",
  "  Poetry keeps indentation.",
  "A café—‘quoted’—stays verbatim.",
  "",
  "Last line.",
  "",
];

function bookSourceFixture(
  index: number,
  newline?: string,
): Buffer<ArrayBuffer> {
  const entry = headers[index];
  if (!entry) {
    throw new Error("Missing corpus fixture");
  }

  const text = [
    entry.header,
    entry.start_marker,
    ...retainedLines,
    entry.end_marker,
    "License outside the book",
  ].join("\n");
  let formattedSource = text.replace(/\n/g, newline ?? entry.newline);
  if (entry.bom) {
    formattedSource = "\ufeff" + formattedSource;
  }

  return Buffer.from(formattedSource);
}

describe("real Gutenberg download formats", (): void => {
  test.each(headers.map((entry, index) => [entry.name, index] as const))(
    "extracts and preserves the body with %s metadata",
    (_name, index): void => {
      const entry = headers[index];
      if (!entry) {
        throw new Error("Missing corpus fixture");
      }

      const body = extractBody(bookSourceFixture(index), entry.id);
      expect(body.header).toBe(entry.header);
      expect(body.lines).toEqual(retainedLines);
      expect(body.startLine).toBe(entry.header.split("\n").length + 2);
      expect(body.endLine - body.startLine + 1).toBe(retainedLines.length);
      expect(
        cleanBody(body, {
          matches_book: true,
          english: true,
          complete_work: true,
          uncertainty: null,
          edition_notes: "Fixture only",
          removals: [],
        }),
      ).toBe(retainedLines.slice(1, -1).join("\n") + "\n");
    },
  );
  test.each(["\n", "\r\n", "\r"])(
    "accepts line ending %j without changing body content",
    (newline): void => {
      expect(extractBody(bookSourceFixture(0, newline), 345).lines).toEqual(
        retainedLines,
      );
    },
  );
  test("recognizes legacy THIS and mixed-case eBook marker spelling", (): void => {
    const source = bookSourceFixture(0)
      .toString()
      .replaceAll(
        "OF THE PROJECT GUTENBERG EBOOK",
        "OF THIS PROJECT GUTENBERG eBook",
      );
    expect(extractBody(Buffer.from(source), 345).lines).toEqual(retainedLines);
  });

  test("rejects duplicate, reversed, and missing boundaries instead of guessing", (): void => {
    const entry = headers[0];
    if (!entry) {
      throw new Error("Missing corpus fixture");
    }

    const source = bookSourceFixture(0).toString();
    for (const damaged of [
      source.replace(
        entry.start_marker,
        `${entry.start_marker}\n${entry.start_marker}`,
      ),
      source.replace(
        entry.end_marker,
        `${entry.end_marker}\n${entry.end_marker}`,
      ),
      source.replace(entry.start_marker, "MISSING"),
      source.replace(entry.end_marker, "MISSING"),
      [
        entry.header,
        entry.end_marker,
        ...retainedLines,
        entry.start_marker,
      ].join("\n"),
    ]) {
      expect(() => extractBody(Buffer.from(damaged), entry.id)).toThrow(
        "markers",
      );
    }
  });
});
