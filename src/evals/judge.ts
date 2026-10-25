import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { UserInput } from "@openai/codex-sdk";
import sharp from "sharp";
import { z } from "zod";

import { codexStructuredRunner, type StructuredRunner } from "./codex.ts";
import { FEEDBACK_TAGS } from "./feedback.ts";
import { loadHistory, type ImageRecord, type RoundHistory } from "./history.ts";
import { runPool } from "./round.ts";

// Bump when the brief, rubric handling, or example selection changes, so
// judgments from different versions are not compared.
export const JUDGE_VERSION = 1;
export const DEFAULT_RUBRIC = "evals/judge/rubric.md";

// Rated examples shown to the judge, spread across the star scale.
const MAXIMUM_EXAMPLES = 10;
const EXAMPLE_WIDTH = 360;
const POSTER_WIDTH = 640;
const SOURCE_WIDTH = 400;

const judgeResponseSchema = z.strictObject({
  ratings: z.array(
    z.strictObject({
      image: z.number().int().min(1),
      stars: z.number().int().min(1).max(5),
      tags: z.array(z.enum(FEEDBACK_TAGS)),
      note: z.string(),
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
});

export type Judge = StructuredRunner;

export const judgeWithCodex: Judge = codexStructuredRunner(judgeResponseSchema);

export interface JudgeRating {
  key: string;
  stars: number;
  tags: string[];
  note: string;
  confidence: "low" | "medium" | "high";
}

export interface JudgeRowArgs {
  rubric: string;
  roundId: string;
  row: ImageRecord[];
  examples: ImageRecord[];
  traceDirectory: string;
  judge?: Judge;
  signal?: AbortSignal;
}

// Rates every finished image in one idea row together, as the user does. The
// images are shown in a shuffled order without prompt labels.
export async function judgeRow(args: JudgeRowArgs): Promise<JudgeRating[]> {
  const images = args.row.filter((image) => image.result?.status === "done");

  if (images.length === 0) {
    return [];
  }

  const order = shuffle(
    images,
    `${args.roundId}/${images[0]?.item.rowKey ?? ""}`,
  );
  await mkdir(join(args.traceDirectory, "images"), { recursive: true });

  const first = order[0];

  if (!first) {
    return [];
  }

  const input: UserInput[] = [
    { type: "text", text: judgeBrief(args.rubric, first) },
  ];

  input.push({
    type: "text",
    text: "Examples the user rated, with their stars and notes:",
  });

  for (const [index, example] of args.examples.entries()) {
    const path = join(
      args.traceDirectory,
      "images",
      `example-${String(index + 1)}.jpg`,
    );
    await thumbnail(example, "preview", EXAMPLE_WIDTH, path);
    input.push({ type: "text", text: exampleCaption(index + 1, example) });
    input.push({ type: "local_image", path });
  }

  input.push({
    type: "text",
    text: `Now rate these ${String(order.length)} posters of the idea above. Each has its rendered poster followed by its source image.`,
  });

  for (const [index, image] of order.entries()) {
    const poster = join(
      args.traceDirectory,
      "images",
      `image-${String(index + 1)}-poster.jpg`,
    );
    const source = join(
      args.traceDirectory,
      "images",
      `image-${String(index + 1)}-source.png`,
    );
    await thumbnail(image, "preview", POSTER_WIDTH, poster);
    await thumbnail(image, "master", SOURCE_WIDTH, source);
    input.push({ type: "text", text: `Image ${String(index + 1)}: poster` });
    input.push({ type: "local_image", path: poster });
    input.push({ type: "text", text: `Image ${String(index + 1)}: source` });
    input.push({ type: "local_image", path: source });
  }

  await writeFile(
    join(args.traceDirectory, "request.md"),
    input
      .map((part) =>
        part.type === "text" ? part.text : `[image ${part.path}]`,
      )
      .join("\n\n"),
  );
  await writeFile(join(args.traceDirectory, "events.jsonl"), "");

  const output = await (args.judge ?? judgeWithCodex)({
    input,
    signal: args.signal ?? new AbortController().signal,
    onEvent: async (event) => {
      await appendFile(
        join(args.traceDirectory, "events.jsonl"),
        JSON.stringify(event) + "\n",
      );
    },
  });
  await writeFile(join(args.traceDirectory, "response.json"), output.response);

  const response = judgeResponseSchema.parse(JSON.parse(output.response));
  const ratings: JudgeRating[] = [];

  for (const rating of response.ratings) {
    const image = order[rating.image - 1];

    if (!image) {
      throw new Error(
        `The judge rated image ${String(rating.image)}, which does not exist`,
      );
    }

    ratings.push({
      key: image.item.key,
      stars: rating.stars,
      tags: rating.tags,
      note: rating.note,
      confidence: rating.confidence,
    });
  }

  if (new Set(ratings.map((rating) => rating.key)).size !== order.length) {
    throw new Error("The judge must rate every image exactly once");
  }

  return ratings;
}

function judgeBrief(rubric: string, image: ImageRecord): string {
  const idea = image.item.idea;

  return `You are judging literary character-art posters on behalf of one specific user. Predict the star rating, tags, and a one-sentence note that this user would give each poster. Match their taste as described by the rubric and shown by their rated examples, not your own.

${rubric.trim()}

Book: ${image.item.book.title} by ${image.item.book.author}.
Idea: ${idea?.name ?? "unknown"}. ${idea?.composition ?? ""}

Return one rating per image, using the image numbers given. Rate each poster on its own merits against the scale; images in the same set may share a rating. Use confidence "low" when the poster could reasonably get stars two apart.`;
}

function exampleCaption(index: number, example: ImageRecord): string {
  const feedback = example.feedback;
  const parts = [
    `Example ${String(index)}: ${example.item.book.title}, "${example.item.idea?.name ?? ""}"`,
    `user gave ${String(feedback?.stars ?? "no")} stars`,
  ];

  if (feedback && feedback.tags.length > 0) {
    parts.push(`tags: ${feedback.tags.join(", ")}`);
  }

  if (feedback && feedback.note.trim() !== "") {
    parts.push(`note: "${feedback.note.trim()}"`);
  }

  return parts.join("; ");
}

async function thumbnail(
  image: ImageRecord,
  file: "preview" | "master",
  width: number,
  path: string,
): Promise<void> {
  const files = image.result?.files as Record<string, string> | undefined;
  const relative = files?.[file];

  if (!relative) {
    throw new Error(`Image ${image.item.key} has no ${file} file`);
  }

  const resized = sharp(join(image.item.directory, relative)).resize({ width });

  if (path.endsWith(".png")) {
    await resized.png().toFile(path);
    return;
  }

  await resized
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 80 })
    .toFile(path);
}

// Deterministic per row, so reruns show the judge the same order.
function shuffle<T>(items: T[], seed: string): T[] {
  return items
    .map((item, index) => ({
      item,
      rank: createHash("sha256")
        .update(`${seed}:${String(index)}`)
        .digest("hex"),
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
    .map((entry) => entry.item);
}

// Rated examples from other rounds, spread across the star scale and
// preferring ones with notes. Excluding the judged round keeps the check
// honest: the judge never sees the answers it is scored against.
export function pickExamples(
  history: RoundHistory[],
  excludeRound: string,
): ImageRecord[] {
  const byStars = new Map<number, ImageRecord[]>();

  for (const round of history) {
    if (round.roundId === excludeRound) {
      continue;
    }

    for (const image of round.images) {
      const stars = image.feedback?.stars;

      if (!stars || image.result?.status !== "done") {
        continue;
      }

      const group = byStars.get(stars) ?? [];
      group.push(image);
      byStars.set(stars, group);
    }
  }

  for (const group of byStars.values()) {
    group.sort((left, right) => noteLength(right) - noteLength(left));
  }

  const picked: ImageRecord[] = [];
  let added = true;

  while (picked.length < MAXIMUM_EXAMPLES && added) {
    added = false;

    for (const stars of [5, 4, 3, 2, 1]) {
      const next = byStars.get(stars)?.shift();

      if (next && picked.length < MAXIMUM_EXAMPLES) {
        picked.push(next);
        added = true;
      }
    }
  }

  return picked;
}

function noteLength(image: ImageRecord): number {
  return image.feedback?.note.trim().length ?? 0;
}

export interface JudgeCheckArgs {
  outputRoot: string;
  rounds?: string[];
  rubricPath?: string;
  suiteDirectory?: string;
  concurrency: number;
  judge?: Judge;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface Comparison {
  round: string;
  key: string;
  prompt: string;
  row: string;
  human: number;
  judge: number;
  confidence: string;
  human_note: string;
  judge_note: string;
}

export interface JudgeCheckSummary {
  judge_version: number;
  rated_images: number;
  exact: number;
  within_one: number;
  mean_absolute_error: number;
  correlation: number | null;
  row_pairs: number;
  row_order_agreement: number | null;
  rounds: {
    round: string;
    human_winner: string;
    judge_winner: string;
    human_means: Record<string, number>;
    judge_means: Record<string, number>;
  }[];
}

// Judges every rated round and compares the judge's stars with the user's.
export async function runJudgeCheck(
  args: JudgeCheckArgs,
): Promise<{ directory: string; summary: JudgeCheckSummary }> {
  const rubric = await readFile(
    resolve(args.rubricPath ?? DEFAULT_RUBRIC),
    "utf8",
  );
  const history = await loadHistory(args.outputRoot, args.suiteDirectory);
  const rounds = history.filter(
    (round) =>
      (!args.rounds || args.rounds.includes(round.roundId)) &&
      round.images.some((image) => image.feedback?.stars),
  );

  if (rounds.length === 0) {
    throw new Error("No rated rounds to check the judge against");
  }

  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  const directory = resolve(
    args.outputRoot,
    "evals",
    "judge",
    `check-${stamp}`,
  );
  await mkdir(directory, { recursive: true });

  const rows: { round: RoundHistory; row: ImageRecord[] }[] = [];

  for (const round of rounds) {
    const grouped = new Map<string, ImageRecord[]>();

    for (const image of round.images) {
      const group = grouped.get(image.item.rowKey) ?? [];
      group.push(image);
      grouped.set(image.item.rowKey, group);
    }

    for (const row of grouped.values()) {
      if (row.some((image) => image.feedback?.stars)) {
        rows.push({ round, row });
      }
    }
  }

  args.onProgress?.(
    `Judging ${String(rows.length)} rows across ${String(rounds.length)} rounds`,
  );

  const comparisons: Comparison[] = [];
  let finished = 0;

  await runPool(rows, args.concurrency, async ({ round, row }) => {
    const rowName =
      row[0]?.item.rowKey.replaceAll("/", "--").replaceAll("#", "-") ?? "row";
    const ratings = await judgeRow({
      rubric,
      roundId: round.roundId,
      row,
      examples: pickExamples(history, round.roundId),
      traceDirectory: join(directory, round.roundId, rowName),
      ...(args.judge ? { judge: args.judge } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
    });

    for (const rating of ratings) {
      const image = row.find((entry) => entry.item.key === rating.key);
      const human = image?.feedback?.stars;

      if (!image || !human) {
        continue;
      }

      comparisons.push({
        round: round.roundId,
        key: rating.key,
        prompt: image.item.promptId,
        row: image.item.rowKey,
        human,
        judge: rating.stars,
        confidence: rating.confidence,
        human_note: image.feedback?.note ?? "",
        judge_note: rating.note,
      });
    }

    finished++;
    args.onProgress?.(`Judged ${String(finished)}/${String(rows.length)} rows`);
  });

  comparisons.sort((left, right) => left.key.localeCompare(right.key));

  const summary = summarize(comparisons);

  await writeFile(
    join(directory, "comparisons.jsonl"),
    comparisons.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  await writeFile(
    join(directory, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  await writeFile(join(directory, "report.md"), report(summary, comparisons));

  return { directory, summary };
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function correlation(left: number[], right: number[]): number | null {
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;

  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    covariance += (value - leftMean) * (other - rightMean);
    leftVariance += (value - leftMean) ** 2;
    rightVariance += (other - rightMean) ** 2;
  }

  if (leftVariance === 0 || rightVariance === 0) {
    return null;
  }

  return covariance / Math.sqrt(leftVariance * rightVariance);
}

export function summarize(comparisons: Comparison[]): JudgeCheckSummary {
  const humans = comparisons.map((entry) => entry.human);
  const judges = comparisons.map((entry) => entry.judge);
  const differences = comparisons.map((entry) =>
    Math.abs(entry.human - entry.judge),
  );

  // Within a row, for every pair the user rated differently, does the judge
  // order them the same way? Judge ties count as half.
  let pairs = 0;
  let agreement = 0;

  for (const [index, left] of comparisons.entries()) {
    for (const right of comparisons.slice(index + 1)) {
      if (
        left.round !== right.round ||
        left.row !== right.row ||
        left.human === right.human
      ) {
        continue;
      }

      pairs++;

      const humanOrder = Math.sign(left.human - right.human);
      const judgeOrder = Math.sign(left.judge - right.judge);

      if (judgeOrder === humanOrder) {
        agreement++;
      }

      if (judgeOrder === 0) {
        agreement += 0.5;
      }
    }
  }

  const rounds = [...new Set(comparisons.map((entry) => entry.round))].map(
    (round) => {
      const entries = comparisons.filter((entry) => entry.round === round);
      const prompts = [...new Set(entries.map((entry) => entry.prompt))];
      const humanMeans: Record<string, number> = {};
      const judgeMeans: Record<string, number> = {};

      for (const prompt of prompts) {
        const own = entries.filter((entry) => entry.prompt === prompt);
        humanMeans[prompt] = round3(mean(own.map((entry) => entry.human)));
        judgeMeans[prompt] = round3(mean(own.map((entry) => entry.judge)));
      }

      return {
        round,
        human_winner: winner(humanMeans),
        judge_winner: winner(judgeMeans),
        human_means: humanMeans,
        judge_means: judgeMeans,
      };
    },
  );

  let rowOrder: number | null = null;

  if (pairs > 0) {
    rowOrder = round3(agreement / pairs);
  }

  const fit = correlation(humans, judges);

  return {
    judge_version: JUDGE_VERSION,
    rated_images: comparisons.length,
    exact: round3(
      mean(differences.map((difference) => (difference === 0 ? 1 : 0))),
    ),
    within_one: round3(
      mean(differences.map((difference) => (difference <= 1 ? 1 : 0))),
    ),
    mean_absolute_error: round3(mean(differences)),
    correlation: fit === null ? null : round3(fit),
    row_pairs: pairs,
    row_order_agreement: rowOrder,
    rounds,
  };
}

function winner(means: Record<string, number>): string {
  let best = "";
  let bestMean = -1;

  for (const [prompt, value] of Object.entries(means)) {
    if (value > bestMean) {
      best = prompt;
      bestMean = value;
    }
  }

  return best;
}

function percent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  return `${String(Math.round(value * 100))}%`;
}

function report(summary: JudgeCheckSummary, comparisons: Comparison[]): string {
  const lines = [
    `# AI judge check (judge v${String(summary.judge_version)})`,
    "",
    `Compared on ${String(summary.rated_images)} images the user rated.`,
    "",
    `- Exact star match: ${percent(summary.exact)}`,
    `- Within one star: ${percent(summary.within_one)}`,
    `- Mean absolute error: ${summary.mean_absolute_error.toFixed(2)} stars`,
    `- Correlation with the user's stars: ${summary.correlation?.toFixed(2) ?? "n/a"}`,
    `- Same order within a row: ${percent(summary.row_order_agreement)} of ${String(summary.row_pairs)} pairs the user rated differently`,
    "",
    "## Round winners",
    "",
    "| Round | User's winner | Judge's winner | User means | Judge means |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const round of summary.rounds) {
    const format = (means: Record<string, number>): string =>
      Object.entries(means)
        .map(([prompt, value]) => `${prompt} ${value.toFixed(2)}`)
        .join(", ");

    lines.push(
      `| ${round.round} | ${round.human_winner} | ${round.judge_winner} | ${format(round.human_means)} | ${format(round.judge_means)} |`,
    );
  }

  lines.push("", "## Biggest disagreements", "");

  const worst = [...comparisons]
    .sort(
      (left, right) =>
        Math.abs(right.human - right.judge) - Math.abs(left.human - left.judge),
    )
    .slice(0, 10);

  for (const entry of worst) {
    lines.push(
      `- ${entry.round}/${entry.key}: user ${String(entry.human)}, judge ${String(entry.judge)} (${entry.confidence}). User: "${entry.human_note}" Judge: "${entry.judge_note}"`,
    );
  }

  return lines.join("\n") + "\n";
}
