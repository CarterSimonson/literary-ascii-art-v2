import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateImageWithCodex, type ImageGenerator } from "./codex.ts";
import { buildImagePrompt } from "./prompt.ts";
import { processImage } from "./process.ts";
import type { Idea, ImagesRequest } from "./schema.ts";

export async function generateCandidate(
  request: ImagesRequest,
  idea: Idea,
  trace: string,
  options: { generate?: ImageGenerator; signal?: AbortSignal },
  previousFailure?: string,
): Promise<{
  image: Awaited<ReturnType<ImageGenerator>>;
  processed: Awaited<ReturnType<typeof processImage>>;
  prompt: string;
  colors: string[];
}> {
  await mkdir(trace, { recursive: true });
  const prompt =
    buildImagePrompt(request, idea) +
    (previousFailure
      ? `\nThis is the single replacement attempt. The previous candidate failed: ${previousFailure}. Correct that defect while preserving the concept and palette.\n`
      : "");
  await writeFile(join(trace, "prompt.txt"), prompt);
  await writeFile(join(trace, "events.jsonl"), "");
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new Error(
        `Image ${idea.id} timed out after ${String(request.timeoutSeconds)} seconds`,
      ),
    );
  }, request.timeoutSeconds * 1000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  try {
    signal.throwIfAborted();
    const image = await (options.generate ?? generateImageWithCodex)({
      prompt,
      model: request.model,
      signal,
      onEvent: async (event): Promise<void> => {
        await appendFile(
          join(trace, "events.jsonl"),
          JSON.stringify(event) + "\n",
        );
      },
      onImage: async (png): Promise<void> => {
        await writeFile(join(trace, "generated.png"), png);
      },
    });
    signal.throwIfAborted();
    await writeFile(join(trace, "generated.png"), image.png);
    const palette = new Set(
      idea.palette.map((entry) => entry.color.toUpperCase()),
    );
    const colors = [
      ...new Set(image.artworkColors.map((color) => color.toUpperCase())),
    ];
    await writeFile(
      join(trace, "response.json"),
      JSON.stringify(
        {
          artwork_colors: colors,
          review_notes: image.reviewNotes ?? [],
          thread_id: image.threadId,
          usage: image.usage,
        },
        null,
        2,
      ) + "\n",
    );
    if (colors.some((color) => !palette.has(color))) {
      throw new Error(
        `Image ${idea.id} selected colors outside its idea palette`,
      );
    }
    const processed = await processImage(
      image.png,
      colors,
      request.alphaThreshold,
    );
    signal.throwIfAborted();
    return { image, processed, prompt, colors };
  } catch (error) {
    throw signal.aborted ? signal.reason : error;
  } finally {
    clearTimeout(timer);
  }
}
