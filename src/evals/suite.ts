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
  schema_version: z.literal(1),
  suite_version: z.number().int().positive(),
  book: slugSchema,
  cases: z.array(slugSchema).min(1),
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
  id: string;
  purpose: string;
  source: string;
  idea: Idea;
}

export interface Suite {
  directory: string;
  suiteVersion: number;
  // Covers suite.yaml and every case file, in suite order.
  sha256: string;
  book: RegisteredBook;
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

  if (new Set(suiteFile.cases).size !== suiteFile.cases.length) {
    throw new Error(`${suitePath} lists a case more than once`);
  }

  const book = await resolveBook(suiteFile.book, args.registryPath);

  const hash = createHash("sha256").update(suiteText);
  const cases: SuiteCase[] = [];

  for (const caseId of suiteFile.cases) {
    const casePath = join(directory, "cases", `${caseId}.yaml`);
    const caseText = await readFile(casePath, "utf8");
    const caseFile = caseFileSchema.parse(parse(caseText) as unknown);

    if (caseFile.idea.id !== caseId) {
      throw new Error(
        `${casePath} holds idea '${caseFile.idea.id}'; its file name requires '${caseId}'`,
      );
    }

    hash.update(caseText);
    cases.push({
      id: caseId,
      purpose: caseFile.purpose,
      source: caseFile.source,
      idea: caseFile.idea,
    });
  }

  // Reuse the ideas-set checks for duplicate IDs and names.
  parseIdeasResponse(
    JSON.stringify({ ideas: cases.map((entry) => entry.idea) }),
  );

  return {
    directory,
    suiteVersion: suiteFile.suite_version,
    sha256: hash.digest("hex"),
    book,
    cases,
  };
}
