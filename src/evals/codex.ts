import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Codex,
  type ThreadEvent,
  type Usage,
  type UserInput,
} from "@openai/codex-sdk";
import { z } from "zod";

import {
  ART_GENERATION_MODEL,
  ART_GENERATION_REASONING_EFFORT,
} from "../generation-settings.ts";

export interface StructuredRunInput {
  input: UserInput[];
  signal: AbortSignal;
  onEvent: (event: ThreadEvent) => Promise<void>;
}

export interface StructuredRunOutput {
  response: string;
  usage: Usage | null;
}

// One read-only Codex turn with text and local images in, JSON out. Injected
// as a fake in tests.
export type StructuredRunner = (
  input: StructuredRunInput,
) => Promise<StructuredRunOutput>;

export function codexStructuredRunner(schema: z.ZodType): StructuredRunner {
  return async (input) => {
    const workingDirectory = await mkdtemp(join(tmpdir(), "bookgen-evals-"));

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
        outputSchema: z.toJSONSchema(schema),
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
}
