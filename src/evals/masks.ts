// Binary pixel masks (1 = member, 0 = not) with the geometry operations the
// image metrics need: bounding boxes, connected components, and square
// morphology. Masks are row-major and sized width × height.

export interface Mask {
  width: number;
  height: number;
  pixels: Uint8Array;
}

// Inclusive pixel bounds.
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Labeling {
  // Component index per pixel, or -1 for pixels outside the mask or bounds.
  labels: Int32Array;
  sizes: number[];
  touchesBoundsEdge: boolean[];
}

export function fullBounds(mask: Mask): Bounds {
  return { left: 0, top: 0, right: mask.width - 1, bottom: mask.height - 1 };
}

export function boundsArea(bounds: Bounds): number {
  return (bounds.right - bounds.left + 1) * (bounds.bottom - bounds.top + 1);
}

export function countMembers(mask: Mask, bounds = fullBounds(mask)): number {
  let count = 0;

  for (let y = bounds.top; y <= bounds.bottom; y++) {
    for (let x = bounds.left; x <= bounds.right; x++) {
      count += mask.pixels[y * mask.width + x] ?? 0;
    }
  }

  return count;
}

export function boundingBox(mask: Mask): Bounds | null {
  let left = mask.width;
  let top = mask.height;
  let right = -1;
  let bottom = -1;

  for (let pixel = 0; pixel < mask.pixels.length; pixel++) {
    if (mask.pixels[pixel] !== 1) {
      continue;
    }

    const x = pixel % mask.width;
    const y = Math.floor(pixel / mask.width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  if (right < 0) {
    return null;
  }

  return { left, top, right, bottom };
}

export function invert(mask: Mask): Mask {
  const pixels = new Uint8Array(mask.pixels.length);

  for (let pixel = 0; pixel < pixels.length; pixel++) {
    pixels[pixel] = 1 - (mask.pixels[pixel] ?? 0);
  }

  return { width: mask.width, height: mask.height, pixels };
}

// Labels 4-connected components of member pixels inside `bounds`. Connectivity
// does not leave the bounds, so a region split by the bounds edge counts twice.
export function labelComponents(
  mask: Mask,
  bounds = fullBounds(mask),
): Labeling {
  const labels = new Int32Array(mask.pixels.length).fill(-1);
  const queue = new Int32Array(mask.pixels.length);
  const sizes: number[] = [];
  const touchesBoundsEdge: boolean[] = [];

  for (let y = bounds.top; y <= bounds.bottom; y++) {
    for (let x = bounds.left; x <= bounds.right; x++) {
      const start = y * mask.width + x;

      if (mask.pixels[start] !== 1 || labels[start] !== -1) {
        continue;
      }

      const label = sizes.length;
      const component = floodComponent(mask, bounds, start, label, {
        labels,
        queue,
      });
      sizes.push(component.size);
      touchesBoundsEdge.push(component.touchesEdge);
    }
  }

  return { labels, sizes, touchesBoundsEdge };
}

interface FloodBuffers {
  labels: Int32Array;
  queue: Int32Array;
}

interface FloodResult {
  size: number;
  touchesEdge: boolean;
}

function floodComponent(
  mask: Mask,
  bounds: Bounds,
  start: number,
  label: number,
  buffers: FloodBuffers,
): FloodResult {
  const { labels, queue } = buffers;
  let head = 0;
  let tail = 0;
  let touchesEdge = false;

  queue[tail++] = start;
  labels[start] = label;

  while (head < tail) {
    const pixel = queue[head++] ?? 0;
    const x = pixel % mask.width;
    const y = Math.floor(pixel / mask.width);

    if (
      x === bounds.left ||
      x === bounds.right ||
      y === bounds.top ||
      y === bounds.bottom
    ) {
      touchesEdge = true;
    }

    const neighbors: number[] = [];

    if (x > bounds.left) {
      neighbors.push(pixel - 1);
    }

    if (x < bounds.right) {
      neighbors.push(pixel + 1);
    }

    if (y > bounds.top) {
      neighbors.push(pixel - mask.width);
    }

    if (y < bounds.bottom) {
      neighbors.push(pixel + mask.width);
    }

    for (const neighbor of neighbors) {
      if (mask.pixels[neighbor] !== 1 || labels[neighbor] !== -1) {
        continue;
      }

      labels[neighbor] = label;
      queue[tail++] = neighbor;
    }
  }

  return { size: tail, touchesEdge };
}

// Square structuring element of side 2 × radius + 1. Pixels beyond the image
// count as non-members, so erosion also shrinks members touching the image edge.
export function erode(mask: Mask, radius: number): Mask {
  return filterSquare(mask, radius, "erode");
}

export function dilate(mask: Mask, radius: number): Mask {
  return filterSquare(mask, radius, "dilate");
}

// Removes member features narrower than the structuring element.
export function open(mask: Mask, radius: number): Mask {
  return dilate(erode(mask, radius), radius);
}

// Fills non-member gaps narrower than the structuring element.
export function close(mask: Mask, radius: number): Mask {
  return erode(dilate(mask, radius), radius);
}

type FilterMode = "erode" | "dilate";

// Separable square filter: a horizontal pass, then a vertical pass.
function filterSquare(mask: Mask, radius: number, mode: FilterMode): Mask {
  if (radius < 1) {
    return { ...mask, pixels: mask.pixels.slice() };
  }

  const horizontal = new Uint8Array(mask.pixels.length);

  for (let y = 0; y < mask.height; y++) {
    filterLine(mask.pixels, horizontal, {
      start: y * mask.width,
      stride: 1,
      length: mask.width,
      radius,
      mode,
    });
  }

  const result = new Uint8Array(mask.pixels.length);

  for (let x = 0; x < mask.width; x++) {
    filterLine(horizontal, result, {
      start: x,
      stride: mask.width,
      length: mask.height,
      radius,
      mode,
    });
  }

  return { width: mask.width, height: mask.height, pixels: result };
}

interface LineArgs {
  start: number;
  stride: number;
  length: number;
  radius: number;
  mode: FilterMode;
}

// Running member counts over a window of 2 × radius + 1 along one line.
function filterLine(
  source: Uint8Array,
  target: Uint8Array,
  line: LineArgs,
): void {
  const windowSize = line.radius * 2 + 1;
  const prefix = new Int32Array(line.length + 1);

  for (let index = 0; index < line.length; index++) {
    const value = source[line.start + index * line.stride] ?? 0;
    prefix[index + 1] = (prefix[index] ?? 0) + value;
  }

  for (let index = 0; index < line.length; index++) {
    const from = Math.max(0, index - line.radius);
    const to = Math.min(line.length, index + line.radius + 1);
    const members = (prefix[to] ?? 0) - (prefix[from] ?? 0);

    let value = 0;

    if (line.mode === "erode" && members === windowSize) {
      value = 1;
    }

    if (line.mode === "dilate" && members > 0) {
      value = 1;
    }

    target[line.start + index * line.stride] = value;
  }
}

// Counts horizontally and vertically adjacent pixel pairs that differ: the
// boundary length in pixel edges, ignoring the image border.
export function boundaryLength(mask: Mask): number {
  let length = 0;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const pixel = y * mask.width + x;
      const value = mask.pixels[pixel];

      if (x + 1 < mask.width && mask.pixels[pixel + 1] !== value) {
        length++;
      }

      if (y + 1 < mask.height && mask.pixels[pixel + mask.width] !== value) {
        length++;
      }
    }
  }

  return length;
}
