import sharp from "sharp";

import type { OutputTarget } from "../output-targets.ts";
import type { CharacterArt } from "./convert.ts";
import { rasterizeGlyphs, type RenderFont, type FontMetrics } from "./font.ts";

export const MINIMUM_FONT_POINTS = 6.5;
export const FONT_ASPECT_RATIO = 0.63;

export function targetLayout(
  source: Pick<CharacterArt, "width" | "height">,
  target: OutputTarget,
  metrics: FontMetrics,
): {
  fontSizePoints: number;
  fontSizePixels: number;
  cellWidth: number;
  cellHeight: number;
  baseline: number;
  gridWidth: number;
  gridHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  ppi: number;
} {
  const left = target.bleed_px.left + target.gutter_px.left;
  const top = target.bleed_px.top + target.gutter_px.top;
  const width =
    target.canvas_px.width -
    left -
    target.bleed_px.right -
    target.gutter_px.right;
  const height =
    target.canvas_px.height -
    top -
    target.bleed_px.bottom -
    target.gutter_px.bottom;

  if (target.canvas_px.width * target.canvas_px.height > 100_000_000) {
    throw new Error(
      `Target '${target.id}' exceeds the 100 megapixel render limit`,
    );
  }

  const ppiX =
    (target.canvas_px.width - target.bleed_px.left - target.bleed_px.right) /
    target.size_inches.width;
  const ppiY =
    (target.canvas_px.height - target.bleed_px.top - target.bleed_px.bottom) /
    target.size_inches.height;

  if (Math.abs(ppiX - ppiY) > 0.1 || ppiX < 1 || ppiX > 100_000) {
    throw new Error(
      `Target '${target.id}' requires matching horizontal and vertical print resolution`,
    );
  }

  const ppi = Math.round(ppiX);
  const fontSizePixels = (MINIMUM_FONT_POINTS * ppi) / 72;
  const cellWidth = Math.ceil(fontSizePixels * FONT_ASPECT_RATIO);
  const glyphHeight = fontSizePixels * (metrics.top - metrics.bottom);
  const cellHeight = Math.ceil(Math.max(fontSizePixels, glyphHeight));
  const baseline =
    metrics.top * fontSizePixels + (cellHeight - glyphHeight) / 2;
  const scale = Math.min(width / source.width, height / source.height);
  const gridWidth = Math.floor((source.width * scale) / cellWidth);
  const gridHeight = Math.floor((source.height * scale) / cellHeight);

  if (gridWidth < 1 || gridHeight < 1) {
    throw new Error(
      `Target '${target.id}' is too small for a ${String(MINIMUM_FONT_POINTS)} pt character grid`,
    );
  }

  return {
    fontSizePoints: MINIMUM_FONT_POINTS,
    fontSizePixels,
    cellWidth,
    cellHeight,
    baseline,
    gridWidth,
    gridHeight,
    left: left + Math.floor((width - gridWidth * cellWidth) / 2),
    top: top + Math.floor((height - gridHeight * cellHeight) / 2),
    width: gridWidth * cellWidth,
    height: gridHeight * cellHeight,
    ppi,
  };
}

function paintCell(
  canvas: Buffer,
  canvasWidth: number,
  left: number,
  top: number,
  mask: Buffer,
  cellWidth: number,
  color: Buffer,
  background: number[],
): void {
  for (let index = 0; index < mask.length; index++) {
    const coverage = (mask[index] ?? 0) / 255;

    if (coverage === 0) {
      continue;
    }

    const x = left + (index % cellWidth);
    const y = top + Math.floor(index / cellWidth);
    const offset = (y * canvasWidth + x) * 3;

    for (let channel = 0; channel < 3; channel++) {
      canvas[offset + channel] = Math.round(
        (color[channel] ?? 0) * coverage +
          (background[channel] ?? 0) * (1 - coverage),
      );
    }
  }
}

export async function renderPoster(
  art: CharacterArt,
  target: OutputTarget,
  font: RenderFont,
  layout: ReturnType<typeof targetLayout>,
  backgroundHex: string,
  signal?: AbortSignal,
): Promise<{ png: Buffer; layout: ReturnType<typeof targetLayout> }> {
  const background = [1, 3, 5].map((offset) =>
    Number.parseInt(backgroundHex.slice(offset, offset + 2), 16),
  );
  const { width, height } = target.canvas_px;
  const canvas = Buffer.alloc(width * height * 3);
  canvas.fill(Buffer.from(background));
  const glyphs = await rasterizeGlyphs(art.characters, font.font, layout);

  for (let pixel = 0; pixel < art.characterIndices.length; pixel++) {
    if (pixel % 65536 === 0) {
      await new Promise<void>((done) => setImmediate(done));
      signal?.throwIfAborted();
    }

    const characterIndex = art.characterIndices[pixel] ?? 0;

    if (characterIndex === 0) {
      continue;
    }

    const character = art.characters[characterIndex - 1];

    if (character === " ") {
      continue;
    }

    const mask = glyphs.get(character ?? "");

    if (!mask) {
      throw new Error("Missing rasterized character");
    }

    paintCell(
      canvas,
      width,
      layout.left + (pixel % art.width) * layout.cellWidth,
      layout.top + Math.floor(pixel / art.width) * layout.cellHeight,
      mask,
      layout.cellWidth,
      art.rgba.subarray(pixel * 4, pixel * 4 + 3),
      background,
    );
  }

  signal?.throwIfAborted();
  const png = await sharp(canvas, { raw: { width, height, channels: 3 } })
    .withMetadata({ density: layout.ppi })
    .png({ palette: false })
    .toBuffer();

  return { png, layout };
}
