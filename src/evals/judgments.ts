import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

// The judge scores each image 0–5 on every axis, with a reason, before giving
// its overall stars. The order here is the order shown to people and agents.
export const JUDGE_AXES = [
  "correctness",
  "representation",
  "recognition",
  "artistic",
] as const;

export type JudgeAxis = (typeof JUDGE_AXES)[number];

export interface AxisScore {
  score: number;
  reason: string;
}

export type JudgeScores = Record<JudgeAxis, AxisScore>;

// One AI judge verdict on one image, appended to the round's judge.jsonl.
// Ranks are within the image's row (1 is best), judged together.
export interface JudgmentRecord {
  at: string;
  judge_version: number;
  key: string;
  row: string;
  prompt: string;
  // Which generated image was judged, so a regenerated image is judged again.
  attempt: number;
  master_sha256: string;
  rank: number;
  // Absent from judgments made before judge v5.
  scores?: JudgeScores;
  stars: number;
  tags: string[];
  note: string;
  confidence: string;
}

// "correctness 4, representation 3, ..." for briefs and reports.
export function scoresSummary(scores: JudgeScores | undefined): string {
  if (!scores) {
    return "no axis scores";
  }

  return JUDGE_AXES.map(
    (axis) => `${axis} ${String(scores[axis].score)}/5`,
  ).join(", ");
}

// Every axis with its score and the judge's reason, one per line.
export function scoresDetail(scores: JudgeScores | undefined): string[] {
  if (!scores) {
    return [];
  }

  return JUDGE_AXES.map(
    (axis) => `${axis} ${String(scores[axis].score)}/5: ${scores[axis].reason}`,
  );
}

export async function appendJudgments(
  round: string,
  records: JudgmentRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  await appendFile(
    join(round, "judge.jsonl"),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}

// The latest judgment per image; earlier ones stay in the file as history.
export async function readLatestJudgments(
  round: string,
): Promise<Map<string, JudgmentRecord>> {
  let text: string;

  try {
    text = await readFile(join(round, "judge.jsonl"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Map();
    }

    throw error;
  }

  const latest = new Map<string, JudgmentRecord>();

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const record = JSON.parse(line) as JudgmentRecord;
    latest.set(record.key, record);
  }

  return latest;
}
