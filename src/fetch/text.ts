import type { Cleanup } from "./schema.ts";

export interface BookBody {
  lines: string[];
  header: string;
  startLine: number;
  endLine: number;
}

const startMarker =
  /^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b.*\*\*\*\s*$/i;
const endMarker =
  /^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b.*\*\*\*\s*$/i;

function decodeSource(source: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(source)
    .replace(/\r\n?/g, "\n");

  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10) {
      throw new Error("Source contains unsupported control characters");
    }
  }

  return text;
}

function validateHeader(header: string, gutenbergId: number): void {
  if (!/^Language:\s*English\s*$/im.test(header)) {
    throw new Error("Gutenberg source must declare Language: English");
  }

  const declaredId = /\[e-?book\s*#\s*(\d+)\]/i.exec(header)?.[1];
  if (declaredId === undefined || Number(declaredId) !== gutenbergId) {
    throw new Error("Gutenberg ebook ID does not match the registry");
  }
}

export function extractBody(source: Uint8Array, gutenbergId: number): BookBody {
  const sourceLines = decodeSource(source).split("\n");
  const startIndices: number[] = [];
  const endIndices: number[] = [];

  for (const [index, line] of sourceLines.entries()) {
    if (startMarker.test(line)) {
      startIndices.push(index);
    }

    if (endMarker.test(line)) {
      endIndices.push(index);
    }
  }

  const startIndex = startIndices[0];
  const endIndex = endIndices[0];
  if (
    startIndices.length !== 1 ||
    endIndices.length !== 1 ||
    startIndex === undefined ||
    endIndex === undefined ||
    endIndex <= startIndex + 1
  ) {
    throw new Error("Expected one ordered pair of Gutenberg START/END markers");
  }

  const header = sourceLines.slice(0, startIndex).join("\n");
  validateHeader(header, gutenbergId);

  const bodyLines = sourceLines.slice(startIndex + 1, endIndex);
  if (!bodyLines.join("\n").trim()) {
    throw new Error("Gutenberg body is empty");
  }

  // Source coordinates are inclusive and one-based so the manifest can replay extraction.
  return {
    lines: bodyLines,
    header,
    startLine: startIndex + 2,
    endLine: endIndex,
  };
}

export function cleanBody(body: BookBody, plan: Cleanup): string {
  if (
    !plan.matches_book ||
    !plan.english ||
    !plan.complete_work ||
    plan.uncertainty !== null
  ) {
    const reason =
      plan.uncertainty ??
      "book identity, language, or completeness could not be confirmed";
    throw new Error(`Cleanup needs review: ${reason}`);
  }

  const retainedLines: string[] = [];
  let nextRetainedIndex = 0;

  for (const range of plan.removals) {
    // Inclusive one-based ranges become a zero-based start and an exclusive end.
    const startIndex = range.start_line - 1;
    const endIndex = range.end_line;

    if (
      startIndex < nextRetainedIndex ||
      endIndex <= startIndex ||
      endIndex > body.lines.length
    ) {
      throw new Error(
        "Cleanup ranges must be ordered, nonoverlapping, and within the body",
      );
    }

    if (
      body.lines[startIndex] !== range.first_line ||
      body.lines[endIndex - 1] !== range.last_line
    ) {
      throw new Error("Cleanup range anchors do not match source lines");
    }

    for (const line of body.lines.slice(nextRetainedIndex, startIndex)) {
      retainedLines.push(line);
    }

    // Keep neighboring paragraphs separate when a removed section sat between them.
    retainedLines.push("");
    nextRetainedIndex = endIndex;
  }

  for (const line of body.lines.slice(nextRetainedIndex)) {
    retainedLines.push(line);
  }

  const cleanedText = retainedLines.join("\n").replace(/^\n+|\n+$/g, "") + "\n";
  const originalCharacterCount = body.lines
    .join("\n")
    .replace(/\s/g, "").length;
  const retainedCharacterCount = cleanedText.replace(/\s/g, "").length;

  // A structurally valid plan can still remove implausibly much of the work.
  if (
    !retainedCharacterCount ||
    retainedCharacterCount < originalCharacterCount / 2
  ) {
    throw new Error(
      "Cleanup removed more than half of the book; manual review required",
    );
  }

  return cleanedText;
}
