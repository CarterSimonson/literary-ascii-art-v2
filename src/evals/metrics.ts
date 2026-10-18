import { CRISP_ALPHA } from "../images/islands.ts";
import type { SourceImage } from "../render/convert.ts";

// Two quick signals shown beside each eval image. They support the reviewer's
// judgement; they do not replace it.
export interface ImageMetrics {
  // Share of the native artwork's bounding box with soft alpha: neither a crisp
  // cut nor solid ink. Cleanup hides haze, so this reads the native image.
  native_haze: number;
  // Share of the accent outline touching primary ink in the master, or null
  // without an accent. The prompt asks for a transparent ring, so 0 is right.
  accent_contact: number | null;
}

export function measureImage(
  native: SourceImage,
  master: SourceImage,
): ImageMetrics {
  return {
    native_haze: round(nativeHaze(native)),
    accent_contact: roundOrNull(accentContact(master)),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundOrNull(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return round(value);
}

function nativeHaze(native: SourceImage): number {
  let left = native.width;
  let top = native.height;
  let right = -1;
  let bottom = -1;

  for (let pixel = 0; pixel < native.width * native.height; pixel++) {
    if ((native.rgba[pixel * 4 + 3] ?? 0) <= CRISP_ALPHA) {
      continue;
    }

    const x = pixel % native.width;
    const y = Math.floor(pixel / native.width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  if (right < 0) {
    return 0;
  }

  let soft = 0;

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const alpha = native.rgba[(y * native.width + x) * 4 + 3] ?? 0;

      if (alpha > CRISP_ALPHA && alpha < 255 - CRISP_ALPHA) {
        soft++;
      }
    }
  }

  return soft / ((right - left + 1) * (bottom - top + 1));
}

// The primary ink is the most common opaque color; any other color is accent.
function accentContact(master: SourceImage): number | null {
  const primary = mostCommonColor(master);
  let outline = 0;
  let touching = 0;

  for (let pixel = 0; pixel < master.width * master.height; pixel++) {
    const color = opaqueColor(master, pixel);

    if (color === null || color === primary) {
      continue;
    }

    const neighbors = neighborColors(master, pixel);

    if (neighbors.every((neighbor) => neighbor === color)) {
      continue;
    }

    outline++;

    if (neighbors.includes(primary)) {
      touching++;
    }
  }

  if (outline === 0) {
    return null;
  }

  return touching / outline;
}

function mostCommonColor(image: SourceImage): number | null {
  const counts = new Map<number, number>();

  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    const color = opaqueColor(image, pixel);

    if (color !== null) {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }

  let common: number | null = null;
  let commonCount = 0;

  for (const [color, count] of counts) {
    if (count > commonCount) {
      common = color;
      commonCount = count;
    }
  }

  return common;
}

function opaqueColor(image: SourceImage, pixel: number): number | null {
  if (image.rgba[pixel * 4 + 3] !== 255) {
    return null;
  }

  return image.rgba.readUInt32BE(pixel * 4);
}

// Transparent and off-image neighbors are null.
function neighborColors(image: SourceImage, pixel: number): (number | null)[] {
  const x = pixel % image.width;
  const y = Math.floor(pixel / image.width);
  const colors: (number | null)[] = [null, null, null, null];

  if (x > 0) {
    colors[0] = opaqueColor(image, pixel - 1);
  }

  if (x < image.width - 1) {
    colors[1] = opaqueColor(image, pixel + 1);
  }

  if (y > 0) {
    colors[2] = opaqueColor(image, pixel - image.width);
  }

  if (y < image.height - 1) {
    colors[3] = opaqueColor(image, pixel + image.width);
  }

  return colors;
}
