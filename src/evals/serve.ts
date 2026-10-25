import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import sharp from "sharp";
import { parse } from "yaml";
import { z } from "zod";

import type { IdeaGenerator } from "../ideas/codex.ts";
import { slugSchema } from "../ideas/schema.ts";
import type { ImageGenerator } from "../images/codex.ts";
import {
  appendFeedback,
  FEEDBACK_TAGS,
  feedbackInputSchema,
  feedbackKey,
  readLatestFeedback,
} from "./feedback.ts";
import { replaceSuiteIdea } from "./ideas.ts";
import { planNextRound, type PromptWriter } from "./improve.ts";
import { judgeRound, type Judge } from "./judge.ts";
import { readLatestJudgments } from "./judgments.ts";
import {
  listRoundIds,
  loadRoundItems,
  readRoundFile,
  readVerified,
  roundDirectory,
  runRound,
  type RunRoundArgs,
} from "./round.ts";
import { loadSuite } from "./suite.ts";
import { createTaskRunner, type TaskReport, type TaskRunner } from "./tasks.ts";

export interface StartPortalArgs {
  outputRoot: string;
  port: number;
  suiteDirectory?: string;
  registryPath?: string;
  targetRegistry?: string;
  concurrency?: number;
  timeoutSeconds?: number;
  // Injected in tests; Codex otherwise.
  writer?: PromptWriter;
  generate?: ImageGenerator;
  ideaGenerator?: IdeaGenerator;
  judge?: Judge;
  rubricPath?: string;
}

export interface Portal {
  server: ReturnType<typeof Bun.serve>;
  tasks: TaskRunner;
}

const portalPage = new URL("./portal.html", import.meta.url);

const nextRoundSchema = z.strictObject({
  kind: z.enum(["image", "idea"]),
  direction: z.string().max(4000),
  newPrompts: z.number().int().min(1).max(4),
});

const replaceIdeaSchema = z.strictObject({
  book: slugSchema,
  idea: slugSchema,
  reason: z.string().max(2000),
});

const regenerateSchema = z.strictObject({
  key: z.string().min(1).max(300),
});

// Serves the rating page on localhost. Besides feedback, it runs background
// tasks in parallel: next rounds, image regeneration, retries, and idea
// replacement.
export function startPortal(args: StartPortalArgs): Portal {
  const tasks = createTaskRunner();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: args.port,
    fetch: async (request): Promise<Response> => {
      try {
        return await route(request, args, tasks);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return Response.json({ error: message }, { status: 400 });
      }
    },
  });

  return { server, tasks };
}

async function route(
  request: Request,
  args: StartPortalArgs,
  tasks: TaskRunner,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter((part) => part !== "");
  const post = request.method === "POST";

  if (parts.length === 0) {
    return new Response(Bun.file(portalPage), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (parts[0] === "files" && parts.length >= 3) {
    return serveRoundFile(args.outputRoot, parts, url.searchParams.get("w"));
  }

  if (parts[0] !== "api") {
    return new Response("Not found", { status: 404 });
  }

  if (parts[1] === "tasks") {
    return Response.json(tasks.list());
  }

  if (parts[1] === "suite") {
    const suite = await loadSuite(suiteArgs(args));

    return Response.json(
      suite.cases.map((entry) => ({
        book: entry.book.slug,
        idea: entry.idea.id,
      })),
    );
  }

  if (parts[1] === "next" && post) {
    const body = nextRoundSchema.parse(await request.json());
    const task = tasks.start({
      kind: "next-round",
      key: "next-round",
      label: `Next ${body.kind} round`,
      run: async (report) => {
        report({ message: "Prompt agent is reading feedback" });
        const planned = await planNextRound({
          outputRoot: args.outputRoot,
          kind: body.kind,
          direction: body.direction,
          newPrompts: body.newPrompts,
          ...suiteArgs(args),
          ...(args.writer ? { writer: args.writer } : {}),
        });

        return generate(
          args,
          {
            roundId: planned.roundId,
            promptsDirectory: planned.promptsDirectory,
          },
          report,
        );
      },
    });

    return Response.json(task);
  }

  if (parts[1] === "ideas" && parts[2] === "replace" && post) {
    const body = replaceIdeaSchema.parse(await request.json());
    const task = tasks.start({
      kind: "replace-idea",
      key: `idea:${body.book}/${body.idea}`,
      label: `Replace ${body.idea}`,
      run: async (report) => {
        report({ message: "Writing a new idea" });
        const idea = await replaceSuiteIdea({
          ...body,
          ...suiteArgs(args),
          ...(args.ideaGenerator ? { generate: args.ideaGenerator } : {}),
        });

        return `Replaced with "${idea.name}" from the next round on`;
      },
    });

    return Response.json(task);
  }

  if (parts[1] !== "rounds") {
    return new Response("Not found", { status: 404 });
  }

  if (parts.length === 2) {
    return Response.json((await listRoundIds(args.outputRoot)).reverse());
  }

  const roundId = slugSchema.parse(parts[2]);
  const round = roundDirectory(args.outputRoot, roundId);

  if (parts.length === 3 && request.method === "GET") {
    return Response.json(await roundView(round, args));
  }

  if (parts[3] === "feedback" && post) {
    await saveFeedback(round, args, await request.json());

    return Response.json({ ok: true });
  }

  if (parts[3] === "regenerate" && post) {
    const body = regenerateSchema.parse(await request.json());
    const task = tasks.start({
      kind: "regenerate",
      key: `image:${roundId}/${body.key}`,
      label: `Regenerate ${body.key}`,
      run: async (report) => {
        // The judge ranks a row together, so the whole row is judged again.
        const roundFile = await readRoundFile(round);
        const items = await loadRoundItems(
          round,
          roundFile,
          args.suiteDirectory,
        );
        const rowKey = items.find((item) => item.key === body.key)?.rowKey;

        return generate(
          args,
          {
            roundId,
            only: [body.key],
            retry: [body.key],
            ...(rowKey ? { judgeRows: [rowKey] } : {}),
          },
          report,
        );
      },
    });

    return Response.json(task);
  }

  if (parts[3] === "judge" && post) {
    const task = tasks.start({
      kind: "judge",
      key: `judge:${roundId}`,
      label: `Judge ${roundId}`,
      run: async (report) => judge(args, roundId, undefined, report),
    });

    return Response.json(task);
  }

  if (parts[3] === "resume" && post) {
    const task = tasks.start({
      kind: "resume",
      key: `resume:${roundId}`,
      label: `Retry failed images in ${roundId}`,
      run: async (report) => generate(args, { roundId }, report),
    });

    return Response.json(task);
  }

  return new Response("Not found", { status: 404 });
}

function suiteArgs(
  args: StartPortalArgs,
): Pick<RunRoundArgs, "suiteDirectory" | "registryPath"> {
  return {
    ...(args.suiteDirectory ? { suiteDirectory: args.suiteDirectory } : {}),
    ...(args.registryPath ? { registryPath: args.registryPath } : {}),
  };
}

interface GenerateTarget {
  roundId: string;
  promptsDirectory?: string;
  only?: string[];
  retry?: string[];
  // Rows to judge again after generating; by default, rows not yet judged.
  judgeRows?: string[];
}

async function generate(
  args: StartPortalArgs,
  target: GenerateTarget,
  report: (update: TaskReport) => void,
): Promise<string> {
  report({ message: `Generating ${target.roundId}`, round: target.roundId });

  const summary = await runRound({
    roundId: target.roundId,
    outputRoot: args.outputRoot,
    concurrency: args.concurrency ?? 3,
    timeoutSeconds: args.timeoutSeconds ?? 900,
    ...suiteArgs(args),
    ...(args.targetRegistry ? { targetRegistry: args.targetRegistry } : {}),
    ...(target.promptsDirectory
      ? { promptsDirectory: target.promptsDirectory }
      : {}),
    ...(target.only ? { only: target.only } : {}),
    ...(target.retry ? { retry: target.retry } : {}),
    ...(args.generate ? { generate: args.generate } : {}),
    ...(args.ideaGenerator ? { generateIdeas: args.ideaGenerator } : {}),
    onProgress: (message) => {
      report({ message, round: target.roundId });
    },
  });

  const generated = `${target.roundId}: ${String(summary.done)} generated, ${String(summary.failed)} failed`;
  const judged = await judge(args, target.roundId, target.judgeRows, report);

  return `${generated}; ${judged}`;
}

// Ranks the round's rows with the AI judge once images exist.
async function judge(
  args: StartPortalArgs,
  roundId: string,
  rows: string[] | undefined,
  report: (update: TaskReport) => void,
): Promise<string> {
  const summary = await judgeRound({
    outputRoot: args.outputRoot,
    roundId,
    concurrency: args.concurrency ?? 3,
    ...(rows ? { rows } : {}),
    ...(args.suiteDirectory ? { suiteDirectory: args.suiteDirectory } : {}),
    ...(args.rubricPath ? { rubricPath: args.rubricPath } : {}),
    ...(args.judge ? { judge: args.judge } : {}),
    onProgress: (message) => {
      report({ message, round: roundId });
    },
  });

  // Generated images stay usable when judging fails; report it instead.
  if (summary.failed.length > 0) {
    return `judged ${String(summary.judged)} rows; judging failed for ${String(summary.failed.length)}: ${summary.failed.join("; ")}`;
  }

  return `judged ${String(summary.judged)} rows`;
}

// Resized copies for the page, keyed by path, size, and modification time.
const thumbnails = new Map<string, Uint8Array<ArrayBuffer>>();
const MAXIMUM_THUMBNAILS = 400;

async function serveRoundFile(
  outputRoot: string,
  parts: string[],
  width: string | null,
): Promise<Response> {
  const round = roundDirectory(outputRoot, parts[1] ?? "");
  const path = resolve(round, ...parts.slice(2).map(decodeURIComponent));

  // Only files inside the round directory are served.
  if (!path.startsWith(round + sep)) {
    return new Response("Not found", { status: 404 });
  }

  const file = Bun.file(path);

  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  if (width === null) {
    return new Response(file);
  }

  const pixels = z.coerce.number().int().min(64).max(1600).parse(width);
  const key = `${path}:${String(pixels)}:${String(file.lastModified)}`;
  let thumbnail = thumbnails.get(key);

  if (!thumbnail) {
    thumbnail = Uint8Array.from(
      await sharp(path)
        .resize({ width: pixels, withoutEnlargement: true })
        .png()
        .toBuffer(),
    );

    if (thumbnails.size >= MAXIMUM_THUMBNAILS) {
      thumbnails.clear();
    }

    thumbnails.set(key, thumbnail);
  }

  return new Response(thumbnail, {
    headers: { "content-type": "image/png", "cache-control": "max-age=3600" },
  });
}

// Everything the page needs for one round: rows of cells, each with its idea,
// result, and latest rating.
async function roundView(
  round: string,
  args: StartPortalArgs,
): Promise<Record<string, unknown>> {
  const roundFile = await readRoundFile(round);
  const feedback = await readLatestFeedback(round);
  const judgments = await readLatestJudgments(round);
  const items = await loadRoundItems(round, roundFile, args.suiteDirectory);

  const prompts = [];

  for (const prompt of roundFile.prompts) {
    prompts.push({ id: prompt.id, text: await readVerified(round, prompt) });
  }

  let imagePrompt: { id: string; text: string } | null = null;

  if (roundFile.image_prompt) {
    imagePrompt = {
      id: roundFile.image_prompt.id,
      text: await readVerified(round, roundFile.image_prompt),
    };
  }

  const cells = [];

  for (const item of items) {
    const result = await readResult(item.directory);
    let judgment = judgments.get(item.key) ?? null;

    // A judgment of an earlier attempt does not describe the current image.
    if (judgment && judgment.attempt !== Number(result?.attempt)) {
      judgment = null;
    }

    cells.push({
      key: item.key,
      prompt: item.promptId,
      row: item.rowKey,
      book: item.book,
      idea: item.idea,
      ideas_error: item.ideasError,
      directory: relative(round, item.directory),
      result,
      feedback: feedback.get(item.key) ?? null,
      judgment,
    });
  }

  return {
    round: {
      id: roundFile.round_id,
      kind: roundFile.kind,
      created_at: roundFile.created_at,
    },
    notes: await readOptional(join(round, "prompts", "notes.md")),
    prompts,
    image_prompt: imagePrompt,
    cells,
    tags: FEEDBACK_TAGS,
  };
}

async function saveFeedback(
  round: string,
  args: StartPortalArgs,
  body: unknown,
): Promise<void> {
  const input = feedbackInputSchema.parse(body);
  const roundFile = await readRoundFile(round);
  const items = await loadRoundItems(round, roundFile, args.suiteDirectory);
  const item = items.find((entry) => entry.key === feedbackKey(input));

  if (!item) {
    throw new Error(`Unknown image ${feedbackKey(input)}`);
  }

  const result = await readResult(item.directory);

  if (result?.status !== "done") {
    throw new Error("Only finished images can be rated");
  }

  await appendFeedback(round, {
    ...input,
    at: new Date().toISOString(),
    attempt: Number(result.attempt),
    master_sha256: String(result.master_sha256),
  });
}

async function readResult(
  directory: string,
): Promise<Record<string, unknown> | null> {
  const text = await readOptional(join(directory, "result.yaml"));

  if (text === null) {
    return null;
  }

  return parse(text) as Record<string, unknown>;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
