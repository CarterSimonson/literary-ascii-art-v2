import { createHash } from "node:crypto";
import { appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Usage } from "@openai/codex-sdk";
import { stringify } from "yaml";
import packageJson from "../../package.json";
import { generateWithCodex, type IdeaGenerator } from "./codex.ts";
import { buildIdeasPrompt, PROMPT_VERSION } from "./prompt.ts";
import {
  parseIdeasResponse,
  IDEAS_SCHEMA_VERSION,
  requestSchema,
  type IdeasRequest,
} from "./schema.ts";

export interface RunOptions {
  generate?: IdeaGenerator;
  signal?: AbortSignal;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runIdeas(
  input: IdeasRequest,
  options: RunOptions = {},
): Promise<string> {
  const request = requestSchema.parse(input);
  const bookDirectory = resolve(request.outputRoot, request.slug);
  const lockPath = join(bookDirectory, ".ideas.lock");
  const traceDirectory = join(bookDirectory, "traces", "ideas");
  const artifactPath = join(bookDirectory, "ideas.yaml");
  const temporaryPath = join(bookDirectory, ".ideas.yaml.tmp");
  await mkdir(bookDirectory, { recursive: true });
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `An ideas run is already active for ${request.slug}. Lock: ${lockPath}`,
        { cause: error },
      );
    }
    throw error;
  }

  const startedAt = new Date().toISOString();
  const prompt = buildIdeasPrompt(request);
  const provenance = {
    prompt_version: PROMPT_VERSION,
    prompt_sha256: createHash("sha256").update(prompt).digest("hex"),
    bookgen_version: packageJson.version,
    sdk_version: packageJson.dependencies["@openai/codex-sdk"],
    requested_model: request.model ?? null,
    idea_count: request.ideaCount,
  };
  let threadId: string | null = null;
  let usage: Usage | null = null;
  let finalResponse = "";
  let completed = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new Error(
        `Codex timed out after ${String(request.timeoutSeconds)} seconds`,
      ),
    );
  }, request.timeoutSeconds * 1000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const runMetadata = (): object => ({
    schema_version: 1,
    book: {
      title: request.title,
      author: request.author ?? null,
      slug: request.slug,
    },
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ...provenance,
    timeout_seconds: request.timeoutSeconds,
    thread_id: threadId,
    usage,
  });

  try {
    await rm(traceDirectory, { recursive: true, force: true });
    await mkdir(traceDirectory, { recursive: true });
    await writeFile(join(traceDirectory, "prompt.txt"), prompt);
    await writeFile(join(traceDirectory, "events.jsonl"), "");
    await writeFile(
      join(traceDirectory, "run.json"),
      JSON.stringify(
        { ...runMetadata(), status: "running", finished_at: null },
        null,
        2,
      ) + "\n",
    );
    signal.throwIfAborted();
    const generate = options.generate ?? generateWithCodex;
    for await (const event of generate({
      prompt,
      model: request.model,
      ideaCount: request.ideaCount,
      signal,
    })) {
      signal.throwIfAborted();
      await appendFile(
        join(traceDirectory, "events.jsonl"),
        JSON.stringify(event) + "\n",
      );
      if (event.type === "thread.started") {
        threadId = event.thread_id;
      }
      if (event.type === "turn.completed") {
        completed = true;
        usage = event.usage;
      }
      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      ) {
        finalResponse = event.item.text;
        await writeFile(
          join(traceDirectory, "response.json"),
          finalResponse + "\n",
        );
      }
      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }
      if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    signal.throwIfAborted();
    if (!completed) {
      throw new Error("Codex stream ended without a completed turn");
    }
    const response = parseIdeasResponse(finalResponse, request.ideaCount);
    const artifact = {
      schema_version: IDEAS_SCHEMA_VERSION,
      book: {
        title: request.title,
        author: request.author ?? null,
        slug: request.slug,
      },
      generation: {
        generated_at: new Date().toISOString(),
        ...provenance,
        thread_id: threadId,
        usage,
      },
      ideas: response.ideas,
    };
    const yaml = stringify(artifact, { lineWidth: 80 });
    await writeFile(temporaryPath, yaml);
    await writeFile(
      join(traceDirectory, "run.json"),
      JSON.stringify(
        {
          ...runMetadata(),
          status: "completed",
          artifact: "ideas.yaml",
          artifact_sha256: createHash("sha256").update(yaml).digest("hex"),
        },
        null,
        2,
      ) + "\n",
    );
    await rename(temporaryPath, artifactPath);
    return artifactPath;
  } catch (error) {
    const failure = signal.aborted ? (signal.reason as unknown) : error;
    await mkdir(traceDirectory, { recursive: true });
    await writeFile(
      join(traceDirectory, "run.json"),
      JSON.stringify(
        { ...runMetadata(), status: "failed", error: errorMessage(failure) },
        null,
        2,
      ) + "\n",
    );
    throw new Error(
      `Ideas generation failed: ${errorMessage(failure)}. Trace: ${traceDirectory}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
    await rm(temporaryPath, { force: true });
    await rm(lockPath, { recursive: true, force: true });
  }
}
