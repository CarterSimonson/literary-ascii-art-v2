import type { OutputTarget } from "../output-targets.ts";
import {
  fontMetrics,
  loadRenderFont,
  supportedCharacters,
} from "../render/font.ts";
import { targetLayout } from "../render/raster.ts";
import { normalizeRenderText } from "../render/text.ts";
import type { GridSize } from "./metrics.ts";

// The eval suite's primary review target.
export const PRIMARY_TARGET_ID = "poster-24x36";

export interface CharacterGridArgs {
  master: GridSize;
  target: OutputTarget;
  bookText: string;
}

// Computes the working grid exactly as render does: cell height depends on the
// glyph bounds of the characters the book actually uses.
export async function characterGridSize(
  args: CharacterGridArgs,
): Promise<GridSize> {
  const font = await loadRenderFont();
  const normalized = normalizeRenderText(args.bookText);
  const supported = supportedCharacters(normalized, font.font);
  const metrics = fontMetrics(supported.characters, font.font);
  const layout = targetLayout(args.master, args.target, metrics);

  return { width: layout.gridWidth, height: layout.gridHeight };
}
