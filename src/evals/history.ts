import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readLatestFeedback, type FeedbackRecord } from "./feedback.ts";
import {
  listRoundIds,
  loadRoundItems,
  readImageResult,
  readRoundFile,
  readVerified,
  roundDirectory,
  type RoundItem,
  type RoundKind,
} from "./round.ts";

// Every round with its templates, cells, results, and current human ratings,
// oldest first. Shared by the prompt agent and the AI judge.
export interface Template {
  id: string;
  sha256: string;
  template: string;
}

export interface ImageRecord {
  item: RoundItem;
  result: Record<string, unknown> | null;
  feedback: FeedbackRecord | null;
}

export interface RoundHistory {
  roundId: string;
  kind: RoundKind;
  notes: string;
  // The varied templates: image prompts or ideas prompts, by kind.
  prompts: Template[];
  imagePrompt: Template | null;
  images: ImageRecord[];
}

export async function loadHistory(
  outputRoot: string,
  suiteDirectory: string | undefined,
): Promise<RoundHistory[]> {
  const history: RoundHistory[] = [];

  for (const roundId of await listRoundIds(outputRoot)) {
    const round = roundDirectory(outputRoot, roundId);
    const roundFile = await readRoundFile(round);
    const feedback = await readLatestFeedback(round);

    const prompts: Template[] = [];

    for (const prompt of roundFile.prompts) {
      prompts.push({
        id: prompt.id,
        sha256: prompt.sha256,
        template: await readVerified(round, prompt),
      });
    }

    let imagePrompt: Template | null = null;

    if (roundFile.image_prompt) {
      imagePrompt = {
        id: roundFile.image_prompt.id,
        sha256: roundFile.image_prompt.sha256,
        template: await readVerified(round, roundFile.image_prompt),
      };
    }

    const images: ImageRecord[] = [];

    for (const item of await loadRoundItems(round, roundFile, suiteDirectory)) {
      const result = await readImageResult(item.directory);

      images.push({
        item,
        result: result,
        feedback: currentFeedback(feedback.get(item.key), result?.attempt),
      });
    }

    history.push({
      roundId,
      kind: roundFile.kind,
      notes: await readOptional(join(round, "prompts", "notes.md")),
      prompts,
      imagePrompt,
      images,
    });
  }

  return history;
}

// Ratings of an earlier attempt do not describe the current image.
function currentFeedback(
  record: FeedbackRecord | undefined,
  attempt: number | undefined,
): FeedbackRecord | null {
  if (!record || record.attempt !== attempt) {
    return null;
  }

  return record;
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}
