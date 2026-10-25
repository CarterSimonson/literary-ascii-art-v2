import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { slugSchema } from "../ideas/schema.ts";

// A short fixed list of common problems, so feedback can be counted across
// rounds; stars carry quality and notes carry the rest.
export const FEEDBACK_TAGS = [
  "haze",
  "ragged",
  "busy",
  "unclear",
  "off-idea",
] as const;

const allTags: string[] = [...FEEDBACK_TAGS];

export const feedbackInputSchema = z.strictObject({
  prompt: slugSchema,
  book: slugSchema,
  idea: slugSchema,
  stars: z.number().int().min(1).max(5).nullable(),
  tags: z
    .array(z.string())
    .refine((tags) => tags.every((tag) => allTags.includes(tag)), {
      message: "Unknown tag",
    }),
  note: z.string().max(4000),
});

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export interface FeedbackRecord extends FeedbackInput {
  at: string;
  // Which generated image was judged, so a retried image starts unrated.
  attempt: number;
  master_sha256: string;
}

export function feedbackKey(record: {
  prompt: string;
  book: string;
  idea: string;
}): string {
  return `${record.prompt}/${record.book}/${record.idea}`;
}

export async function appendFeedback(
  round: string,
  record: FeedbackRecord,
): Promise<void> {
  await appendFile(
    join(round, "feedback.jsonl"),
    JSON.stringify(record) + "\n",
  );
}

// The latest record per image; earlier records stay in the file as history.
export async function readLatestFeedback(
  round: string,
): Promise<Map<string, FeedbackRecord>> {
  let text: string;

  try {
    text = await readFile(join(round, "feedback.jsonl"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Map();
    }

    throw error;
  }

  const latest = new Map<string, FeedbackRecord>();

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const record = JSON.parse(line) as FeedbackRecord;
    latest.set(feedbackKey(record), record);
  }

  return latest;
}
