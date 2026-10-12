import { Codex } from "@openai/codex-sdk";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  appendFile,
  readFile,
  realpath,
  copyFile,
} from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { save, json, exists, sha } from "./files";
export type AgentCall = {
  name: string;
  prompt: string;
  schema: z.ZodType;
  workspace: string;
  image?: boolean;
};
export interface Agent {
  run(call: AgentCall): Promise<unknown>;
}
export function subscriptionEnv(): Record<string, string> {
  const excluded = [
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "OPENAI_BASE_URL",
    "CODEX_BASE_URL",
    "CODEX_ACCESS_TOKEN",
  ];
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => v !== undefined && !excluded.includes(k),
    ),
  ) as Record<string, string>;
}
export function preflight() {
  const binary = process.env.LITERARY_CODEX_PATH || "codex";
  const status = spawnSync(binary, ["login", "status"], {
    env: subscriptionEnv(),
    encoding: "utf8",
  });
  if (
    status.status !== 0 ||
    !`${status.stdout}${status.stderr}`.includes("Logged in using ChatGPT")
  )
    throw new Error(
      "ChatGPT subscription login required. Run codex login; API-key authentication is not supported.",
    );
  const features = spawnSync(binary, ["features", "list"], {
    env: subscriptionEnv(),
    encoding: "utf8",
  });
  if (
    features.status !== 0 ||
    !/^image_generation\s+\S+\s+true$/m.test(features.stdout)
  )
    throw new Error(
      "Codex native image generation is unavailable. Update/configure Codex; there is no paid API fallback.",
    );
  const version = spawnSync(binary, ["--version"], {
    env: subscriptionEnv(),
    encoding: "utf8",
  });
  return {
    sdk: "0.162.1",
    cli: version.stdout.trim(),
    auth: "chatgpt",
    runtime: `bun ${Bun.version}`,
  };
}
export class CodexAgent implements Agent {
  private sdk: Codex;
  constructor() {
    this.sdk = new Codex({
      env: subscriptionEnv(),
      codexPathOverride:
        process.env.LITERARY_CODEX_PATH || Bun.which("codex") || undefined,
      config: { forced_login_method: "chatgpt", model_provider: "openai" },
    });
  }
  async run(call: AgentCall) {
    await mkdir(call.workspace, { recursive: true });
    const output = join(call.workspace, `${call.name}.json`);
    if (await exists(output)) {
      const record = await json<{ promptHash: string }>(
        join(call.workspace, `${call.name}.attempt.json`),
      );
      if (record.promptHash !== sha(call.prompt))
        throw new Error(
          `Cached ${call.name} prompt changed; create an explicit new revision.`,
        );
      return call.schema.parse(await json(output));
    }
    const attempt = join(call.workspace, `${call.name}.attempt.json`);
    if (await exists(attempt))
      throw new Error(
        `Incomplete agent attempt ${call.name}; inspect ${attempt} and events before removing it to explicitly retry. Successful stages remain cached.`,
      );
    const startedAt = new Date().toISOString();
    const start = Date.now();
    await save(attempt, {
      status: "running",
      promptHash: sha(call.prompt),
      startedAt,
    });
    await save(join(call.workspace, `${call.name}.request.json`), {
      prompt: call.prompt,
      outputSchema: z.toJSONSchema(call.schema),
    });
    const thread = this.sdk.startThread({
      workingDirectory: call.workspace,
      skipGitRepoCheck: true,
      sandboxMode: call.image ? "workspace-write" : "read-only",
      approvalPolicy: "never",
      webSearchMode: "disabled",
      modelReasoningEffort: "medium",
    });
    const { events } = await thread.runStreamed(call.prompt, {
      outputSchema: z.toJSONSchema(call.schema),
      signal: AbortSignal.timeout(call.image ? 600_000 : 300_000),
    });
    let final = "";
    let usage: unknown;
    let threadId: string | undefined;
    try {
      for await (const event of events) {
        await appendFile(
          join(call.workspace, `${call.name}.events.jsonl`),
          JSON.stringify(event) + "\n",
        );
        if (event.type === "thread.started") {
          threadId = event.thread_id;
          await save(attempt, {
            status: "running",
            startedAt,
            threadId,
            promptHash: sha(call.prompt),
          });
        }
        if (
          event.type === "item.completed" &&
          event.item.type === "agent_message"
        )
          final = event.item.text;
        if (event.type === "turn.completed") usage = event.usage;
        if (event.type === "turn.failed" || event.type === "error")
          throw new Error(
            event.type === "error" ? event.message : event.error.message,
          );
      }
      const value = call.schema.parse(JSON.parse(final));
      await save(output, value);
      await save(attempt, {
        status: "complete",
        startedAt,
        durationMs: Date.now() - start,
        threadId,
        usage,
        promptHash: sha(call.prompt),
      });
      return value;
    } catch (error) {
      await save(attempt, {
        status: "failed",
        startedAt,
        durationMs: Date.now() - start,
        threadId,
        error: String(error),
        usage,
        promptHash: sha(call.prompt),
      });
      throw error;
    }
  }
}
export const ImageOutput = z
  .object({ path: z.string(), success: z.boolean() })
  .strict();
export async function retainImage(source: string, destination: string) {
  const canonical = await realpath(source);
  const base = await realpath(
    resolve(
      process.env.CODEX_HOME || join(homedir(), ".codex"),
      "generated_images",
    ),
  );
  if (!canonical.startsWith(base + sep))
    throw new Error(
      "Image path must identify a generated_images artifact from the native Codex tool.",
    );
  const bytes = await readFile(canonical);
  if (bytes.length < 24) throw new Error("Codex artifact is truncated.");
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Codex artifact is not a PNG.");
  if (bytes.readUInt32BE(16) * 3 !== bytes.readUInt32BE(20) * 2)
    throw new Error(
      "Generated master must be 2:3 portrait; no stretching/cropping is applied silently.",
    );
  await copyFile(canonical, destination, 1);
  return { sha256: sha(bytes), bytes: bytes.length, source: canonical };
}
