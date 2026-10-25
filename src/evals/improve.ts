import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { UserInput } from "@openai/codex-sdk";
import sharp from "sharp";
import { z } from "zod";

import { fillIdeasPrompt, IDEAS_PROMPT_TEMPLATE } from "../ideas/prompt.ts";
import { slugSchema } from "../ideas/schema.ts";
import { fillImagePrompt, IMAGE_PROMPT_TEMPLATE } from "../images/prompt.ts";
import { codexStructuredRunner, type StructuredRunner } from "./codex.ts";
import type { FeedbackRecord } from "./feedback.ts";
import {
  loadHistory,
  type ImageRecord,
  type RoundHistory,
  type Template,
} from "./history.ts";
import { scoresSummary } from "./judgments.ts";
import {
  IDEAS_PER_BOOK,
  roundDirectory,
  sha256,
  type RoundItem,
  type RoundKind,
} from "./round.ts";
import { loadSuite, type Suite } from "./suite.ts";

// Every image template must still pass the idea in and keep the instructions
// the generation pipeline depends on (native tool, file handoff, JSON reply).
export const REQUIRED_PLACEHOLDERS = [
  "title",
  "author",
  "name",
  "composition",
  "literary_basis",
  "palette",
];
export const REQUIRED_PHRASES = [
  "transparent_background=true",
  "master.png",
  "artwork_colors",
  "review_notes",
];
export const REQUIRED_IDEAS_PLACEHOLDERS = ["book", "count"];

const THUMBNAIL_WIDTH = 400;

const writerResponseSchema = z.strictObject({
  analysis: z.string().min(1),
  prompts: z
    .array(
      z.strictObject({
        id: slugSchema,
        hypothesis: z.string().min(1),
        template: z.string().min(1),
      }),
    )
    .min(1)
    .max(5),
});

type WriterResponse = z.infer<typeof writerResponseSchema>;

export type PromptWriter = StructuredRunner;

export const writePromptsWithCodex: PromptWriter =
  codexStructuredRunner(writerResponseSchema);

export interface PlanNextRoundArgs {
  outputRoot: string;
  // "image" varies the image prompt over the suite ideas; "idea" varies the
  // ideas prompt and draws every new idea with the best image prompt.
  kind: RoundKind;
  // Free-text guidance from the user for this round; may be empty.
  direction: string;
  newPrompts: number;
  suiteDirectory?: string;
  registryPath?: string;
  writer?: PromptWriter;
  signal?: AbortSignal;
}

export interface PlannedRound {
  roundId: string;
  promptsDirectory: string;
}

// Reads every round and its feedback, asks the prompt agent for new templates,
// validates them, and writes the next round's prompt files. The best-rated
// template of that kind carries forward unchanged as the control.
export async function planNextRound(
  args: PlanNextRoundArgs,
): Promise<PlannedRound> {
  const suite = await loadSuite({
    ...(args.suiteDirectory ? { directory: args.suiteDirectory } : {}),
    ...(args.registryPath ? { registryPath: args.registryPath } : {}),
  });
  const history = await loadHistory(args.outputRoot, args.suiteDirectory);
  const latest = history.at(-1);

  if (!latest) {
    throw new Error("No rounds yet; run the first round with bookgen eval run");
  }

  const judgedOrRated = history.some((round) =>
    round.images.some((image) => image.feedback || image.judgment),
  );

  if (!judgedOrRated) {
    throw new Error("Rate or judge some images before starting the next round");
  }

  const bestImage = bestTemplate(history, "image") ?? committedImagePrompt();

  const bestIdeas = bestTemplate(history, "idea") ?? committedIdeasPrompt();
  let control = bestImage;

  if (args.kind === "idea") {
    control = bestIdeas;
  }

  const roundId = nextRoundId(history);
  const agentDirectory = join(
    roundDirectory(args.outputRoot, roundId),
    "agent",
  );
  await rm(agentDirectory, { recursive: true, force: true });
  await mkdir(join(agentDirectory, "thumbnails"), { recursive: true });

  const text = writerBrief({ history, control, bestImage, args });
  const thumbnails = await writeThumbnails(latest, agentDirectory);
  const input: UserInput[] = [{ type: "text", text }];

  for (const thumbnail of thumbnails) {
    input.push({ type: "text", text: thumbnail.caption });
    input.push({ type: "local_image", path: thumbnail.path });
  }

  await writeFile(join(agentDirectory, "request.md"), text);
  await writeFile(join(agentDirectory, "events.jsonl"), "");

  const writer = args.writer ?? writePromptsWithCodex;
  const output = await writer({
    input,
    signal: args.signal ?? new AbortController().signal,
    onEvent: async (event) => {
      await appendFile(
        join(agentDirectory, "events.jsonl"),
        JSON.stringify(event) + "\n",
      );
    },
  });
  await writeFile(
    join(agentDirectory, "response.json"),
    JSON.stringify({ response: output.response, usage: output.usage }, null, 2),
  );

  const response = writerResponseSchema.parse(JSON.parse(output.response));

  if (args.kind === "idea") {
    validateIdeasPrompts(response, control.id, suite);
  } else {
    validateImagePrompts(response, control.id, suite);
  }

  const promptsDirectory = join(agentDirectory, "prompts");
  await mkdir(promptsDirectory);

  let suffix = ".prompt.md";

  if (args.kind === "idea") {
    suffix = ".ideas.md";
    await writeFile(
      join(promptsDirectory, `${bestImage.id}.prompt.md`),
      bestImage.template,
    );
  }

  await writeFile(
    join(promptsDirectory, `${control.id}${suffix}`),
    control.template,
  );

  for (const prompt of response.prompts) {
    await writeFile(
      join(promptsDirectory, `${prompt.id}${suffix}`),
      prompt.template,
    );
  }

  await writeFile(
    join(promptsDirectory, "notes.md"),
    roundNotes({ roundId, control, bestImage, response, args }),
  );

  return { roundId, promptsDirectory };
}

interface PooledTemplate extends Template {
  labels: string[];
  stars: number[];
  tags: Map<string, number>;
  failures: number;
}

// Pools ratings by template text across rounds of one kind, so a template
// carried forward keeps its whole record.
function poolTemplates(
  history: RoundHistory[],
  kind: RoundKind,
): PooledTemplate[] {
  const pooled = new Map<string, PooledTemplate>();

  for (const round of history) {
    if (round.kind !== kind) {
      continue;
    }

    for (const prompt of round.prompts) {
      let entry = pooled.get(prompt.sha256);

      if (!entry) {
        entry = {
          ...prompt,
          labels: [],
          stars: [],
          tags: new Map(),
          failures: 0,
        };
        pooled.set(prompt.sha256, entry);
      }

      entry.id = prompt.id;
      entry.labels.push(`${round.roundId}/${prompt.id}`);

      for (const image of round.images) {
        if (image.item.promptId !== prompt.id) {
          continue;
        }

        if (image.result?.status === "failed" || image.item.ideasError) {
          entry.failures++;
        }

        if (image.feedback?.stars) {
          entry.stars.push(image.feedback.stars);
        }

        for (const tag of image.feedback?.tags ?? []) {
          entry.tags.set(tag, (entry.tags.get(tag) ?? 0) + 1);
        }
      }
    }
  }

  return [...pooled.values()];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// A variant replaces the current best only when its mean judge rank is at
// least this much better. Repeated judge runs showed smaller gaps can flip.
export const REPLACE_MARGIN = 0.4;

// Each round carries the best prompt so far forward as its control, and each
// round's results decide whether a variant takes over (see `successor`).
function bestTemplate(
  history: RoundHistory[],
  kind: RoundKind,
): PooledTemplate | null {
  const pooled = poolTemplates(history, kind);
  let best: PooledTemplate | null = null;

  for (const round of history) {
    if (round.kind !== kind) {
      continue;
    }

    const incumbent = round.prompts.find(
      (prompt) => prompt.sha256 === best?.sha256,
    );
    const next = successor(roundResults(round), incumbent?.id);
    const prompt = round.prompts.find((entry) => entry.id === next);
    const entry = pooled.find((item) => item.sha256 === prompt?.sha256);

    if (entry) {
      best = entry;
    }
  }

  return best;
}

// The best prompt after a round. With judge ranks for every prompt, a variant
// takes over only by beating the incumbent's mean rank by REPLACE_MARGIN.
// Otherwise the user's mean stars decide, and a tie keeps the incumbent.
// Without an incumbent in the round, the best result wins outright.
export function successor(
  results: PromptResult[],
  incumbentId: string | undefined,
): string | null {
  const judged = results.every((result) => result.meanRank !== null);
  const scored: { prompt: string; value: number }[] = [];

  for (const result of results) {
    if (judged && result.meanRank !== null) {
      scored.push({ prompt: result.prompt, value: result.meanRank });
    } else if (!judged && result.meanStars !== null) {
      // Higher stars are better; negate so lower is better for both.
      scored.push({ prompt: result.prompt, value: -result.meanStars });
    }
  }

  if (scored.length === 0) {
    return incumbentId ?? null;
  }

  const challenger = scored.reduce((best, entry) => {
    if (entry.value < best.value) {
      return entry;
    }

    return best;
  });
  const incumbent = scored.find((entry) => entry.prompt === incumbentId);

  if (!incumbent) {
    return challenger.prompt;
  }

  let margin = 0;

  if (judged) {
    margin = REPLACE_MARGIN;
  }

  // Small tolerance so a gap of exactly the margin counts.
  if (
    incumbent.value - challenger.value >= margin - 1e-9 &&
    challenger.value < incumbent.value
  ) {
    return challenger.prompt;
  }

  return incumbent.prompt;
}

export interface PromptResult {
  prompt: string;
  meanRank: number | null;
  judged: number;
  meanStars: number | null;
  rated: number;
}

function roundResults(round: RoundHistory): PromptResult[] {
  return round.prompts.map((prompt) => {
    const images = round.images.filter(
      (image) => image.item.promptId === prompt.id,
    );
    const ranks = images.flatMap((image) =>
      image.judgment ? [image.judgment.rank] : [],
    );
    const stars = images.flatMap((image) =>
      image.feedback?.stars ? [image.feedback.stars] : [],
    );

    return {
      prompt: prompt.id,
      meanRank: ranks.length > 0 ? average(ranks) : null,
      judged: ranks.length,
      meanStars: stars.length > 0 ? average(stars) : null,
      rated: stars.length,
    };
  });
}

function committed(
  id: string,
  template: string,
  label: string,
): PooledTemplate {
  return {
    id,
    sha256: sha256(template),
    template,
    labels: [label],
    stars: [],
    tags: new Map(),
    failures: 0,
  };
}

function committedImagePrompt(): PooledTemplate {
  return committed(
    "current-image",
    IMAGE_PROMPT_TEMPLATE,
    "committed image prompt",
  );
}

function committedIdeasPrompt(): PooledTemplate {
  return committed(
    "current-ideas",
    IDEAS_PROMPT_TEMPLATE,
    "committed ideas prompt",
  );
}

function nextRoundId(history: RoundHistory[]): string {
  let highest = 0;

  for (const round of history) {
    const match = /^round-(\d+)$/.exec(round.roundId);

    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }

  return `round-${String(highest + 1)}`;
}

interface Thumbnail {
  caption: string;
  path: string;
}

async function writeThumbnails(
  round: RoundHistory,
  agentDirectory: string,
): Promise<Thumbnail[]> {
  const thumbnails: Thumbnail[] = [];

  for (const image of round.images) {
    const files = image.result?.files as Record<string, string> | undefined;

    if (image.result?.status !== "done" || !files?.preview) {
      continue;
    }

    const path = join(
      agentDirectory,
      "thumbnails",
      `${image.item.key.replaceAll("/", "--")}.jpg`,
    );
    await sharp(join(image.item.directory, files.preview))
      .resize({ width: THUMBNAIL_WIDTH })
      .jpeg({ quality: 75 })
      .toFile(path);

    thumbnails.push({
      caption: `Rendered poster: ${imageLabel(round.roundId, image.item)} — ${feedbackSummary(image.feedback)}; ${judgmentSummary(image)}`,
      path,
    });
  }

  return thumbnails;
}

function imageLabel(roundId: string, item: RoundItem): string {
  const name = item.idea?.name ?? "no idea";

  return `${roundId}/${item.promptId} on ${item.book.slug} "${name}"`;
}

function feedbackSummary(feedback: FeedbackRecord | null): string {
  if (!feedback) {
    return "not rated";
  }

  const parts: string[] = [];

  if (feedback.stars) {
    parts.push(`${String(feedback.stars)}/5 stars`);
  }

  if (feedback.tags.length > 0) {
    parts.push(`tags: ${feedback.tags.join(", ")}`);
  }

  if (feedback.note.trim() !== "") {
    parts.push(`note: "${feedback.note.trim()}"`);
  }

  if (parts.length === 0) {
    return "not rated";
  }

  return parts.join("; ");
}

interface WriterBriefArgs {
  history: RoundHistory[];
  control: PooledTemplate;
  bestImage: PooledTemplate;
  args: PlanNextRoundArgs;
}

const PIPELINE_SUMMARY = `This is a literary character-art poster pipeline. An ideas prompt asks an agent for poster composition ideas for a book. An image prompt turns each idea into one transparent PNG source master. The master is cleaned (binary alpha, palette colors), then every opaque pixel becomes a monospaced character from the book on a 24 × 36 inch poster, and transparent pixels stay blank paper. The target look: one calm rectangular text field in one ink, one instantly readable iconic subject cut out of it as negative space, interior details as bold transparent channels, clean vector contours, and at most one accent ringed by a gap.

An AI judge ranks every rendered poster within its idea and rates it 1–5 stars with a note; the user spot-checks some images with their own stars, tags, and notes, which outweigh the judge where they disagree.`;

function writerBrief(brief: WriterBriefArgs): string {
  const { history, control, bestImage, args } = brief;
  const latest = history.at(-1);
  const sections: string[] = [PIPELINE_SUMMARY];

  if (args.kind === "idea") {
    sections.push(ideasTask(history, control, bestImage, args.newPrompts));
  } else {
    sections.push(imageTask(history, control, args.newPrompts));
  }

  if (args.direction.trim() !== "") {
    sections.push(
      `Direction from the user for this round (highest priority):\n${args.direction.trim()}`,
    );
  }

  sections.push(leaderboard(history, "image", "Image prompt leaderboard"));
  sections.push(leaderboard(history, "idea", "Ideas prompt leaderboard"));

  for (const round of history) {
    if (round.notes.trim() !== "") {
      sections.push(
        `Notes written for ${round.roundId} (${round.kind} round):\n${round.notes.trim().slice(0, 4000)}`,
      );
    }
  }

  if (latest) {
    sections.push(
      `Every image in ${latest.roundId} (${latest.kind} round):\n` +
        latest.images
          .map((image) => imageLine(latest.roundId, image))
          .join("\n"),
    );

    const sameKind = [...history]
      .reverse()
      .find((round) => round.kind === args.kind);

    for (const prompt of sameKind?.prompts ?? []) {
      if (prompt.sha256 === control.sha256) {
        continue;
      }

      sections.push(
        `Template ${sameKind?.roundId ?? ""}/${prompt.id}:\n<<<\n${prompt.template}\n>>>`,
      );
    }
  }

  sections.push(
    `Control template (best so far, carried forward):\n<<<\n${control.template}\n>>>`,
  );
  sections.push(
    "Thumbnails of the latest round's rendered posters follow, each after its label.",
  );

  return sections.join("\n\n");
}

function usedIds(history: RoundHistory[], kind: RoundKind): string {
  const ids = history
    .filter((round) => round.kind === kind)
    .flatMap((round) => round.prompts.map((prompt) => prompt.id));

  return [...new Set(ids)].join(", ") || "none";
}

function imageTask(
  history: RoundHistory[],
  control: PooledTemplate,
  count: number,
): string {
  return `Your job: write ${String(count)} new IMAGE prompt template(s) that should score higher. The ideas are fixed; only the image prompt changes. The best image prompt so far (${control.labels.join(", ")}) is carried forward unchanged as the control, so do not resubmit it. A variant replaces the control only when its mean judge rank beats the control's by at least ${String(REPLACE_MARGIN)}, so aim for clearly better results, not marginal ones.

Template rules:
- Templates are complete prompts using placeholders filled per idea: {{title}}, {{author}}, {{size}}, {{name}}, {{composition}}, {{literary_basis}}, {{conversion_resilience}}, {{palette}}. Include at least ${REQUIRED_PLACEHOLDERS.map((name) => `{{${name}}}`).join(", ")}. Any other {{...}} is an error.
- Keep the operational instructions from the control verbatim: native image tool use with transparent_background=true, saving the unmodified native PNG as master.png, the artwork_colors / review_notes / error JSON response, and the bans on programmatic drawing. Change the visual direction, not the plumbing.
- Each new template tests one clear hypothesis grounded in the ratings, tags, and notes. Make them meaningfully different from each other. If ratings have stalled across rounds, try a bolder change.
- Give each template a short, descriptive lowercase-hyphenated id not used before (used: ${usedIds(history, "image")}).
- In analysis, summarize what the feedback says works and fails, in a few sentences.`;
}

function ideasTask(
  history: RoundHistory[],
  control: PooledTemplate,
  bestImage: PooledTemplate,
  count: number,
): string {
  return `Your job: write ${String(count)} new IDEAS prompt template(s) whose ideas should become higher-rated posters. Each template asks for ${String(IDEAS_PER_BOOK)} ideas per book; every idea is then drawn with one fixed image prompt (${bestImage.labels.join(", ")}), so differences in ratings come from the ideas. The best ideas prompt so far (${control.labels.join(", ")}) is carried forward unchanged as the control, so do not resubmit it. A variant replaces the control only when its mean judge rank beats the control's by at least ${String(REPLACE_MARGIN)}, so aim for clearly better ideas, not marginal ones.

Template rules:
- Templates are complete prompts using {{book}} (the book's title and author as JSON) and {{count}} (how many ideas to return). Both are required; any other {{...}} is an error.
- The response format is enforced separately: each idea has id, name, composition, literary_basis, palette (at most three hex colors with uses), and conversion_resilience. Keep asking for those fields.
- Think about which subjects survive as one clean silhouette rebuilt from text, and which pull the image model into shading or clutter (organic textures, smoke, machinery, crowds). Use the ratings to tell good subjects from bad ones.
- Each new template tests one clear hypothesis grounded in the ratings and notes. Make them meaningfully different from each other.
- Give each template a short, descriptive lowercase-hyphenated id not used before (used: ${usedIds(history, "idea")}).
- In analysis, summarize what the feedback says about the ideas themselves, in a few sentences.`;
}

function leaderboard(
  history: RoundHistory[],
  kind: RoundKind,
  title: string,
): string {
  const rounds = history.filter((round) => round.kind === kind);

  if (rounds.length === 0) {
    return `${title}: no ${kind} rounds yet.`;
  }

  const lines = rounds.map((round) => {
    const results = roundResults(round).map((result) => {
      const parts: string[] = [];

      if (result.meanRank !== null) {
        parts.push(
          `judge mean rank ${result.meanRank.toFixed(2)} over ${String(result.judged)}`,
        );
      }

      if (result.meanStars !== null) {
        parts.push(
          `user ${result.meanStars.toFixed(2)} stars over ${String(result.rated)}`,
        );
      }

      return `${result.prompt} (${parts.join("; ") || "no results"})`;
    });

    return `- ${round.roundId}: ${results.join(", ")}`;
  });

  return `${title} (judge ranks are within each idea, 1 = best; the user spot-checks some images):\n${lines.join("\n")}`;
}

function judgmentSummary(image: ImageRecord): string {
  const judgment = image.judgment;

  if (!judgment) {
    return "not judged";
  }

  return `judge: rank ${String(judgment.rank)} in its idea, ${String(judgment.stars)}/5 (${scoresSummary(judgment.scores)}), "${judgment.note}"`;
}

function imageLine(roundId: string, image: ImageRecord): string {
  const label = `- ${imageLabel(roundId, image.item)}`;
  const composition = image.item.idea?.composition.slice(0, 240) ?? "";
  const ideaText = ` [idea: ${composition}]`;

  if (image.item.ideasError) {
    return `${label}: idea writing failed: ${image.item.ideasError}`;
  }

  if (!image.result) {
    return `${label}: not generated${ideaText}`;
  }

  if (image.result.status === "failed") {
    return `${label}: generation failed: ${String(image.result.error)}${ideaText}`;
  }

  const metrics = image.result.metrics as
    { native_haze: number; accent_contact: number | null } | undefined;
  const notes = (image.result.review_notes as string[] | undefined) ?? [];
  const parts = [
    `user: ${feedbackSummary(image.feedback)}`,
    judgmentSummary(image),
  ];

  if (metrics) {
    parts.push(`native haze ${metrics.native_haze.toFixed(2)}`);

    if (metrics.accent_contact !== null) {
      parts.push(`accent contact ${metrics.accent_contact.toFixed(2)}`);
    }
  }

  if (notes.length > 0) {
    parts.push(`image agent notes: ${notes.join(" ").slice(0, 300)}`);
  }

  return `${label}: ${parts.join("; ")}${ideaText}`;
}

function checkIds(response: WriterResponse, controlId: string): void {
  const ids = new Set<string>([controlId]);

  for (const prompt of response.prompts) {
    if (ids.has(prompt.id)) {
      throw new Error(`The prompt agent reused the id '${prompt.id}'`);
    }

    ids.add(prompt.id);
  }
}

function validateImagePrompts(
  response: WriterResponse,
  controlId: string,
  suite: Suite,
): void {
  checkIds(response, controlId);

  for (const prompt of response.prompts) {
    for (const name of REQUIRED_PLACEHOLDERS) {
      if (!prompt.template.includes(`{{${name}}}`)) {
        throw new Error(`Prompt '${prompt.id}' is missing {{${name}}}`);
      }
    }

    for (const phrase of REQUIRED_PHRASES) {
      if (!prompt.template.includes(phrase)) {
        throw new Error(
          `Prompt '${prompt.id}' dropped the required instruction '${phrase}'`,
        );
      }
    }

    for (const suiteCase of suite.cases) {
      fillImagePrompt(
        prompt.template,
        {
          title: suiteCase.book.title,
          author: suiteCase.book.author,
          size: "1024x1536",
        },
        suiteCase.idea,
      );
    }
  }
}

function validateIdeasPrompts(
  response: WriterResponse,
  controlId: string,
  suite: Suite,
): void {
  checkIds(response, controlId);

  for (const prompt of response.prompts) {
    for (const name of REQUIRED_IDEAS_PLACEHOLDERS) {
      if (!prompt.template.includes(`{{${name}}}`)) {
        throw new Error(`Ideas prompt '${prompt.id}' is missing {{${name}}}`);
      }
    }

    for (const suiteCase of suite.cases) {
      fillIdeasPrompt(prompt.template, {
        title: suiteCase.book.title,
        author: suiteCase.book.author,
        count: IDEAS_PER_BOOK,
      });
    }
  }
}

interface RoundNotesArgs {
  roundId: string;
  control: PooledTemplate;
  bestImage: PooledTemplate;
  response: WriterResponse;
  args: PlanNextRoundArgs;
}

function roundNotes(notes: RoundNotesArgs): string {
  const lines = [
    `# ${notes.roundId} prompts (${notes.args.kind} round)`,
    "",
    `Written by the prompt agent on ${new Date().toISOString()}.`,
  ];

  if (notes.args.direction.trim() !== "") {
    lines.push("", `Direction from the user: ${notes.args.direction.trim()}`);
  }

  if (notes.args.kind === "idea") {
    lines.push(
      "",
      `Every idea is drawn with the image prompt ${notes.bestImage.id} (${notes.bestImage.labels.join(", ")}).`,
    );
  }

  lines.push(
    "",
    "## Analysis",
    "",
    notes.response.analysis.trim(),
    "",
    "## Prompts",
    "",
    `- ${notes.control.id} (control): best so far (${notes.control.labels.join(", ")}), carried forward unchanged.`,
  );

  for (const prompt of notes.response.prompts) {
    lines.push(`- ${prompt.id}: ${prompt.hypothesis.trim()}`);
  }

  return lines.join("\n") + "\n";
}
