import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { resolveBook, type RegisteredBook } from "../books.ts";
import {
  MAX_PALETTE_COLORS,
  ideaSchema,
  parseIdeasResponse,
  slugSchema,
} from "../ideas/schema.ts";
import type { Idea } from "../images/schema.ts";

export const DEFAULT_SUITE_DIRECTORY = "evals/image-prompt";

const suiteFileSchema = z.strictObject({
  schema_version: z.literal(2),
  suite_version: z.number().int().positive(),
  cases: z.array(z.strictObject({ book: slugSchema, idea: slugSchema })).min(1),
});

// Suite cases hold generation-era ideas, so the generation palette cap applies.
const caseFileSchema = z.strictObject({
  schema_version: z.literal(1),
  purpose: z.string().trim().min(1),
  source: z.string().trim().min(1),
  idea: ideaSchema.extend({
    palette: ideaSchema.shape.palette.max(MAX_PALETTE_COLORS),
  }),
});

export interface SuiteCase {
  // `<book-id>/<idea-id>`, unique within the suite.
  id: string;
  book: RegisteredBook;
  purpose: string;
  source: string;
  idea: Idea;
}

export interface Suite {
  directory: string;
  suiteVersion: number;
  // Covers suite.yaml and every case file, in suite order.
  sha256: string;
  cases: SuiteCase[];
}

export interface LoadSuiteArgs {
  directory?: string;
  registryPath?: string;
}

export async function loadSuite(args: LoadSuiteArgs = {}): Promise<Suite> {
  const directory = resolve(args.directory ?? DEFAULT_SUITE_DIRECTORY);
  const suitePath = join(directory, "suite.yaml");
  const suiteText = await readFile(suitePath, "utf8");
  const suiteFile = suiteFileSchema.parse(parse(suiteText) as unknown);

  const hash = createHash("sha256").update(suiteText);
  const books = new Map<string, RegisteredBook>();
  const cases: SuiteCase[] = [];

  for (const entry of suiteFile.cases) {
    const id = `${entry.book}/${entry.idea}`;

    if (cases.some((existing) => existing.id === id)) {
      throw new Error(`${suitePath} lists ${id} more than once`);
    }

    let book = books.get(entry.book);

    if (!book) {
      book = await resolveBook(entry.book, args.registryPath);
      books.set(entry.book, book);
    }

    const casePath = join(directory, "cases", entry.book, `${entry.idea}.yaml`);
    const caseText = await readFile(casePath, "utf8");
    const caseFile = caseFileSchema.parse(parse(caseText) as unknown);

    if (caseFile.idea.id !== entry.idea) {
      throw new Error(
        `${casePath} holds idea '${caseFile.idea.id}'; its file name requires '${entry.idea}'`,
      );
    }

    hash.update(caseText);
    cases.push({
      id,
      book,
      purpose: caseFile.purpose,
      source: caseFile.source,
      idea: caseFile.idea,
    });
  }

  // Reuse the ideas-set checks for duplicate IDs and names within each book.
  for (const bookId of books.keys()) {
    const ideas = cases
      .filter((entry) => entry.book.slug === bookId)
      .map((entry) => entry.idea);
    parseIdeasResponse(JSON.stringify({ ideas }));
  }

  return {
    directory,
    suiteVersion: suiteFile.suite_version,
    sha256: hash.digest("hex"),
    cases,
  };
}
