import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { measureImage } from "../src/evals/metrics.ts";
import { loadSuite } from "../src/evals/suite.ts";
import type { SourceImage } from "../src/render/convert.ts";
import { rejection } from "./fixtures.ts";

type Rgba = [number, number, number, number];

const INK: Rgba = [0x26, 0x3d, 0x48, 255];
const ACCENT: Rgba = [0x52, 0x74, 0x5d, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

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

function between(value: number, from: number, to: number): boolean {
  return value >= from && value <= to;
}

// A 40 × 40 ink field with a 10 × 10 opening in the middle.
function field(x: number, y: number): Rgba {
  if (!between(x, 0, 39) || !between(y, 0, 39)) {
    return CLEAR;
  }

  if (between(x, 15, 24) && between(y, 15, 24)) {
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
  test("haze in the native image is scored, crisp art is not", () => {
    const crisp = paint(40, 40, field);
    // The top half of the field is half-transparent haze.
    const hazy = paint(40, 40, (x, y) => {
      const color = field(x, y);

      if (color[3] === 255 && y < 20) {
        return [color[0], color[1], color[2], 128];
      }

      return color;
    });

    expect(measureImage(crisp, crisp).native_haze).toBe(0);
    // 20 hazy rows of 40, less 5 rows of the opening: 750 of 1,600 pixels.
    expect(measureImage(hazy, crisp).native_haze).toBe(0.469);
  });

  test("an accent touching the field is reported and a ringed accent is not", () => {
    // Inside the opening, with a transparent ring around it.
    const ringed = paint(40, 40, (x, y) => {
      if (between(x, 18, 21) && between(y, 18, 21)) {
        return ACCENT;
      }

      return field(x, y);
    });
    // Painted straight onto the ink.
    const touching = paint(40, 40, (x, y) => {
      if (between(x, 2, 5) && between(y, 2, 5)) {
        return ACCENT;
      }

      return field(x, y);
    });
    const plain = paint(40, 40, field);

    expect(measureImage(ringed, ringed).accent_contact).toBe(0);
    expect(measureImage(touching, touching).accent_contact).toBe(1);
    expect(measureImage(plain, plain).accent_contact).toBeNull();
  });
});
