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
export const JUDGE_VERSION = 3;
export const DEFAULT_RUBRIC = "evals/judge/rubric.md";

// Rated examples shown to the judge, spread across the star scale.
const MAXIMUM_EXAMPLES = 10;
const EXAMPLE_WIDTH = 360;
const POSTER_WIDTH = 1200;
const RAW_WIDTH = 800;

// Transparent pixels in the raw image show as this gray, so soft or partial
// transparency reads as a visible blend rather than vanishing into white.
const RAW_BACKGROUND = "#c8c8c8";

const judgeResponseSchema = z.strictObject({
  // Image numbers from best to worst, every image exactly once.
  ranking: z.array(z.number().int().min(1)),
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
  // 1 is the best image in its row.
  rank: number;
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

// Ranks and rates every finished image in one idea row together. The images
// are shown in a shuffled order without prompt labels.
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
    text: "Examples the user rated, with their stars and notes, to illustrate the rubric:",
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
    text: `Now judge these ${String(order.length)} images of the idea above. Each has its rendered poster (the product) followed by the raw image the generator produced before cleanup; gray shows transparent areas.`,
  });

  for (const [index, image] of order.entries()) {
    const poster = join(
      args.traceDirectory,
      "images",
      `image-${String(index + 1)}-poster.jpg`,
    );
    const raw = join(
      args.traceDirectory,
      "images",
      `image-${String(index + 1)}-raw.jpg`,
    );
    await thumbnail(image, "preview", POSTER_WIDTH, poster);
    await thumbnail(image, "native", RAW_WIDTH, raw);
    input.push({ type: "text", text: `Image ${String(index + 1)}: poster` });
    input.push({ type: "local_image", path: poster });
    input.push({ type: "text", text: `Image ${String(index + 1)}: raw` });
    input.push({ type: "local_image", path: raw });
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
  const expected = order.map((_, index) => index + 1).join(",");
  const ranked = [...response.ranking].sort((left, right) => left - right);

  if (ranked.join(",") !== expected) {
    throw new Error(
      `The judge must rank images ${expected} exactly once, without ties`,
    );
  }

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
      rank: response.ranking.indexOf(rating.image) + 1,
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

  return `You are judging literary character-art posters for a print shop. Judge each poster as a product by the rubric below. The user's rated examples illustrate the rubric; use them to understand what it means, not as answers to copy.

${rubric.trim()}

Book: ${image.item.book.title} by ${image.item.book.author}.
Intended scene, for context only: ${idea?.name ?? "unknown"}. ${idea?.composition ?? ""}

Judge only the rendered poster, the product someone would hang. The raw image is there to help you read the shapes; haze, soft or partial transparency, and blotches in the raw image do not count against a poster unless they show in the poster itself as holes, stray fragments, or ragged edges. Do not penalize a poster for departing from the intended scene; judge whether the poster is good and recognizably this book.

First rank all the images from best to worst in "ranking", using every image number exactly once with no ties; when two are close, decide anyway. Then give each image stars on the rubric's scale, any tags that clearly apply, a one-sentence note on what decided its place, and your confidence.`;
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
  file: "preview" | "native",
  width: number,
  path: string,
): Promise<void> {
  const files = image.result?.files as Record<string, string> | undefined;
  const relative = files?.[file];

  if (!relative) {
    throw new Error(`Image ${image.item.key} has no ${file} file`);
  }

  let background = "#ffffff";

  if (file === "native") {
    background = RAW_BACKGROUND;
  }

  await sharp(join(image.item.directory, relative))
    .resize({ width })
    .flatten({ background })
    .jpeg({ quality: 85 })
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
  // Run the whole check this many times to measure how stable the judge's
  // rankings are; nothing is averaged.
  repeat?: number;
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
  judge_rank: number;
  confidence: string;
  human_note: string;
  judge_note: string;
}

// Every judged image, rated by the user or not, for ranking prompts.
export interface RankedImage {
  round: string;
  row: string;
  prompt: string;
  rank: number;
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
    judge_mean_ranks: Record<string, number>;
  }[];
}

export interface JudgeCheckResult {
  directory: string;
  // The first run's summary.
  summary: JudgeCheckSummary;
  // Present when the check ran more than once.
  stability: StabilitySummary | null;
}

// Judges every rated round and compares the judge with the user. With repeat,
// each run goes in its own run-<n> directory, and stability.md compares them.
export async function runJudgeCheck(
  args: JudgeCheckArgs,
): Promise<JudgeCheckResult> {
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
  const repeat = args.repeat ?? 1;
  const runs: RunResult[] = [];

  for (let run = 1; run <= repeat; run++) {
    let runDirectory = directory;

    if (repeat > 1) {
      runDirectory = join(directory, `run-${String(run)}`);
      args.onProgress?.(`Run ${String(run)} of ${String(repeat)}`);
    }

    runs.push(
      await runOnce({ args, history, rounds, rubric, directory: runDirectory }),
    );
  }

  const first = runs[0];

  if (!first) {
    throw new Error("The judge check did not run");
  }

  let stability: StabilitySummary | null = null;

  if (runs.length > 1) {
    stability = stabilityAcross(runs.map((run) => run.ranked));
    await writeFile(
      join(directory, "stability.json"),
      JSON.stringify(stability, null, 2) + "\n",
    );
    await writeFile(
      join(directory, "stability.md"),
      stabilityReport(stability),
    );
  }

  return { directory, summary: first.summary, stability };
}

interface RunOnceArgs {
  args: JudgeCheckArgs;
  history: RoundHistory[];
  rounds: RoundHistory[];
  rubric: string;
  directory: string;
}

interface RunResult {
  summary: JudgeCheckSummary;
  ranked: RankedImage[];
}

async function runOnce(input: RunOnceArgs): Promise<RunResult> {
  const { args, history, rounds, rubric, directory } = input;
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
  const ranked: RankedImage[] = [];
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

      if (!image) {
        continue;
      }

      ranked.push({
        round: round.roundId,
        row: image.item.rowKey,
        prompt: image.item.promptId,
        rank: rating.rank,
      });

      const human = image.feedback?.stars;

      if (!human) {
        continue;
      }

      comparisons.push({
        round: round.roundId,
        key: rating.key,
        prompt: image.item.promptId,
        row: image.item.rowKey,
        human,
        judge: rating.stars,
        judge_rank: rating.rank,
        confidence: rating.confidence,
        human_note: image.feedback?.note ?? "",
        judge_note: rating.note,
      });
    }

    finished++;
    args.onProgress?.(`Judged ${String(finished)}/${String(rows.length)} rows`);
  });

  comparisons.sort((left, right) => left.key.localeCompare(right.key));
  ranked.sort((left, right) =>
    `${left.round}/${left.row}/${String(left.rank)}`.localeCompare(
      `${right.round}/${right.row}/${String(right.rank)}`,
    ),
  );

  const summary = summarize(comparisons, ranked);

  await writeFile(
    join(directory, "comparisons.jsonl"),
    comparisons.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  await writeFile(
    join(directory, "rankings.jsonl"),
    ranked.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  await writeFile(
    join(directory, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  await writeFile(join(directory, "report.md"), report(summary, comparisons));

  return { summary, ranked };
}

export interface StabilitySummary {
  runs: number;
  // Rows judged in every run.
  rows: number;
  // Share of rows whose full ranking was identical in every run.
  identical_rows: number;
  // Share of image pairs within a row ordered the same way in every run.
  pair_agreement: number;
  rounds: { round: string; winners: string[]; stable: boolean }[];
}

// How consistently repeated runs rank the same rows and pick the same winners.
export function stabilityAcross(runs: RankedImage[][]): StabilitySummary {
  const orders = runs.map((ranked) => rowOrders(ranked));
  const firstOrders = orders[0] ?? new Map<string, string[]>();
  let rows = 0;
  let identical = 0;
  let pairs = 0;
  let agreeing = 0;

  for (const [row, order] of firstOrders) {
    const others = orders.slice(1).map((entry) => entry.get(row));

    if (others.some((other) => !other)) {
      continue;
    }

    rows++;

    if (others.every((other) => other?.join(",") === order.join(","))) {
      identical++;
    }

    for (const [index, left] of order.entries()) {
      for (const right of order.slice(index + 1)) {
        pairs++;

        const same = others.every(
          (other) => (other?.indexOf(left) ?? 0) < (other?.indexOf(right) ?? 0),
        );

        if (same) {
          agreeing++;
        }
      }
    }
  }

  const roundIds = [
    ...new Set(runs.flatMap((ranked) => ranked.map((entry) => entry.round))),
  ].sort();

  return {
    runs: runs.length,
    rows,
    identical_rows: rows === 0 ? 0 : round3(identical / rows),
    pair_agreement: pairs === 0 ? 0 : round3(agreeing / pairs),
    rounds: roundIds.map((round) => {
      const winners = runs.map((ranked) => roundWinner(ranked, round));

      return {
        round,
        winners,
        stable: new Set(winners).size === 1,
      };
    }),
  };
}

// Prompt IDs per row, best first.
function rowOrders(ranked: RankedImage[]): Map<string, string[]> {
  const rows = new Map<string, RankedImage[]>();

  for (const entry of ranked) {
    const key = `${entry.round}/${entry.row}`;
    const group = rows.get(key) ?? [];
    group.push(entry);
    rows.set(key, group);
  }

  const orders = new Map<string, string[]>();

  for (const [key, group] of rows) {
    const sorted = [...group].sort((left, right) => left.rank - right.rank);
    orders.set(
      key,
      sorted.map((entry) => entry.prompt),
    );
  }

  return orders;
}

function roundWinner(ranked: RankedImage[], round: string): string {
  const ranks: Record<string, number[]> = {};

  for (const entry of ranked) {
    if (entry.round !== round) {
      continue;
    }

    ranks[entry.prompt] = [...(ranks[entry.prompt] ?? []), entry.rank];
  }

  const means: Record<string, number> = {};

  for (const [prompt, values] of Object.entries(ranks)) {
    means[prompt] = mean(values);
  }

  return lowest(means);
}

function stabilityReport(stability: StabilitySummary): string {
  const lines = [
    `# Judge stability (judge v${String(JUDGE_VERSION)}, ${String(stability.runs)} runs)`,
    "",
    `- Rows ranked identically in every run: ${percent(stability.identical_rows)} of ${String(stability.rows)}`,
    `- Image pairs in the same order in every run: ${percent(stability.pair_agreement)}`,
    "",
    "| Round | Winner per run | Stable |",
    "| --- | --- | --- |",
  ];

  for (const round of stability.rounds) {
    lines.push(
      `| ${round.round} | ${round.winners.join(", ")} | ${round.stable ? "yes" : "no"} |`,
    );
  }

  return lines.join("\n") + "\n";
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

export function summarize(
  comparisons: Comparison[],
  ranked: RankedImage[],
): JudgeCheckSummary {
  const humans = comparisons.map((entry) => entry.human);
  const judges = comparisons.map((entry) => entry.judge);
  const differences = comparisons.map((entry) =>
    Math.abs(entry.human - entry.judge),
  );

  // Within a row, for every pair the user rated differently, does the judge's
  // ranking put them in the same order? Its ranking has no ties.
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
      // A lower rank is better, so the order flips.
      const judgeOrder = Math.sign(right.judge_rank - left.judge_rank);

      if (judgeOrder === humanOrder) {
        agreement++;
      }
    }
  }

  const rounds = [...new Set(comparisons.map((entry) => entry.round))].map(
    (round) => {
      const entries = comparisons.filter((entry) => entry.round === round);
      const prompts = [...new Set(entries.map((entry) => entry.prompt))];
      const humanMeans: Record<string, number> = {};
      const judgeMeans: Record<string, number> = {};
      const judgeRanks: Record<string, number> = {};

      for (const prompt of prompts) {
        const own = entries.filter((entry) => entry.prompt === prompt);
        humanMeans[prompt] = round3(mean(own.map((entry) => entry.human)));
        judgeMeans[prompt] = round3(mean(own.map((entry) => entry.judge)));

        // Ranks cover every judged image in the round, rated by the user or not.
        const ranks = ranked
          .filter((entry) => entry.round === round && entry.prompt === prompt)
          .map((entry) => entry.rank);
        judgeRanks[prompt] = round3(mean(ranks));
      }

      return {
        round,
        human_winner: winner(humanMeans),
        judge_winner: lowest(judgeRanks),
        human_means: humanMeans,
        judge_means: judgeMeans,
        judge_mean_ranks: judgeRanks,
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

function lowest(values: Record<string, number>): string {
  let best = "";
  let bestValue = Infinity;

  for (const [prompt, value] of Object.entries(values)) {
    if (value < bestValue) {
      best = prompt;
      bestValue = value;
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
    `Compared on ${String(summary.rated_images)} images the user rated. The judge ranks each idea's images; a round's winner is the prompt with the best mean rank.`,
    "",
    `- Same order within a row: ${percent(summary.row_order_agreement)} of ${String(summary.row_pairs)} pairs the user rated differently`,
    `- Exact star match: ${percent(summary.exact)}`,
    `- Within one star: ${percent(summary.within_one)}`,
    `- Mean absolute error: ${summary.mean_absolute_error.toFixed(2)} stars`,
    `- Correlation with the user's stars: ${summary.correlation?.toFixed(2) ?? "n/a"}`,
    "",
    "## Round winners",
    "",
    "| Round | User's winner | Judge's winner | User mean stars | Judge mean rank (1 = best) |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const round of summary.rounds) {
    const format = (means: Record<string, number>): string =>
      Object.entries(means)
        .map(([prompt, value]) => `${prompt} ${value.toFixed(2)}`)
        .join(", ");

    lines.push(
      `| ${round.round} | ${round.human_winner} | ${round.judge_winner} | ${format(round.human_means)} | ${format(round.judge_mean_ranks)} |`,
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
