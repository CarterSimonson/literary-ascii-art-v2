import sharp from "sharp";

import type { OutputTarget } from "../output-targets.ts";
import {
  assignCharacters,
  decodeMaster,
  DEFAULT_SEPARATION_RADIUS,
  sampleGrid,
  separateColorCells,
} from "../render/convert.ts";
import {
  fontMetrics,
  loadRenderFont,
  supportedCharacters,
  type RenderFont,
} from "../render/font.ts";
import { renderPoster, targetLayout } from "../render/raster.ts";
import { normalizeRenderText } from "../render/text.ts";

const BACKGROUND = "#FFFFFF";

// Review previews are a third of the print size: 2400 × 3600 for 24 × 36.
const PREVIEW_SCALE = 1 / 3;

export interface BookGlyphs {
  font: RenderFont;
  characters: string[];
}

// Normalizing a whole book is slow, so rounds prepare it once per book.
export async function prepareBookGlyphs(bookText: string): Promise<BookGlyphs> {
  const font = await loadRenderFont();
  const normalized = normalizeRenderText(bookText);
  const supported = supportedCharacters(normalized, font.font);

  return { font, characters: supported.characters };
}

export interface RenderPreviewArgs {
  master: Buffer;
  glyphs: BookGlyphs;
  target: OutputTarget;
  signal?: AbortSignal;
}

// Renders the poster exactly as `bookgen render` does with default settings,
// then downsamples it for review. The print-size PNG is not kept.
export async function renderPreview(args: RenderPreviewArgs): Promise<Buffer> {
  const source = await decodeMaster(args.master);
  const metrics = fontMetrics(args.glyphs.characters, args.glyphs.font.font);
  const layout = targetLayout(source, args.target, metrics);

  const sampled = sampleGrid(source, layout.gridWidth, layout.gridHeight);
  const { grid } = separateColorCells(
    sampled,
    DEFAULT_SEPARATION_RADIUS,
    BACKGROUND,
  );
  const art = assignCharacters(grid, args.glyphs.characters, BACKGROUND);
  const poster = await renderPoster(
    art,
    args.target,
    args.glyphs.font,
    layout,
    BACKGROUND,
    args.signal,
  );

  return sharp(poster.png)
    .resize({
      width: Math.round(args.target.canvas_px.width * PREVIEW_SCALE),
      kernel: "lanczos3",
    })
    .png()
    .toBuffer();
}
