// Scores a book's published masters and their traced native images with the
// eval image metrics, without generating anything. Prints YAML to stdout.
//
// Usage: bun scripts/eval-trace-metrics.ts <book-id> [--output <directory>]
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { parse, stringify } from "yaml";
import { z } from "zod";

import { characterGridSize, PRIMARY_TARGET_ID } from "../src/evals/grid.ts";
import { decodeRgba, measureImage } from "../src/evals/metrics.ts";
import { slugSchema } from "../src/ideas/schema.ts";
import { resolveOutputTarget } from "../src/output-targets.ts";

const manifestSchema = z.looseObject({
  processing: z.looseObject({ alpha_threshold: z.number().int() }),
  images: z.array(
    z.looseObject({
      idea_id: slugSchema,
      path: z.string(),
      attempt: z.number().int().min(1),
      artwork_colors: z.array(z.string()).min(1),
    }),
  ),
});

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { output: { type: "string", default: "output" } },
});

const bookId = slugSchema.parse(positionals[0]);
const bookDirectory = resolve(values.output, bookId);

const manifest = manifestSchema.parse(
  parse(await readFile(join(bookDirectory, "raw", "manifest.yaml"), "utf8")),
);
const bookText = await readFile(
  join(bookDirectory, "text", "book.txt"),
  "utf8",
);
const target = await resolveOutputTarget(PRIMARY_TARGET_ID);

const results: Record<string, unknown>[] = [];

for (const image of manifest.images) {
  const nativePath = join(
    bookDirectory,
    "traces",
    "images",
    image.idea_id,
    `attempt-${String(image.attempt)}`,
    "generated.png",
  );
  const native = await decodeRgba(await readFile(nativePath));
  const master = await decodeRgba(
    await readFile(join(bookDirectory, "raw", image.path)),
  );
  const grid = await characterGridSize({ master, target, bookText });

  const metrics = measureImage({
    native,
    master,
    artworkColors: image.artwork_colors,
    alphaThreshold: manifest.processing.alpha_threshold,
    grid,
  });

  results.push({
    idea_id: image.idea_id,
    grid: `${String(grid.width)}x${String(grid.height)}`,
    ...metrics,
  });
}

process.stdout.write(
  stringify({ book: bookId, target: PRIMARY_TARGET_ID, images: results }),
);
