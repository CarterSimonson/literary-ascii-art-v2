import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex, type ThreadEvent, type Usage } from "@openai/codex-sdk";
import { z } from "zod";
import {
  ART_GENERATION_MODEL,
  ART_GENERATION_REASONING_EFFORT,
} from "../generation-settings.ts";
import { imageResponseSchema } from "./schema.ts";

export interface ImageGenerationInput {
  prompt: string;
  model: string | undefined;
  signal: AbortSignal;
  onEvent: (event: ThreadEvent) => Promise<void>;
  onImage?: (png: Buffer) => Promise<void>;
}
export interface GeneratedImage {
  png: Buffer;
  artworkColors: string[];
  threadId: string | null;
  usage: Usage | null;
  reviewNotes?: string[];
}
export type ImageGenerator = (
  input: ImageGenerationInput,
) => Promise<GeneratedImage>;

export const generateImageWithCodex: ImageGenerator = async (input) => {
  const workingDirectory = await mkdtemp(join(tmpdir(), "bookgen-images-"));
  try {
    const codex = new Codex({
      config: { features: { image_generation: true } },
    });
    const thread = codex.startThread({
      model: input.model ?? ART_GENERATION_MODEL,
      modelReasoningEffort: ART_GENERATION_REASONING_EFFORT,
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      webSearchMode: "disabled",
    });
    const { events } = await thread.runStreamed(input.prompt, {
      outputSchema: z.toJSONSchema(imageResponseSchema),
      signal: input.signal,
    });
    let completed = false;
    let response = "";
    let usage: Usage | null = null;
    for await (const event of events) {
      input.signal.throwIfAborted();
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
    input.signal.throwIfAborted();
    if (!completed) {
      throw new Error("Codex stream ended without a completed turn");
    }
    const file = join(workingDirectory, "master.png");
    let png: Buffer | undefined;
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > 50 * 1024 * 1024) {
        throw new Error(
          "Codex must save a regular PNG file of at most 50 MiB as master.png",
        );
      }
      png = await readFile(file);
      await input.onImage?.(png);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
    const json: unknown = JSON.parse(response);
    const result = imageResponseSchema.parse(json);
    if (result.error !== null) {
      throw new Error(result.error);
    }
    if (!png) {
      throw new Error("Codex did not save master.png");
    }
    return {
      png,
      artworkColors: result.artwork_colors,
      reviewNotes: result.review_notes,
      threadId: thread.id,
      usage,
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
};
