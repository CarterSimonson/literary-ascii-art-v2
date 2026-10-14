import sharp from "sharp";

export interface SourceImage {
  width: number;
  height: number;
  rgba: Buffer;
}

export interface CharacterArt extends SourceImage {
  characterIndices: Uint32Array;
  characterCount: number;
  backgroundPixels: number;
  transparentPixels: number;
  characters: string[];
}

export async function decodeMaster(png: Buffer): Promise<SourceImage> {
  const image = sharp(png, { limitInputPixels: 16_777_216 });
  const header = await image.metadata();

  if (
    header.format !== "png" ||
    !header.hasAlpha ||
    (header.pages ?? 1) !== 1
  ) {
    throw new Error("Source master must be a single RGBA PNG");
  }

  const { data, info } = await image
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let opaquePixels = 0;

  for (let offset = 3; offset < data.length; offset += 4) {
    const alpha = data[offset];

    if (alpha !== 0 && alpha !== 255) {
      throw new Error(
        "Source master must have binary alpha; rerun bookgen images",
      );
    }

    if (alpha === 255) {
      opaquePixels++;
    }
  }

  if (opaquePixels === 0) {
    throw new Error("Source master contains no opaque artwork");
  }

  return { width: info.width, height: info.height, rgba: data };
}

export function sampleGrid(
  source: SourceImage,
  width: number,
  height: number,
): SourceImage {
  const rgba = Buffer.alloc(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const sourceX = Math.min(
      source.width - 1,
      Math.floor(((x + 0.5) * source.width) / width),
    );
    const sourceY = Math.min(
      source.height - 1,
      Math.floor(((y + 0.5) * source.height) / height),
    );
    const offset = (sourceY * source.width + sourceX) * 4;
    source.rgba.copy(rgba, pixel * 4, offset, offset + 4);
  }

  return { width, height, rgba };
}

export function assignCharacters(
  source: SourceImage,
  characters: string[],
  background = "#FFFFFF",
): CharacterArt {
  if (characters.length === 0) {
    throw new Error("Character conversion requires nonempty text");
  }

  const characterIndices = new Uint32Array(source.width * source.height);
  const backgroundRgb = Buffer.from(background.slice(1), "hex");
  const white = Buffer.from([255, 255, 255]);
  let characterCount = 0;
  let backgroundPixels = 0;
  let transparentPixels = 0;

  for (let pixel = 0; pixel < characterIndices.length; pixel++) {
    const offset = pixel * 4;

    if (source.rgba[offset + 3] === 0) {
      transparentPixels++;
      continue;
    }

    const color = source.rgba.subarray(offset, offset + 3);

    if (color.equals(white) || color.equals(backgroundRgb)) {
      backgroundPixels++;
      continue;
    }

    characterIndices[pixel] = (characterCount % characters.length) + 1;
    characterCount++;
  }

  if (characterCount === 0) {
    throw new Error(
      "Character grid contains no visible artwork after excluding background pixels",
    );
  }

  return {
    ...source,
    characterIndices,
    characterCount,
    backgroundPixels,
    transparentPixels,
    characters,
  };
}

export async function convertToCharacters(
  png: Buffer,
  characters: string[],
  background = "#FFFFFF",
): Promise<CharacterArt> {
  return assignCharacters(await decodeMaster(png), characters, background);
}
