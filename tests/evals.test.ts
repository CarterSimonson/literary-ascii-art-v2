import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { measureImage, type GridSize } from "../src/evals/metrics.ts";
import { loadSuite } from "../src/evals/suite.ts";
import type { SourceImage } from "../src/render/convert.ts";
import { rejection } from "./fixtures.ts";

type Rgba = [number, number, number, number];

const INK: Rgba = [0x26, 0x3d, 0x48, 255];
const ACCENT: Rgba = [0x52, 0x74, 0x5d, 255];
const CLEAR: Rgba = [0, 0, 0, 0];
const ARTWORK_COLORS = ["#263D48", "#52745D"];
const GRID: GridSize = { width: 30, height: 45 };

interface Rectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function inside(x: number, y: number, rectangle: Rectangle): boolean {
  return (
    x >= rectangle.left &&
    x <= rectangle.right &&
    y >= rectangle.top &&
    y <= rectangle.bottom
  );
}

function paint(
  width: number,
  height: number,
  color: (x: number, y: number) => Rgba,
): SourceImage {
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set(color(x, y), (y * width + x) * 4);
    }
  }

  return { width, height, rgba };
}

// Mirrors cleanup: binary alpha, palette colors, and a 2% transparent margin.
function padAsMaster(native: SourceImage): SourceImage {
  const padding = Math.max(1, Math.ceil(native.width * 0.02));

  return paint(
    native.width + padding * 2,
    native.height + padding * 2,
    (x, y) => {
      const sourceX = x - padding;
      const sourceY = y - padding;

      if (
        sourceX < 0 ||
        sourceY < 0 ||
        sourceX >= native.width ||
        sourceY >= native.height
      ) {
        return CLEAR;
      }

      const offset = (sourceY * native.width + sourceX) * 4;

      if ((native.rgba[offset + 3] ?? 0) < 128) {
        return CLEAR;
      }

      return [
        native.rgba[offset] ?? 0,
        native.rgba[offset + 1] ?? 0,
        native.rgba[offset + 2] ?? 0,
        255,
      ];
    },
  );
}

const FIELD: Rectangle = { left: 5, top: 5, right: 94, bottom: 144 };
const SUBJECT: Rectangle = { left: 30, top: 40, right: 69, bottom: 109 };

// A plain rectangular field with one crisp rectangular cutout.
function cleanPoster(x: number, y: number): Rgba {
  if (!inside(x, y, FIELD) || inside(x, y, SUBJECT)) {
    return CLEAR;
  }

  return INK;
}

describe("image-prompt suite", () => {
  test("the committed suite freezes three Great Gatsby ideas", async () => {
    const suite = await loadSuite();

    expect(suite.book.slug).toBe("the-great-gatsby");
    expect(suite.cases.map((entry) => entry.id)).toEqual([
      "the-weight-of-shirts",
      "the-distance-of-desire",
      "the-machine-of-carelessness",
    ]);

    for (const entry of suite.cases) {
      expect(entry.idea.id).toBe(entry.id);
      expect(entry.idea.palette.length).toBeLessThanOrEqual(3);
      expect(entry.purpose.length).toBeGreaterThan(0);
    }

    expect(suite.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("a case file holding a different idea is rejected", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bookgen-suite-"));
    await cp("evals/image-prompt", directory, { recursive: true });
    await cp(
      join(directory, "cases", "the-weight-of-shirts.yaml"),
      join(directory, "cases", "the-distance-of-desire.yaml"),
    );

    const failure = await rejection(loadSuite({ directory }));

    expect(failure).toThrow("its file name requires 'the-distance-of-desire'");
  });

  test("a suite for an unregistered book is rejected", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bookgen-suite-"));
    await cp("evals/image-prompt", directory, { recursive: true });
    await writeFile(
      join(directory, "suite.yaml"),
      "schema_version: 1\nsuite_version: 1\nbook: unknown-book\ncases: [the-weight-of-shirts]\n",
    );

    const failure = await rejection(loadSuite({ directory }));

    expect(failure).toThrow("Unknown book ID 'unknown-book'");
  });
});

describe("image metrics", () => {
  test("a crisp rectangular field with one cutout scores as clean", () => {
    const native = paint(100, 150, cleanPoster);

    const metrics = measureImage({
      native,
      master: padAsMaster(native),
      artworkColors: ARTWORK_COLORS,
      alphaThreshold: 128,
      grid: GRID,
    });

    expect(metrics).toEqual({
      metrics_version: 1,
      native_haze_fraction: 0,
      cleanup_change_fraction: 0,
      off_palette_fraction: 0,
      colors_used: 1,
      colors_allowed: 2,
      field_rectangularity: 1,
      opaque_components: 1,
      cutout_count: 1,
      cutout_fraction: 0.2222,
      largest_cutout_share: 1,
      grid_cutout_area_ratio: expect.any(Number) as number,
      grid_cutout_survival: 1,
      thin_ink_fraction: 0,
      thin_channel_fraction: 0,
      edge_raggedness: 0,
      accent_contact_fraction: null,
    });
    // Coarse grid sampling keeps the cutout's area within about 10%.
    expect(metrics.grid_cutout_area_ratio).toBeGreaterThan(0.9);
    expect(metrics.grid_cutout_area_ratio).toBeLessThan(1.1);
  });

  test("native haze is scored even after cleanup has filled it", () => {
    // The subject area is semi-transparent haze that cleanup fills with ink.
    const native = paint(100, 150, (x, y) => {
      if (inside(x, y, SUBJECT)) {
        return [INK[0], INK[1], INK[2], 60];
      }

      return cleanPoster(x, y);
    });
    const master = padAsMaster(
      paint(100, 150, (x, y) => {
        if (inside(x, y, FIELD)) {
          return INK;
        }

        return CLEAR;
      }),
    );

    const metrics = measureImage({
      native,
      master,
      artworkColors: ARTWORK_COLORS,
      alphaThreshold: 128,
      grid: GRID,
    });

    const subjectArea = 40 * 70;
    expect(metrics.native_haze_fraction).toBeCloseTo(
      subjectArea / (90 * 140),
      4,
    );
    expect(metrics.cleanup_change_fraction).toBeCloseTo(
      subjectArea / (100 * 150),
      4,
    );
    expect(metrics.cutout_count).toBe(0);
  });

  test("shaded native colors count as off-palette", () => {
    // The top half of the field is shaded warmer than either palette color.
    const native = paint(100, 150, (x, y) => {
      const color = cleanPoster(x, y);

      if (color[3] === 255 && y < 75) {
        return [color[0] + 60, color[1], color[2], 255];
      }

      return color;
    });

    const metrics = measureImage({
      native,
      master: padAsMaster(paint(100, 150, cleanPoster)),
      artworkColors: ARTWORK_COLORS,
      alphaThreshold: 128,
      grid: GRID,
    });

    expect(metrics.off_palette_fraction).toBeGreaterThan(0.3);
    expect(metrics.off_palette_fraction).toBeLessThan(0.7);
  });

  test("a torn field edge scores higher raggedness than a straight one", () => {
    // Every other row of the right edge sticks out by two pixels.
    const torn = paint(400, 600, (x, y) => {
      const right = 380 + (y % 2) * 2;

      if (x >= 20 && x <= right && y >= 20 && y <= 580) {
        return INK;
      }

      return CLEAR;
    });
    const straight = paint(400, 600, (x, y) => {
      if (x >= 20 && x <= 380 && y >= 20 && y <= 580) {
        return INK;
      }

      return CLEAR;
    });

    const tornMetrics = measureImage({
      native: torn,
      master: padAsMaster(torn),
      artworkColors: ARTWORK_COLORS,
      alphaThreshold: 128,
      grid: GRID,
    });
    const straightMetrics = measureImage({
      native: straight,
      master: padAsMaster(straight),
      artworkColors: ARTWORK_COLORS,
      alphaThreshold: 128,
      grid: GRID,
    });

    expect(straightMetrics.edge_raggedness).toBe(0);
    expect(tornMetrics.edge_raggedness).toBeGreaterThan(0.2);
  });

  test("an accent touching the field is reported and a ringed accent is not", () => {
    const accent: Rectangle = { left: 45, top: 70, right: 54, bottom: 79 };
    const ringed = paint(100, 150, (x, y) => {
      if (inside(x, y, accent)) {
        return ACCENT;
      }

      return cleanPoster(x, y);
    });
    const touching = paint(100, 150, (x, y) => {
      if (inside(x, y, { left: 10, top: 10, right: 19, bottom: 19 })) {
        return ACCENT;
      }

      return cleanPoster(x, y);
    });

    const ringedMetrics = measureImage({
      native: ringed,
      master: padAsMaster(ringed),
      artworkColors: ARTWORK_COLORS,
      alphaThreshold: 128,
      grid: GRID,
    });
    const touchingMetrics = measureImage({
      native: touching,
      master: padAsMaster(touching),
      artworkColors: ARTWORK_COLORS,
      alphaThreshold: 128,
      grid: GRID,
    });

    expect(ringedMetrics.accent_contact_fraction).toBe(0);
    expect(ringedMetrics.opaque_components).toBe(2);
    expect(touchingMetrics.accent_contact_fraction).toBe(1);
    expect(touchingMetrics.opaque_components).toBe(1);
  });

  test("a cutout that misses every grid cell is reported as lost", () => {
    // At this grid, sample points fall every ~42 px; the small cutout sits
    // between them while the large one is hit many times.
    const native = paint(400, 600, (x, y) => {
      const field = { left: 10, top: 10, right: 389, bottom: 589 };
      const small = { left: 20, top: 20, right: 24, bottom: 24 };
      const large = { left: 100, top: 200, right: 299, bottom: 399 };

      if (!inside(x, y, field) || inside(x, y, small) || inside(x, y, large)) {
        return CLEAR;
      }

      return INK;
    });

    const metrics = measureImage({
      native,
      master: padAsMaster(native),
      artworkColors: ARTWORK_COLORS,
      alphaThreshold: 128,
      grid: { width: 10, height: 15 },
    });

    expect(metrics.cutout_count).toBe(2);
    expect(metrics.grid_cutout_survival).toBe(0.5);
  });

  test("channels narrower than the minimum feature width count as thin", () => {
    // A two-pixel channel; the minimum feature at 400 px wide is four pixels.
    const native = paint(400, 600, (x, y) => {
      const field = { left: 10, top: 10, right: 389, bottom: 589 };
      const channel = { left: 100, top: 100, right: 101, bottom: 299 };

      if (!inside(x, y, field) || inside(x, y, channel)) {
        return CLEAR;
      }

      return INK;
    });

    const metrics = measureImage({
      native,
      master: padAsMaster(native),
      artworkColors: ARTWORK_COLORS,
      alphaThreshold: 128,
      grid: GRID,
    });

    expect(metrics.thin_channel_fraction).toBe(1);
    expect(metrics.thin_ink_fraction).toBe(0);
  });

  test("a master that is not a padded copy of its native image is rejected", () => {
    const native = paint(100, 150, cleanPoster);

    expect(() =>
      measureImage({
        native,
        master: native,
        artworkColors: ARTWORK_COLORS,
        alphaThreshold: 128,
        grid: GRID,
      }),
    ).toThrow("is not a padded copy");
  });
});
