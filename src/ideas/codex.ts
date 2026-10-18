import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { z } from "zod";
import {
  ART_GENERATION_MODEL,
  ART_GENERATION_REASONING_EFFORT,
} from "../generation-settings.ts";
import { createIdeasResponseSchema } from "./schema.ts";

export interface GenerationInput {
  prompt: string;
  model: string | undefined;
  ideaCount: number;
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
      model: input.model ?? ART_GENERATION_MODEL,
      modelReasoningEffort: ART_GENERATION_REASONING_EFFORT,
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      webSearchMode: "disabled",
    });
    const { events } = await thread.runStreamed(input.prompt, {
      outputSchema: z.toJSONSchema(createIdeasResponseSchema(input.ideaCount)),
      signal: input.signal,
    });
    yield* events;
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
};
