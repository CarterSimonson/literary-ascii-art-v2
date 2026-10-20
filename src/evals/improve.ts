import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Codex,
  type ThreadEvent,
  type Usage,
  type UserInput,
} from "@openai/codex-sdk";
import sharp from "sharp";
import { z } from "zod";

import {
  ART_GENERATION_MODEL,
  ART_GENERATION_REASONING_EFFORT,
} from "../generation-settings.ts";
import { slugSchema } from "../ideas/schema.ts";
import { fillImagePrompt } from "../images/prompt.ts";
import { readLatestFeedback, type FeedbackRecord } from "./feedback.ts";
import {
  listRoundIds,
  readImageResult,
  readRoundFile,
  roundDirectory,
} from "./round.ts";
import { loadSuite, type Suite } from "./suite.ts";

// Every template must still pass the idea in and keep the instructions the
// generation pipeline depends on (native tool, file handoff, JSON response).
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

// A prompt needs this many ratings before it can be carried forward as best.
const MINIMUM_RATINGS_FOR_BEST = 3;
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

export interface PromptWriterInput {
  input: UserInput[];
  signal: AbortSignal;
  onEvent: (event: ThreadEvent) => Promise<void>;
}

export interface PromptWriterOutput {
  response: string;
  usage: Usage | null;
}

export type PromptWriter = (
  input: PromptWriterInput,
) => Promise<PromptWriterOutput>;

export const writePromptsWithCodex: PromptWriter = async (input) => {
  const workingDirectory = await mkdtemp(join(tmpdir(), "bookgen-prompts-"));

  try {
    const codex = new Codex();
    const thread = codex.startThread({
      model: ART_GENERATION_MODEL,
      modelReasoningEffort: ART_GENERATION_REASONING_EFFORT,
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      webSearchMode: "disabled",
    });
    const { events } = await thread.runStreamed(input.input, {
      outputSchema: z.toJSONSchema(writerResponseSchema),
      signal: input.signal,
    });

    let response = "";
    let usage: Usage | null = null;
    let completed = false;

    for await (const event of events) {
      await input.onEvent(event);

      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }

      if (event.type === "error") {
        throw new Error(event.message);
      }

      if (event.type === "turn.completed") {
        completed = true;
        usage = event.usage;
      }

      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      ) {
        response = event.item.text;
      }
    }

    if (!completed) {
      throw new Error("Codex stream ended without a completed turn");
    }

    return { response, usage };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
};

export interface PlanNextRoundArgs {
  outputRoot: string;
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
// prompt so far is carried forward unchanged as the control.
export async function planNextRound(
  args: PlanNextRoundArgs,
): Promise<PlannedRound> {
  const suite = await loadSuite({
    ...(args.suiteDirectory ? { directory: args.suiteDirectory } : {}),
    ...(args.registryPath ? { registryPath: args.registryPath } : {}),
  });
  const history = await loadHistory(args.outputRoot);
  const latest = history.at(-1);

  if (!latest) {
    throw new Error("No rounds yet; run the first round with bookgen eval run");
  }

  const best = bestPrompt(history);

  if (!best) {
    throw new Error("Rate some images before starting the next round");
  }

  const roundId = nextRoundId(history);
  const agentDirectory = join(
    roundDirectory(args.outputRoot, roundId),
    "agent",
  );
  await rm(agentDirectory, { recursive: true, force: true });
  await mkdir(join(agentDirectory, "thumbnails"), { recursive: true });

  const text = writerBrief({ history, best, args });
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
  validatePrompts(response, best.id, suite);

  const promptsDirectory = join(agentDirectory, "prompts");
  await mkdir(promptsDirectory);
  await writeFile(
    join(promptsDirectory, `${best.id}.prompt.md`),
    best.template,
  );

  for (const prompt of response.prompts) {
    await writeFile(
      join(promptsDirectory, `${prompt.id}.prompt.md`),
      prompt.template,
    );
  }

  await writeFile(
    join(promptsDirectory, "notes.md"),
    roundNotes({ roundId, best, response, direction: args.direction }),
  );

  return { roundId, promptsDirectory };
}

interface ImageRecord {
  prompt: string;
  book: string;
  idea: string;
  name: string;
  result: Record<string, unknown> | null;
  feedback: FeedbackRecord | null;
  directory: string;
}

interface RoundHistory {
  roundId: string;
  notes: string;
  prompts: { id: string; sha256: string; template: string }[];
  images: ImageRecord[];
}

async function loadHistory(outputRoot: string): Promise<RoundHistory[]> {
  const history: RoundHistory[] = [];

  for (const roundId of await listRoundIds(outputRoot)) {
    const round = roundDirectory(outputRoot, roundId);
    const roundFile = await readRoundFile(round);
    const feedback = await readLatestFeedback(round);

    const prompts = [];

    for (const prompt of roundFile.prompts) {
      prompts.push({
        id: prompt.id,
        sha256: prompt.sha256,
        template: await readFile(join(round, prompt.file), "utf8"),
      });
    }

    const images: ImageRecord[] = [];

    for (const prompt of roundFile.prompts) {
      for (const entry of roundFile.cases) {
        const directory = join(
          round,
          "images",
          prompt.id,
          entry.book,
          entry.idea,
        );
        const result = await readImageResult(directory);
        const record = feedback.get(`${prompt.id}/${entry.book}/${entry.idea}`);

        images.push({
          prompt: prompt.id,
          book: entry.book,
          idea: entry.idea,
          name: entry.name,
          result,
          feedback: currentFeedback(record, result?.attempt),
          directory,
        });
      }
    }

    history.push({
      roundId,
      notes: await readOptional(join(round, "prompts", "notes.md")),
      prompts,
      images,
    });
  }

  return history;
}

// Ratings of an earlier attempt do not describe the current image.
function currentFeedback(
  record: FeedbackRecord | undefined,
  attempt: number | undefined,
): FeedbackRecord | null {
  if (!record || record.attempt !== attempt) {
    return null;
  }

  return record;
}

interface PooledPrompt {
  id: string;
  sha256: string;
  template: string;
  labels: string[];
  stars: number[];
  tags: Map<string, number>;
  failures: number;
}

// Pools ratings by template text, so a prompt carried across rounds keeps its
// whole record.
function poolPrompts(history: RoundHistory[]): PooledPrompt[] {
  const pooled = new Map<string, PooledPrompt>();

  for (const round of history) {
    for (const prompt of round.prompts) {
      let entry = pooled.get(prompt.sha256);

      if (!entry) {
        entry = {
          id: prompt.id,
          sha256: prompt.sha256,
          template: prompt.template,
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
        if (image.prompt !== prompt.id) {
          continue;
        }

        if (image.result?.status === "failed") {
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

function bestPrompt(history: RoundHistory[]): PooledPrompt | null {
  const rated = poolPrompts(history).filter((entry) => entry.stars.length > 0);
  const qualified = rated.filter(
    (entry) => entry.stars.length >= MINIMUM_RATINGS_FOR_BEST,
  );

  let candidates = qualified;

  if (candidates.length === 0) {
    candidates = rated;
  }

  let best: PooledPrompt | null = null;

  for (const entry of candidates) {
    if (!best || average(entry.stars) >= average(best.stars)) {
      best = entry;
    }
  }

  return best;
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
      `${image.prompt}--${image.book}--${image.idea}.jpg`,
    );
    await sharp(join(image.directory, files.preview))
      .resize({ width: THUMBNAIL_WIDTH })
      .jpeg({ quality: 75 })
      .toFile(path);

    thumbnails.push({
      caption: `Rendered poster: ${imageLabel(round.roundId, image)} — ${feedbackSummary(image.feedback)}`,
      path,
    });
  }

  return thumbnails;
}

function imageLabel(roundId: string, image: ImageRecord): string {
  return `${roundId}/${image.prompt} on ${image.book}/${image.idea} ("${image.name}")`;
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
  best: PooledPrompt;
  args: PlanNextRoundArgs;
}

function writerBrief(brief: WriterBriefArgs): string {
  const { history, best, args } = brief;
  const latest = history.at(-1);
  const pooled = poolPrompts(history).sort(
    (left, right) => average(right.stars) - average(left.stars),
  );
  const sections: string[] = [];

  sections.push(`You improve the image-generation prompt for a literary character-art poster pipeline. Each prompt template is sent to an image agent that generates one transparent PNG source master for a book idea. The master is cleaned (binary alpha, palette colors), then every opaque pixel becomes a monospaced character from the book on a 24 × 36 inch poster, and transparent pixels stay blank paper. The target look: one calm rectangular text field in one ink, one instantly readable iconic subject cut out of it as negative space, interior details as bold transparent channels, clean vector contours, and at most one accent ringed by a gap.

The user rates every image 1–5 stars with tags and notes. Your job is to read that feedback and write ${String(args.newPrompts)} new prompt template(s) that should score higher. The ideas are fixed; only the prompt changes. The best prompt so far (${best.labels.join(", ")}) is carried forward unchanged as the control, so do not resubmit it.`);

  sections.push(`Template rules:
- Templates are complete prompts using placeholders filled per idea: {{title}}, {{author}}, {{size}}, {{name}}, {{composition}}, {{literary_basis}}, {{conversion_resilience}}, {{palette}}. Include at least ${REQUIRED_PLACEHOLDERS.map((name) => `{{${name}}}`).join(", ")}. Any other {{...}} is an error.
- Keep the operational instructions from the control verbatim: native image tool use with transparent_background=true, saving the unmodified native PNG as master.png, the artwork_colors / review_notes / error JSON response, and the bans on programmatic drawing. Change the visual direction, not the plumbing.
- Each new template tests one clear hypothesis grounded in the ratings, tags, and notes. Make them meaningfully different from each other. If ratings have stalled across rounds, try a bolder change.
- Give each template a short, descriptive lowercase-hyphenated id that has not been used before (used so far: ${[...new Set(history.flatMap((round) => round.prompts.map((prompt) => prompt.id)))].join(", ")}).
- In analysis, summarize what the feedback says works and fails, in a few sentences.`);

  if (args.direction.trim() !== "") {
    sections.push(
      `Direction from the user for this round (highest priority):\n${args.direction.trim()}`,
    );
  }

  sections.push(
    "Prompt leaderboard (ratings pooled across rounds):\n" +
      pooled
        .map((entry) => {
          const tags = [...entry.tags.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([tag, count]) => `${tag}×${String(count)}`)
            .join(", ");

          return `- ${entry.labels.join(", ")}: ${average(entry.stars).toFixed(2)} stars from ${String(entry.stars.length)} ratings; failures ${String(entry.failures)}; tags: ${tags || "none"}`;
        })
        .join("\n"),
  );

  for (const round of history) {
    if (round.notes.trim() !== "") {
      sections.push(
        `Notes written for ${round.roundId}:\n${round.notes.trim().slice(0, 4000)}`,
      );
    }
  }

  if (latest) {
    sections.push(
      `Every image in ${latest.roundId}:\n` +
        latest.images
          .map((image) => imageLine(latest.roundId, image))
          .join("\n"),
    );

    for (const prompt of latest.prompts) {
      if (prompt.sha256 === best.sha256) {
        continue;
      }

      sections.push(
        `Template ${latest.roundId}/${prompt.id}:\n<<<\n${prompt.template}\n>>>`,
      );
    }
  }

  sections.push(
    `Control template (best so far, carried forward):\n<<<\n${best.template}\n>>>`,
  );
  sections.push(
    "Thumbnails of the latest round's rendered posters follow, each after its label.",
  );

  return sections.join("\n\n");
}

function imageLine(roundId: string, image: ImageRecord): string {
  const label = `- ${imageLabel(roundId, image)}`;

  if (!image.result) {
    return `${label}: not generated`;
  }

  if (image.result.status === "failed") {
    return `${label}: generation failed: ${String(image.result.error)}`;
  }

  const metrics = image.result.metrics as
    { native_haze: number; accent_contact: number | null } | undefined;
  const notes = (image.result.review_notes as string[] | undefined) ?? [];
  const parts = [feedbackSummary(image.feedback)];

  if (metrics) {
    parts.push(`native haze ${metrics.native_haze.toFixed(2)}`);

    if (metrics.accent_contact !== null) {
      parts.push(`accent contact ${metrics.accent_contact.toFixed(2)}`);
    }
  }

  if (notes.length > 0) {
    parts.push(`image agent notes: ${notes.join(" ").slice(0, 400)}`);
  }

  return `${label}: ${parts.join("; ")}`;
}

function validatePrompts(
  response: WriterResponse,
  controlId: string,
  suite: Suite,
): void {
  const ids = new Set<string>([controlId]);

  for (const prompt of response.prompts) {
    if (ids.has(prompt.id)) {
      throw new Error(`The prompt agent reused the id '${prompt.id}'`);
    }

    ids.add(prompt.id);

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

interface RoundNotesArgs {
  roundId: string;
  best: PooledPrompt;
  response: WriterResponse;
  direction: string;
}

function roundNotes(notes: RoundNotesArgs): string {
  const lines = [
    `# ${notes.roundId} prompts`,
    "",
    `Written by the prompt agent on ${new Date().toISOString()}.`,
  ];

  if (notes.direction.trim() !== "") {
    lines.push("", `Direction from the user: ${notes.direction.trim()}`);
  }

  lines.push(
    "",
    "## Analysis",
    "",
    notes.response.analysis.trim(),
    "",
    "## Prompts",
    "",
    `- ${notes.best.id} (control): best so far (${notes.best.labels.join(", ")}), ${average(notes.best.stars).toFixed(2)} stars from ${String(notes.best.stars.length)} ratings. Unchanged.`,
  );

  for (const prompt of notes.response.prompts) {
    lines.push(`- ${prompt.id}: ${prompt.hypothesis.trim()}`);
  }

  return lines.join("\n") + "\n";
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}
