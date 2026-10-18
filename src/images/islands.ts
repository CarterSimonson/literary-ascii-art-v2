// Source alpha at or below this counts as a deliberate, fully transparent cut.
export const CRISP_ALPHA = 16;

// An enclosed transparent region survives only if at least this share of its
// pixels was crisp in the native image; otherwise it is haze left by thresholding.
export const CRISP_REGION_FRACTION = 0.5;

// Regions smaller than a square of this fraction of the width are specks. This
// matches the source-art rule that strokes and gaps span about 1% of the width.
export const MINIMUM_FEATURE_WIDTH_FRACTION = 0.01;

export interface IslandCleanupResult {
  hazeRegionsFilled: number;
  smallHolesFilled: number;
  specksRemoved: number;
  pixelsChanged: number;
}

interface Region {
  pixels: number[];
  touchesEdge: boolean;
  crispPixels: number;
}

interface ImageGrid {
  rgba: Buffer;
  width: number;
  height: number;
}

// Removes thresholding artifacts in place. `sourceAlpha` holds the native alpha
// before binarization; `rgba` already has binary alpha and palette colors.
export function cleanIslands(
  image: ImageGrid,
  sourceAlpha: Uint8Array,
): IslandCleanupResult {
  const result: IslandCleanupResult = {
    hazeRegionsFilled: 0,
    smallHolesFilled: 0,
    specksRemoved: 0,
    pixelsChanged: 0,
  };
  const minimumSide = Math.max(
    1,
    Math.round(image.width * MINIMUM_FEATURE_WIDTH_FRACTION),
  );
  const minimumArea = minimumSide * minimumSide;

  // Fill transparent holes first so specks are judged against the final field.
  for (const region of findRegions(image, false, sourceAlpha)) {
    if (region.touchesEdge) {
      continue;
    }

    const isSmall = region.pixels.length < minimumArea;
    const isHaze =
      region.crispPixels / region.pixels.length < CRISP_REGION_FRACTION;

    if (!isSmall && !isHaze) {
      continue;
    }

    fillWithSurroundingColor(image, region);
    result.pixelsChanged += region.pixels.length;

    if (isSmall) {
      result.smallHolesFilled++;
    } else {
      result.hazeRegionsFilled++;
    }
  }

  for (const region of findRegions(image, true, sourceAlpha)) {
    if (region.pixels.length >= minimumArea) {
      continue;
    }

    for (const pixel of region.pixels) {
      image.rgba.fill(0, pixel * 4, pixel * 4 + 4);
    }

    result.specksRemoved++;
    result.pixelsChanged += region.pixels.length;
  }

  return result;
}

function isOpaque(image: ImageGrid, pixel: number): boolean {
  return image.rgba[pixel * 4 + 3] === 255;
}

// Collects 4-connected regions of opaque (or transparent) pixels.
function findRegions(
  image: ImageGrid,
  opaque: boolean,
  sourceAlpha: Uint8Array,
): Region[] {
  const total = image.width * image.height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const regions: Region[] = [];

  for (let start = 0; start < total; start++) {
    if (visited[start] === 1 || isOpaque(image, start) !== opaque) {
      continue;
    }

    const region: Region = { pixels: [], touchesEdge: false, crispPixels: 0 };
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const pixel = queue[head++] ?? 0;
      const x = pixel % image.width;
      const y = Math.floor(pixel / image.width);
      region.pixels.push(pixel);

      if ((sourceAlpha[pixel] ?? 0) <= CRISP_ALPHA) {
        region.crispPixels++;
      }

      if (
        x === 0 ||
        y === 0 ||
        x === image.width - 1 ||
        y === image.height - 1
      ) {
        region.touchesEdge = true;
      }

      for (const neighbor of neighbors(
        pixel,
        x,
        y,
        image.width,
        image.height,
      )) {
        if (visited[neighbor] === 1 || isOpaque(image, neighbor) !== opaque) {
          continue;
        }

        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }

    regions.push(region);
  }

  return regions;
}

function neighbors(
  pixel: number,
  x: number,
  y: number,
  width: number,
  height: number,
): number[] {
  const result: number[] = [];

  if (x > 0) {
    result.push(pixel - 1);
  }

  if (x < width - 1) {
    result.push(pixel + 1);
  }

  if (y > 0) {
    result.push(pixel - width);
  }

  if (y < height - 1) {
    result.push(pixel + width);
  }

  return result;
}

// Uses the most common opaque color bordering the region, so a filled hole
// rejoins the field around it.
function fillWithSurroundingColor(image: ImageGrid, region: Region): void {
  const counts = new Map<number, number>();

  for (const pixel of region.pixels) {
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);

    for (const neighbor of neighbors(pixel, x, y, image.width, image.height)) {
      if (!isOpaque(image, neighbor)) {
        continue;
      }

      const color = image.rgba.readUInt32BE(neighbor * 4);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }

  let fill = 0;
  let best = -1;

  for (const [color, count] of counts) {
    if (count > best) {
      fill = color;
      best = count;
    }
  }

  for (const pixel of region.pixels) {
    image.rgba.writeUInt32BE(fill, pixel * 4);
  }
}
