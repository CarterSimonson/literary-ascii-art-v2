import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

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
import { createJobRunner, type JobRunner } from "./jobs.ts";
import {
  listRoundIds,
  readRoundFile,
  roundDirectory,
  runRound,
  type RunRoundArgs,
} from "./round.ts";
import { loadSuite } from "./suite.ts";

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
}

export interface Portal {
  server: ReturnType<typeof Bun.serve>;
  jobs: JobRunner;
}

const portalPage = new URL("./portal.html", import.meta.url);

const nextRoundSchema = z.strictObject({
  direction: z.string().max(4000),
  newPrompts: z.number().int().min(1).max(4),
});

const replaceIdeaSchema = z.strictObject({
  book: slugSchema,
  idea: slugSchema,
  reason: z.string().max(2000),
});

// Serves the rating page on localhost. Besides feedback, it can run one
// background job at a time: the next round, retrying failures, or replacing an
// idea in the suite.
export function startPortal(args: StartPortalArgs): Portal {
  const jobs = createJobRunner();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: args.port,
    fetch: async (request): Promise<Response> => {
      try {
        return await route(request, args, jobs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return Response.json({ error: message }, { status: 400 });
      }
    },
  });

  return { server, jobs };
}

async function route(
  request: Request,
  args: StartPortalArgs,
  jobs: JobRunner,
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
    return serveRoundFile(args.outputRoot, parts);
  }

  if (parts[0] !== "api") {
    return new Response("Not found", { status: 404 });
  }

  if (parts[1] === "status") {
    return Response.json(jobs.status());
  }

  if (parts[1] === "next" && post) {
    const body = nextRoundSchema.parse(await request.json());
    jobs.start("next-round", async (report) => {
      report({
        message: "Prompt agent is reading feedback and writing prompts",
      });
      const planned = await planNextRound({
        outputRoot: args.outputRoot,
        direction: body.direction,
        newPrompts: body.newPrompts,
        ...suiteArgs(args),
        ...(args.writer ? { writer: args.writer } : {}),
      });

      return generate(args, planned.roundId, planned.promptsDirectory, report);
    });

    return Response.json(jobs.status());
  }

  if (parts[1] === "ideas" && parts[2] === "replace" && post) {
    const body = replaceIdeaSchema.parse(await request.json());
    jobs.start("replace-idea", async (report) => {
      report({ message: `Writing a new idea to replace ${body.idea}` });
      const idea = await replaceSuiteIdea({
        ...body,
        ...suiteArgs(args),
        ...(args.ideaGenerator ? { generate: args.ideaGenerator } : {}),
      });

      return `Replaced ${body.idea} with "${idea.name}"; it is used from the next round`;
    });

    return Response.json(jobs.status());
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

  if (parts[1] !== "rounds") {
    return new Response("Not found", { status: 404 });
  }

  if (parts.length === 2) {
    return Response.json((await listRoundIds(args.outputRoot)).reverse());
  }

  const roundId = slugSchema.parse(parts[2]);
  const round = roundDirectory(args.outputRoot, roundId);

  if (parts.length === 3 && request.method === "GET") {
    return Response.json(await roundView(round));
  }

  if (parts[3] === "feedback" && post) {
    await saveFeedback(round, await request.json());

    return Response.json({ ok: true });
  }

  if (parts[3] === "resume" && post) {
    jobs.start("retry-failed", async (report) =>
      generate(args, roundId, undefined, report),
    );

    return Response.json(jobs.status());
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

async function generate(
  args: StartPortalArgs,
  roundId: string,
  promptsDirectory: string | undefined,
  report: (update: { message: string; round?: string }) => void,
): Promise<string> {
  report({ message: `Generating ${roundId}`, round: roundId });

  const summary = await runRound({
    roundId,
    outputRoot: args.outputRoot,
    concurrency: args.concurrency ?? 3,
    timeoutSeconds: args.timeoutSeconds ?? 900,
    ...suiteArgs(args),
    ...(args.targetRegistry ? { targetRegistry: args.targetRegistry } : {}),
    ...(promptsDirectory ? { promptsDirectory } : {}),
    ...(args.generate ? { generate: args.generate } : {}),
    onProgress: (message) => {
      report({ message: `${roundId}: ${message}`, round: roundId });
    },
  });

  return `${roundId} finished: ${String(summary.done)} generated, ${String(summary.failed)} failed`;
}

async function serveRoundFile(
  outputRoot: string,
  parts: string[],
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

  return new Response(file);
}

// Everything the page needs for one round, keyed the same way as on disk.
async function roundView(round: string): Promise<Record<string, unknown>> {
  const roundFile = await readRoundFile(round);
  const feedback = await readLatestFeedback(round);

  const prompts = [];

  for (const prompt of roundFile.prompts) {
    prompts.push({
      id: prompt.id,
      text: await readFile(join(round, prompt.file), "utf8"),
    });
  }

  const images = [];

  for (const prompt of roundFile.prompts) {
    for (const entry of roundFile.cases) {
      const key = feedbackKey({ prompt: prompt.id, ...entry });
      const directory = join("images", prompt.id, entry.book, entry.idea);
      const result = await readResult(join(round, directory));

      images.push({
        key,
        prompt: prompt.id,
        book: entry.book,
        idea: entry.idea,
        directory,
        result,
        feedback: feedback.get(key) ?? null,
      });
    }
  }

  return {
    round: roundFile,
    notes: await readOptional(join(round, "prompts", "notes.md")),
    prompts,
    images,
    tags: FEEDBACK_TAGS,
  };
}

async function saveFeedback(round: string, body: unknown): Promise<void> {
  const input = feedbackInputSchema.parse(body);
  const directory = join(round, "images", input.prompt, input.book, input.idea);
  const result = await readResult(directory);

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
