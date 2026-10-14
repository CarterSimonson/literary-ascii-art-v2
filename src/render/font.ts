import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse, type Font } from "opentype.js";
import sharp from "sharp";

export interface RenderFont {
  font: Font;
  sha256: string;
  name: string;
}

export async function loadRenderFont(): Promise<RenderFont> {
  const path = new URL(
    import.meta
      .resolve("@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff"),
  );
  const bytes = await readFile(path);
  const font = parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );

  return {
    font,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    name: "Roboto Mono Latin Bold 700",
  };
}

export function supportedCharacters(
  characters: string[],
  font: Font,
): {
  characters: string[];
  replacements: string[];
} {
  const replacements = new Set<string>();

  for (const character of new Set(characters)) {
    if (character === " ") {
      continue;
    }

    const glyph = font.charToGlyph(character);

    if (glyph.index === 0 || glyph.path.commands.length === 0) {
      replacements.add(character);
    }
  }

  const supported = characters.map((character) => {
    if (replacements.has(character)) {
      return "?";
    }

    return character;
  });

  return { characters: supported, replacements: [...replacements] };
}

export interface FontMetrics {
  top: number;
  bottom: number;
}

export function fontMetrics(characters: string[], font: Font): FontMetrics {
  const bounds = [...new Set(characters)]
    .filter((character) => character !== " ")
    .map((character) => font.charToGlyph(character).getBoundingBox());
  return {
    top: Math.max(...bounds.map((box) => box.y2)) / font.unitsPerEm,
    bottom: Math.min(...bounds.map((box) => box.y1)) / font.unitsPerEm,
  };
}

export async function rasterizeGlyphs(
  characters: string[],
  font: Font,
  layout: {
    cellWidth: number;
    cellHeight: number;
    fontSizePixels: number;
    baseline: number;
  },
): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const { cellWidth, cellHeight, fontSizePixels, baseline } = layout;

  for (const character of new Set(characters)) {
    const glyph = font.charToGlyph(character);
    const advance =
      ((glyph.advanceWidth ?? font.unitsPerEm) * fontSizePixels) /
      font.unitsPerEm;
    const path = glyph
      .getPath((cellWidth - advance) / 2, baseline, fontSizePixels)
      .toPathData(4);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(cellWidth)}" height="${String(cellHeight)}"><path d="${path}" fill="white"/></svg>`;
    const mask = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer();
    result.set(character, mask);
  }

  return result;
}
