import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { z } from "zod";
import { ideasResponseSchema } from "./schema.ts";

export interface GenerationInput {
  prompt: string;
  model: string | undefined;
  signal: AbortSignal;
}

export type IdeaGenerator = (
  input: GenerationInput,
) => AsyncIterable<ThreadEvent>;

export const generateWithCodex: IdeaGenerator = async function* (input) {
  const workingDirectory = await mkdtemp(join(tmpdir(), "bookgen-ideas-"));
  try {
    const codex = new Codex();
    const thread = codex.startThread({
      ...(input.model ? { model: input.model } : {}),
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      webSearchMode: "disabled",
    });
    const { events } = await thread.runStreamed(input.prompt, {
      outputSchema: z.toJSONSchema(ideasResponseSchema),
      signal: input.signal,
    });
    yield* events;
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
};
