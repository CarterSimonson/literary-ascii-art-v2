import { readFile, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { parse } from "yaml";

import { slugSchema } from "../ideas/schema.ts";
import {
  appendFeedback,
  FEEDBACK_TAGS,
  feedbackInputSchema,
  feedbackKey,
  readLatestFeedback,
} from "./feedback.ts";
import { readRoundFile, roundDirectory } from "./round.ts";

export interface StartPortalArgs {
  outputRoot: string;
  port: number;
}

const portalPage = new URL("./portal.html", import.meta.url);

// Serves the rating page on localhost. It reads rounds and writes only
// feedback.jsonl inside a round directory.
export function startPortal(
  args: StartPortalArgs,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: args.port,
    fetch: async (request): Promise<Response> => {
      try {
        return await route(request, args.outputRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return Response.json({ error: message }, { status: 400 });
      }
    },
  });
}

async function route(request: Request, outputRoot: string): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter((part) => part !== "");

  if (parts.length === 0) {
    return new Response(Bun.file(portalPage), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (parts[0] === "files" && parts.length >= 3) {
    return serveRoundFile(outputRoot, parts);
  }

  if (parts[0] !== "api" || parts[1] !== "rounds") {
    return new Response("Not found", { status: 404 });
  }

  if (parts.length === 2) {
    return Response.json(await listRounds(outputRoot));
  }

  const roundId = slugSchema.parse(parts[2]);
  const round = roundDirectory(outputRoot, roundId);

  if (parts.length === 3 && request.method === "GET") {
    return Response.json(await roundView(round));
  }

  if (parts[3] === "feedback" && request.method === "POST") {
    await saveFeedback(round, await request.json());

    return Response.json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
}

async function listRounds(outputRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(resolve(outputRoot, "evals", "rounds"));

    return entries
      .filter((entry) => !entry.startsWith("."))
      .sort()
      .reverse();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
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
