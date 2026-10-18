import sharp from "sharp";

import {
  CRISP_ALPHA,
  MINIMUM_FEATURE_WIDTH_FRACTION,
} from "../images/islands.ts";
import type { SourceImage } from "../render/convert.ts";
import {
  boundaryLength,
  boundingBox,
  boundsArea,
  close,
  countMembers,
  invert,
  labelComponents,
  open,
  type Bounds,
  type Mask,
} from "./masks.ts";

// Bump when a definition changes so stored metrics are recomputed, not compared.
export const METRICS_VERSION = 1;

// Native opaque pixels farther than this sRGB distance from every selected
// artwork color count as off-palette (shading, glow, or stray colors).
export const OFF_PALETTE_DISTANCE = 48;

// Contour smoothing radius as a fraction of the native width. Bumps and notches
// narrower than about twice this are treated as raggedness, not design.
export const RAGGEDNESS_RADIUS_FRACTION = 0.003;

export interface GridSize {
  width: number;
  height: number;
}

export interface MeasureImageArgs {
  // Native generated PNG, before cleanup; alpha may be partial.
  native: SourceImage;
  // Cleaned master: binary alpha, palette colors, transparent padding.
  master: SourceImage;
  artworkColors: string[];
  alphaThreshold: number;
  // Character grid of the primary review target for this master.
  grid: GridSize;
}

// Fractions are in [0, 1] and rounded to four decimals. Null means the metric
// does not apply (for example, accent contact without an accent).
export interface ImageMetrics {
  metrics_version: number;
  native_haze_fraction: number;
  cleanup_change_fraction: number;
  off_palette_fraction: number;
  colors_used: number;
  colors_allowed: number;
  field_rectangularity: number;
  opaque_components: number;
  cutout_count: number;
  cutout_fraction: number;
  largest_cutout_share: number | null;
  grid_cutout_area_ratio: number | null;
  grid_cutout_survival: number | null;
  thin_ink_fraction: number;
  thin_channel_fraction: number | null;
  edge_raggedness: number;
  accent_contact_fraction: number | null;
}

export async function decodeRgba(png: Buffer): Promise<SourceImage> {
  const { data, info } = await sharp(png, { limitInputPixels: 16_777_216 })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { width: info.width, height: info.height, rgba: data };
}

export function measureImage(args: MeasureImageArgs): ImageMetrics {
  const { native, master } = args;
  const padding = masterPadding(native, master);

  const opaque = alphaMask(master, (alpha) => alpha === 255);
  const transparent = invert(opaque);
  const field = boundingBox(opaque);

  if (!field) {
    throw new Error("Master contains no opaque artwork");
  }

  const minimumSide = Math.max(
    1,
    Math.round(native.width * MINIMUM_FEATURE_WIDTH_FRACTION),
  );
  const cutouts = measureCutouts(transparent, field, minimumSide);
  const grid = measureGridSurvival(transparent, field, cutouts, args.grid);
  const colors = measureColors(args);

  return {
    metrics_version: METRICS_VERSION,
    native_haze_fraction: round(nativeHazeFraction(native)),
    cleanup_change_fraction: round(
      cleanupChangeFraction(native, master, args.alphaThreshold, padding),
    ),
    off_palette_fraction: round(colors.offPaletteFraction),
    colors_used: colors.used,
    colors_allowed: colors.allowed,
    field_rectangularity: round(
      fieldRectangularity(opaque, transparent, field),
    ),
    opaque_components: labelComponents(opaque).sizes.length,
    cutout_count: cutouts.significant.length,
    cutout_fraction: round(cutouts.area / boundsArea(field)),
    largest_cutout_share: roundOrNull(cutouts.largestShare),
    grid_cutout_area_ratio: roundOrNull(grid.areaRatio),
    grid_cutout_survival: roundOrNull(grid.survival),
    thin_ink_fraction: round(thinFraction(opaque, field, minimumSide)),
    thin_channel_fraction: roundOrNull(
      thinChannelFraction(transparent, field, minimumSide),
    ),
    edge_raggedness: round(edgeRaggedness(opaque, native.width)),
    accent_contact_fraction: roundOrNull(accentContactFraction(master)),
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function roundOrNull(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return round(value);
}

function alphaMask(
  image: SourceImage,
  member: (alpha: number) => boolean,
): Mask {
  const pixels = new Uint8Array(image.width * image.height);

  for (let pixel = 0; pixel < pixels.length; pixel++) {
    if (member(image.rgba[pixel * 4 + 3] ?? 0)) {
      pixels[pixel] = 1;
    }
  }

  return { width: image.width, height: image.height, pixels };
}

// Cleanup adds the same transparent margin on every side of the native image.
function masterPadding(native: SourceImage, master: SourceImage): number {
  const padding = (master.width - native.width) / 2;

  if (
    !Number.isInteger(padding) ||
    padding < 1 ||
    master.height !== native.height + padding * 2
  ) {
    throw new Error(
      `Master ${String(master.width)}×${String(master.height)} is not a padded copy of native ${String(native.width)}×${String(native.height)}`,
    );
  }

  return padding;
}

// Share of the native artwork's bounding box whose alpha is neither a crisp cut
// nor solid ink. Soft edges contribute a thin band; haze and glow add areas.
function nativeHazeFraction(native: SourceImage): number {
  const visible = alphaMask(native, (alpha) => alpha > CRISP_ALPHA);
  const bounds = boundingBox(visible);

  if (!bounds) {
    return 0;
  }

  const soft = alphaMask(
    native,
    (alpha) => alpha > CRISP_ALPHA && alpha < 255 - CRISP_ALPHA,
  );

  return countMembers(soft, bounds) / boundsArea(bounds);
}

// Share of native pixels whose opacity after thresholding differs from the
// master: the area island cleanup had to repair.
function cleanupChangeFraction(
  native: SourceImage,
  master: SourceImage,
  alphaThreshold: number,
  padding: number,
): number {
  let changed = 0;

  for (let y = 0; y < native.height; y++) {
    for (let x = 0; x < native.width; x++) {
      const nativeAlpha = native.rgba[(y * native.width + x) * 4 + 3] ?? 0;
      const masterPixel = (y + padding) * master.width + x + padding;
      const masterAlpha = master.rgba[masterPixel * 4 + 3] ?? 0;
      const thresholdedOpaque = nativeAlpha >= alphaThreshold;

      if (thresholdedOpaque !== (masterAlpha === 255)) {
        changed++;
      }
    }
  }

  return changed / (native.width * native.height);
}

interface ColorMeasurement {
  offPaletteFraction: number;
  used: number;
  allowed: number;
}

function measureColors(args: MeasureImageArgs): ColorMeasurement {
  const palette = args.artworkColors.map(parseHex);
  const maximumDistance = OFF_PALETTE_DISTANCE ** 2;
  let opaque = 0;
  let offPalette = 0;

  for (let offset = 0; offset < args.native.rgba.length; offset += 4) {
    if ((args.native.rgba[offset + 3] ?? 0) < args.alphaThreshold) {
      continue;
    }

    opaque++;

    const distance = nearestDistance(args.native.rgba, offset, palette);

    if (distance > maximumDistance) {
      offPalette++;
    }
  }

  const used = new Set<number>();

  for (let offset = 0; offset < args.master.rgba.length; offset += 4) {
    if (args.master.rgba[offset + 3] === 255) {
      used.add(args.master.rgba.readUInt32BE(offset));
    }
  }

  let offPaletteFraction = 0;

  if (opaque > 0) {
    offPaletteFraction = offPalette / opaque;
  }

  return {
    offPaletteFraction,
    used: used.size,
    allowed: new Set(args.artworkColors.map((color) => color.toUpperCase()))
      .size,
  };
}

type Rgb = readonly [number, number, number];

function parseHex(color: string): Rgb {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function nearestDistance(rgba: Buffer, offset: number, palette: Rgb[]): number {
  let nearest = Infinity;

  for (const color of palette) {
    const distance =
      ((rgba[offset] ?? 0) - color[0]) ** 2 +
      ((rgba[offset + 1] ?? 0) - color[1]) ** 2 +
      ((rgba[offset + 2] ?? 0) - color[2]) ** 2;
    nearest = Math.min(nearest, distance);
  }

  return nearest;
}

// Opaque artwork plus fully enclosed openings, as a share of the bounding box.
// A plain rectangular field scores 1; subjects that break the field's outline,
// ragged borders, and scattered shapes score lower.
function fieldRectangularity(
  opaque: Mask,
  transparent: Mask,
  field: Bounds,
): number {
  const labeling = labelComponents(transparent);
  let enclosed = 0;

  for (let label = 0; label < labeling.sizes.length; label++) {
    if (!labeling.touchesBoundsEdge[label]) {
      enclosed += labeling.sizes[label] ?? 0;
    }
  }

  return (countMembers(opaque) + enclosed) / boundsArea(field);
}

interface CutoutMeasurement {
  labeling: ReturnType<typeof labelComponents>;
  // Labels of cutouts at least one minimum feature in area.
  significant: number[];
  area: number;
  largestShare: number | null;
}

// Cutouts are transparent regions inside the field's bounding box, including
// those open to the outside, so a subject breaking the field edge still counts.
function measureCutouts(
  transparent: Mask,
  field: Bounds,
  minimumSide: number,
): CutoutMeasurement {
  const labeling = labelComponents(transparent, field);
  const minimumArea = minimumSide * minimumSide;
  const significant: number[] = [];
  let area = 0;
  let largest = 0;

  for (let label = 0; label < labeling.sizes.length; label++) {
    const size = labeling.sizes[label] ?? 0;
    area += size;
    largest = Math.max(largest, size);

    if (size >= minimumArea) {
      significant.push(label);
    }
  }

  let largestShare: number | null = null;

  if (area > 0) {
    largestShare = largest / area;
  }

  return { labeling, significant, area, largestShare };
}

interface GridMeasurement {
  areaRatio: number | null;
  survival: number | null;
}

// Samples the master at the character grid's nearest-neighbor points, exactly
// as rendering does, and checks which cutouts still land on a grid cell.
function measureGridSurvival(
  transparent: Mask,
  field: Bounds,
  cutouts: CutoutMeasurement,
  grid: GridSize,
): GridMeasurement {
  const surviving = new Set<number>();
  let samplesInField = 0;
  let transparentSamples = 0;

  for (let y = 0; y < grid.height; y++) {
    const sourceY = Math.min(
      transparent.height - 1,
      Math.floor(((y + 0.5) * transparent.height) / grid.height),
    );

    for (let x = 0; x < grid.width; x++) {
      const sourceX = Math.min(
        transparent.width - 1,
        Math.floor(((x + 0.5) * transparent.width) / grid.width),
      );
      const inField =
        sourceX >= field.left &&
        sourceX <= field.right &&
        sourceY >= field.top &&
        sourceY <= field.bottom;

      if (!inField) {
        continue;
      }

      samplesInField++;

      const pixel = sourceY * transparent.width + sourceX;

      if (transparent.pixels[pixel] !== 1) {
        continue;
      }

      transparentSamples++;
      surviving.add(cutouts.labeling.labels[pixel] ?? -1);
    }
  }

  const masterFraction = cutouts.area / boundsArea(field);
  let areaRatio: number | null = null;

  if (masterFraction > 0 && samplesInField > 0) {
    areaRatio = transparentSamples / samplesInField / masterFraction;
  }

  let survival: number | null = null;

  if (cutouts.significant.length > 0) {
    const kept = cutouts.significant.filter((label) => surviving.has(label));
    survival = kept.length / cutouts.significant.length;
  }

  return { areaRatio, survival };
}

// Share of member pixels inside `bounds` that an opening at the minimum
// feature width removes: strokes or channels too thin to print reliably.
function thinFraction(mask: Mask, bounds: Bounds, minimumSide: number): number {
  const total = countMembers(mask, bounds);

  if (total === 0) {
    return 0;
  }

  const radius = Math.max(1, Math.floor((minimumSide - 1) / 2));
  const opened = open(mask, radius);
  let removed = 0;

  for (let y = bounds.top; y <= bounds.bottom; y++) {
    for (let x = bounds.left; x <= bounds.right; x++) {
      const pixel = y * mask.width + x;

      if (mask.pixels[pixel] === 1 && opened.pixels[pixel] === 0) {
        removed++;
      }
    }
  }

  return removed / total;
}

// Opens the whole transparent mask so channels that reach the outer margin keep
// their width at the field edge, then measures inside the field.
function thinChannelFraction(
  transparent: Mask,
  field: Bounds,
  minimumSide: number,
): number | null {
  if (countMembers(transparent, field) === 0) {
    return null;
  }

  return thinFraction(transparent, field, minimumSide);
}

// Share of the ink outline that disappears after a small open and close.
// Smooth vector contours keep almost all of their length; torn edges do not.
function edgeRaggedness(opaque: Mask, nativeWidth: number): number {
  const length = boundaryLength(opaque);

  if (length === 0) {
    return 0;
  }

  const radius = Math.max(
    1,
    Math.round(nativeWidth * RAGGEDNESS_RADIUS_FRACTION),
  );
  const smoothed = close(open(opaque, radius), radius);
  const removed = length - boundaryLength(smoothed);

  return Math.max(0, removed) / length;
}

// The primary ink is the most common opaque color; every other color is an
// accent. Returns the share of accent outline pixels touching primary ink.
function accentContactFraction(master: SourceImage): number | null {
  const counts = new Map<number, number>();

  for (let offset = 0; offset < master.rgba.length; offset += 4) {
    if (master.rgba[offset + 3] !== 255) {
      continue;
    }

    const color = master.rgba.readUInt32BE(offset);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  if (counts.size < 2) {
    return null;
  }

  let primary = 0;
  let primaryCount = -1;

  for (const [color, count] of counts) {
    if (count > primaryCount) {
      primary = color;
      primaryCount = count;
    }
  }

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

  return touching / outline;
}

function opaqueColor(image: SourceImage, pixel: number): number | null {
  if (image.rgba[pixel * 4 + 3] !== 255) {
    return null;
  }

  return image.rgba.readUInt32BE(pixel * 4);
}

// 4-neighbor colors; transparent and off-image neighbors are null.
function neighborColors(image: SourceImage, pixel: number): (number | null)[] {
  const x = pixel % image.width;
  const y = Math.floor(pixel / image.width);
  const colors: (number | null)[] = [];

  if (x > 0) {
    colors.push(opaqueColor(image, pixel - 1));
  } else {
    colors.push(null);
  }

  if (x < image.width - 1) {
    colors.push(opaqueColor(image, pixel + 1));
  } else {
    colors.push(null);
  }

  if (y > 0) {
    colors.push(opaqueColor(image, pixel - image.width));
  } else {
    colors.push(null);
  }

  if (y < image.height - 1) {
    colors.push(opaqueColor(image, pixel + image.width));
  } else {
    colors.push(null);
  }

  return colors;
}
