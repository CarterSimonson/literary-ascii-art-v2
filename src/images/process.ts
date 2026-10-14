import sharp from "sharp";
import { z } from "zod";

export const PROCESS_VERSION = 1;
const colorsSchema = z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function processImage(
  png: Buffer,
  artworkColors: string[],
  alphaThreshold: number,
): Promise<{
  png: Buffer;
  metadata: {
    source_width: number;
    source_height: number;
    width: number;
    height: number;
    opaque_pixels: number;
    transparent_pixels: number;
    normalized_alpha_pixels: number;
    mapped_color_pixels: number;
    padding: number;
  };
}> {
  const colors = colorsSchema
    .parse(artworkColors)
    .map(
      (color) =>
        [
          Number.parseInt(color.slice(1, 3), 16),
          Number.parseInt(color.slice(3, 5), 16),
          Number.parseInt(color.slice(5, 7), 16),
        ] as const,
    );
  z.number().int().min(1).max(255).parse(alphaThreshold);
  if (!png.subarray(0, 8).equals(pngSignature))
    throw new Error("Generated image must be PNG");
  const image = sharp(png, { limitInputPixels: 16_777_216 });
  const header = await image.metadata();
  if (!header.hasAlpha || (header.pages ?? 1) !== 1)
    throw new Error(
      "Generated PNG must be a single image with genuine alpha transparency",
    );
  const { data, info } = await image
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let opaque = 0;
  let normalizedAlpha = 0;
  let mappedColors = 0;
  let sourceTransparent = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] ?? 0;
    if (alpha === 0) sourceTransparent++;
    const nextAlpha = alpha < alphaThreshold ? 0 : 255;
    if (alpha !== nextAlpha) normalizedAlpha++;
    data[offset + 3] = nextAlpha;
    if (nextAlpha === 0) {
      transparent++;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      continue;
    }
    opaque++;
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    let nearest = colors[0];
    let distance = Infinity;
    for (const color of colors) {
      const candidate =
        (red - color[0]) ** 2 +
        (green - color[1]) ** 2 +
        (blue - color[2]) ** 2;
      if (candidate < distance) {
        nearest = color;
        distance = candidate;
      }
    }
    if (!nearest) throw new Error("Artwork palette is empty");
    if (distance > 0) mappedColors++;
    data[offset] = nearest[0];
    data[offset + 1] = nearest[1];
    data[offset + 2] = nearest[2];
  }
  if (sourceTransparent === 0)
    throw new Error(
      "Generated PNG has no fully transparent pixels; refusing to guess or erase an opaque background",
    );
  if (opaque === 0)
    throw new Error(
      "Generated image has no opaque artwork after alpha cleanup",
    );
  const padding = Math.max(1, Math.ceil(info.width * 0.02));
  const width = info.width + padding * 2;
  const height = info.height + padding * 2;
  const result = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ palette: false })
    .toBuffer();
  return {
    png: result,
    metadata: {
      source_width: info.width,
      source_height: info.height,
      width,
      height,
      opaque_pixels: opaque,
      transparent_pixels:
        transparent + width * height - info.width * info.height,
      normalized_alpha_pixels: normalizedAlpha,
      mapped_color_pixels: mappedColors,
      padding,
    },
  };
}
