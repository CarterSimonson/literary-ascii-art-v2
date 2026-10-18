import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { findBook, resolveBook } from "../src/books.ts";
import type { ImageGenerator } from "../src/images/codex.ts";
import { buildImagePrompt } from "../src/images/prompt.ts";
import { processImage } from "../src/images/process.ts";
import { runReclean } from "../src/images/reclean.ts";
import { runImages, sha256 } from "../src/images/run.ts";
import type { ImagesRequest } from "../src/images/schema.ts";
import { ideasResponse, rejection } from "./fixtures.ts";

let root: string;
let png: Buffer;
beforeEach(async (): Promise<void> => {
  root = await mkdtemp(join(tmpdir(), "bookgen-images-test-"));
  png = await sharp(
    Buffer.from([
      0, 0, 0, 0, 127, 24, 42, 255, 20, 60, 70, 100, 20, 60, 70, 128,
    ]),
    { raw: { width: 2, height: 2, channels: 4 } },
  )
    .png()
    .toBuffer();
});
afterEach(async (): Promise<void> => {
  await rm(root, { recursive: true, force: true });
});
function request(): ImagesRequest {
  return {
    title: "Dracula",
    author: "Bram Stoker",
    slug: "dracula",
    outputRoot: root,
    timeoutSeconds: 5,
    size: "1024x1536",
    alphaThreshold: 128,
  };
}
async function saveIdeas(prefix = "concept"): Promise<string> {
  await mkdir(join(root, "dracula"), { recursive: true });
  const path = join(root, "dracula/ideas.yaml");
  await writeFile(
    path,
    stringify({
      schema_version: 2,
      book: { title: "Dracula", author: "Bram Stoker", slug: "dracula" },
      generation: {},
      ...ideasResponse(prefix),
    }),
  );
  return path;
}
function generator(): ImageGenerator {
  return async ({ onEvent }): ReturnType<ImageGenerator> => {
    await onEvent({ type: "thread.started", thread_id: "image-thread" });
    return {
      png,
      artworkColors: ["#80182A", "#183D49"],
      threadId: "image-thread",
      usage: null,
      reviewNotes: ["Inspect narrow features before conversion"],
    };
  };
}
async function traceStatus(): Promise<string> {
  const input: unknown = JSON.parse(
    await readFile(join(root, "dracula/traces/images/run.json"), "utf8"),
  );
  return z.object({ status: z.string() }).parse(input).status;
}

describe("shared book registry", (): void => {
  test("resolves registered IDs and rejects unknown IDs and unsafe paths", async (): Promise<void> => {
    const path = join(root, "books.yaml");
    await writeFile(
      path,
      stringify({
        schema_version: 1,
        books: {
          dracula: {
            title: "Dracula",
            author: "Bram Stoker",
            gutenberg_id: 345,
          },
        },
      }),
    );
    expect(await resolveBook("dracula", path)).toEqual({
      gutenberg_id: 345,
      title: "Dracula",
      author: "Bram Stoker",
      slug: "dracula",
    });
    expect(await findBook("Other Title", path)).toBeUndefined();
    expect(await rejection(resolveBook("unknown", path))).toThrow(
      "Unknown book ID",
    );
    expect(await rejection(resolveBook("../../escape", path))).toThrow();
    await writeFile(
      path,
      "schema_version: 1\nbooks:\n  dracula: {title: Dracula}\n",
    );
    expect(await rejection(resolveBook("dracula", path))).toThrow();
  });
  test("rejects duplicate YAML keys and unsupported registry versions", async (): Promise<void> => {
    const path = join(root, "books.yaml");
    await writeFile(path, "schema_version: 1\nbooks: {}\nbooks: {}\n");
    expect(await rejection(resolveBook("dracula", path))).toThrow();
    await writeFile(path, "schema_version: 2\nbooks: {}\n");
    expect(await rejection(resolveBook("dracula", path))).toThrow();
  });
});

interface PaintedRect {
  left: number;
  top: number;
  size: number;
  alpha: number;
}

// A 200 × 100 field of #80182A inside a 5 px transparent margin, with rects
// painted over it at the given native alpha.
async function fieldWithRects(rects: PaintedRect[]): Promise<Buffer> {
  const width = 200;
  const height = 100;
  const data = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inField = x >= 5 && y >= 5 && x < width - 5 && y < height - 5;
      const offset = (y * width + x) * 4;
      data.set([0x80, 0x18, 0x2a, inField ? 255 : 0], offset);
    }
  }

  for (const rect of rects) {
    for (let y = rect.top; y < rect.top + rect.size; y++) {
      for (let x = rect.left; x < rect.left + rect.size; x++) {
        data[(y * width + x) * 4 + 3] = rect.alpha;
      }
    }
  }

  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function alphaAt(image: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return data[(y * info.width + x) * 4 + 3] ?? -1;
}

describe("conversion-ready PNG cleanup", (): void => {
  test("fills hazy holes in the field but keeps crisp designed cutouts", async (): Promise<void> => {
    const native = await fieldWithRects([
      { left: 20, top: 20, size: 30, alpha: 60 },
      { left: 120, top: 20, size: 30, alpha: 0 },
    ]);

    const result = await processImage(native, ["#80182A"], 128);

    const padding = result.metadata.padding;
    expect(await alphaAt(result.png, padding + 35, padding + 35)).toBe(255);
    expect(await alphaAt(result.png, padding + 135, padding + 35)).toBe(0);
    expect(result.metadata.haze_regions_filled).toBe(1);
  });

  test("removes specks and pinholes smaller than the minimum feature width", async (): Promise<void> => {
    const native = await fieldWithRects([
      { left: 60, top: 60, size: 1, alpha: 0 },
      { left: 1, top: 1, size: 1, alpha: 255 },
    ]);

    const result = await processImage(native, ["#80182A"], 128);

    const padding = result.metadata.padding;
    expect(await alphaAt(result.png, padding + 60, padding + 60)).toBe(255);
    expect(await alphaAt(result.png, padding + 1, padding + 1)).toBe(0);
    expect(result.metadata.small_holes_filled).toBe(1);
    expect(result.metadata.specks_removed).toBe(1);
  });

  test("normalizes a generated image whose artwork alpha never reaches 255", async (): Promise<void> => {
    const partial = await sharp(Buffer.from([0, 0, 0, 0, 128, 24, 42, 254]), {
      raw: { width: 2, height: 1, channels: 4 },
    })
      .png()
      .toBuffer();
    const result = await processImage(partial, ["#80182A"], 128);
    expect(result.metadata.opaque_pixels).toBe(1);
    expect(result.metadata.normalized_alpha_pixels).toBe(1);
  });
  test("normalizes alpha, uses only artwork palette colors and adds a clear perimeter", async (): Promise<void> => {
    const result = await processImage(png, ["#80182A", "#183D49"], 128);
    expect(result.metadata).toMatchObject({
      source_width: 2,
      source_height: 2,
      width: 4,
      height: 4,
      opaque_pixels: 2,
      transparent_pixels: 14,
      normalized_alpha_pixels: 2,
      mapped_color_pixels: 2,
      padding: 1,
    });
    const { data, info } = await sharp(result.png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const opaqueColors = new Set<string>();
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * 4;
        expect([0, 255]).toContain(data[offset + 3] ?? -1);
        if (
          y === 0 ||
          x === 0 ||
          y === info.height - 1 ||
          x === info.width - 1
        ) {
          expect(data[offset + 3]).toBe(0);
        }
        if (data[offset + 3] === 255) {
          opaqueColors.add(data.subarray(offset, offset + 3).toString("hex"));
        }
      }
    }
    expect([...opaqueColors].sort()).toEqual(["183d49", "80182a"]);
    expect((await processImage(png, ["#80182A", "#183D49"], 128)).png).toEqual(
      result.png,
    );
  });
  test("refuses opaque backgrounds, empty images and non-PNG input", async (): Promise<void> => {
    const opaque = await sharp({
      create: { width: 4, height: 4, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const empty = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    expect(await rejection(processImage(opaque, ["#80182A"], 128))).toThrow(
      "no fully transparent pixels",
    );
    expect(await rejection(processImage(empty, ["#80182A"], 128))).toThrow(
      "no opaque artwork",
    );
    expect(
      await rejection(processImage(Buffer.from("not PNG"), ["#80182A"], 128)),
    ).toThrow("must be PNG");
  });
});

describe("complete image sets and independent reruns", (): void => {
  test("reclean reprocesses traced originals without generating, keeping provenance", async (): Promise<void> => {
    await saveIdeas();
    await runImages(request(), { generate: generator() });

    const path = await runReclean(request());

    const manifest = z
      .object({
        recleaned_at: z.string(),
        processing: z.object({ version: z.literal(2) }),
        images: z.array(
          z.object({
            thread_id: z.literal("image-thread"),
            sha256: z.string(),
          }),
        ),
      })
      .parse(parse(await readFile(path, "utf8")));
    expect(manifest.images).toHaveLength(10);
    const first = await readFile(join(root, "dracula/raw/concept-1.png"));
    expect(manifest.images[0]?.sha256).toBe(sha256(first));
  });

  test("reclean refuses a trace that no longer matches the published set", async (): Promise<void> => {
    await saveIdeas();
    await runImages(request(), { generate: generator() });
    const manifestPath = join(root, "dracula/raw/manifest.yaml");
    const before = await readFile(manifestPath, "utf8");
    await writeFile(
      join(root, "dracula/traces/images/concept-1/attempt-1/generated.png"),
      "replaced",
    );

    const failure = await rejection(runReclean(request()));

    expect(failure).toThrow("differs from raw/manifest.yaml");
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  test("replaces one failed candidate and retains its original and failure for diagnosis", async (): Promise<void> => {
    await saveIdeas();
    let calls = 0;
    const replace: ImageGenerator = async (
      input,
    ): ReturnType<ImageGenerator> => {
      if (++calls === 1) {
        await input.onImage?.(png);
        throw new Error("Composition review failed");
      }
      if (calls === 2) {
        expect(input.prompt).toContain(
          "previous candidate failed: Composition review failed",
        );
      }
      return generator()(input);
    };
    const path = await runImages(request(), { generate: replace });
    expect(calls).toBe(11);
    expect(
      (
        await readFile(
          join(root, "dracula/traces/images/concept-1/attempt-1/generated.png"),
        )
      ).equals(png),
    ).toBe(true);
    expect(
      await readFile(
        join(root, "dracula/traces/images/concept-1/attempt-1/failure.json"),
        "utf8",
      ),
    ).toContain("Composition review failed");
    const input: unknown = parse(await readFile(path, "utf8"));
    expect(
      z
        .object({ images: z.array(z.object({ attempt: z.number() })) })
        .parse(input).images[0]?.attempt,
    ).toBe(2);
  });
  test("publishes exactly one PNG per idea with source identities and separate original traces", async (): Promise<void> => {
    const ideasPath = await saveIdeas();
    const manifestPath = await runImages(request(), { generate: generator() });
    expect((await readdir(join(root, "dracula/raw"))).sort()).toEqual(
      [
        ...ideasResponse().ideas.map((idea) => `${idea.id}.png`),
        "manifest.yaml",
      ].sort(),
    );
    const input: unknown = parse(await readFile(manifestPath, "utf8"));
    const manifest = z
      .object({
        ideas_sha256: z.string(),
        review_status: z.literal("unapproved"),
        images: z.array(
          z.object({
            idea_id: z.string(),
            sha256: z.string(),
            generated_sha256: z.string(),
            artwork_colors: z.array(z.string()),
            width: z.number(),
            height: z.number(),
            native_review_notes: z.array(z.string()),
          }),
        ),
      })
      .parse(input);
    expect(manifest.ideas_sha256).toBe(
      sha256(await readFile(ideasPath, "utf8")),
    );
    expect(manifest.images).toHaveLength(10);
    expect(manifest.images[0]?.native_review_notes).toEqual([
      "Inspect narrow features before conversion",
    ]);
    expect(manifest.images[0]?.sha256).toBe(
      sha256(await readFile(join(root, "dracula/raw/concept-1.png"))),
    );
    expect(manifest.images[0]?.generated_sha256).toBe(sha256(png));
    expect(
      (
        await readFile(
          join(root, "dracula/traces/images/concept-1/attempt-1/generated.png"),
        )
      ).equals(png),
    ).toBe(true);
    expect(await traceStatus()).toBe("completed");
    expect(await readdir(join(root, "dracula"))).not.toContain(".images.lock");
  });
  test("replaces all prior image IDs and traces while preserving ideas and later stages", async (): Promise<void> => {
    const ideasPath = await saveIdeas();
    await runImages(request(), { generate: generator() });
    await writeFile(join(root, "dracula/poster.pdf"), "poster");
    await writeFile(join(root, "dracula/traces/images/obsolete"), "old trace");
    await saveIdeas("new");
    const yaml = await readFile(ideasPath, "utf8");
    await runImages(request(), { generate: generator() });
    expect(await readdir(join(root, "dracula/raw"))).not.toContain(
      "concept-1.png",
    );
    expect(await readdir(join(root, "dracula/raw"))).toContain("new-1.png");
    expect(await readdir(join(root, "dracula/traces/images"))).not.toContain(
      "obsolete",
    );
    expect(await readFile(ideasPath, "utf8")).toBe(yaml);
    expect(await readFile(join(root, "dracula/poster.pdf"), "utf8")).toBe(
      "poster",
    );
  });
  test("a partial batch failure keeps the entire last valid set and permits retry", async (): Promise<void> => {
    await saveIdeas();
    const path = await runImages(request(), { generate: generator() });
    const previous = await readFile(path, "utf8");
    let count = 0;
    const fail: ImageGenerator = async (input): ReturnType<ImageGenerator> => {
      if (++count >= 3) {
        throw new Error("Connection lost");
      }
      return generator()(input);
    };
    await saveIdeas("replacement");
    expect(await rejection(runImages(request(), { generate: fail }))).toThrow(
      "Connection lost",
    );
    expect(await readFile(path, "utf8")).toBe(previous);
    expect(await readdir(join(root, "dracula/raw"))).toContain("concept-1.png");
    expect(await readdir(join(root, "dracula/raw"))).not.toContain(
      "replacement-1.png",
    );
    expect(await traceStatus()).toBe("failed");
    expect(await readdir(join(root, "dracula"))).not.toContain(".raw.staging");
    expect(await runImages(request(), { generate: generator() })).toBe(path);
  });
  test("invalid generated data does not publish a first batch", async (): Promise<void> => {
    await saveIdeas();
    const invalid: ImageGenerator = async (
      input,
    ): ReturnType<ImageGenerator> => ({
      ...(await generator()(input)),
      png: Buffer.from("bad"),
    });
    expect(
      await rejection(runImages(request(), { generate: invalid })),
    ).toThrow("must be PNG");
    expect(await readdir(join(root, "dracula"))).not.toContain("raw");
    expect(await traceStatus()).toBe("failed");
  });
  test("rejects generated colors that are absent from the idea", async (): Promise<void> => {
    await saveIdeas();
    const invalid: ImageGenerator = async (
      input,
    ): ReturnType<ImageGenerator> => ({
      ...(await generator()(input)),
      artworkColors: ["#FFFFFF"],
    });
    expect(
      await rejection(runImages(request(), { generate: invalid })),
    ).toThrow("outside its idea palette");
  });
  test("refuses stale registry identity and changed upstream ideas", async (): Promise<void> => {
    const path = await saveIdeas();
    let called = false;
    const changed: ImageGenerator = async (
      input,
    ): ReturnType<ImageGenerator> => {
      called = true;
      await writeFile(path, "changed");
      return generator()(input);
    };
    expect(
      await rejection(
        runImages(
          { ...request(), author: "Wrong Author" },
          { generate: changed },
        ),
      ),
    ).toThrow("identity differs");
    expect(called).toBe(false);
    expect(
      await rejection(runImages(request(), { generate: changed })),
    ).toThrow("changed during generation");
    expect(await readdir(join(root, "dracula"))).not.toContain("raw");
  });
  test("rejects missing or duplicate ideas before invoking generation", async (): Promise<void> => {
    expect(
      await rejection(runImages(request(), { generate: generator() })),
    ).toThrow();
    const path = await saveIdeas();
    const ideas = ideasResponse();
    ideas.ideas = ideas.ideas.map((idea) => ({ ...idea, id: "duplicate" }));
    await writeFile(
      path,
      stringify({
        schema_version: 2,
        book: { title: "Dracula", author: "Bram Stoker", slug: "dracula" },
        generation: {},
        ...ideas,
      }),
    );
    expect(
      await rejection(runImages(request(), { generate: generator() })),
    ).toThrow("duplicate idea IDs");
    expect(await readdir(join(root, "dracula"))).toEqual(["ideas.yaml"]);
  });
  test("an overlapping run leaves the active trace alone", async (): Promise<void> => {
    await saveIdeas();
    await mkdir(join(root, "dracula/.images.lock"));
    await mkdir(join(root, "dracula/traces/images"), { recursive: true });
    await writeFile(join(root, "dracula/traces/images/run.json"), "active");
    expect(
      await rejection(runImages(request(), { generate: generator() })),
    ).toThrow("already active");
    expect(
      await readFile(join(root, "dracula/traces/images/run.json"), "utf8"),
    ).toBe("active");
  });
  test("interruption and per-image timeout release the lock without publishing", async (): Promise<void> => {
    await saveIdeas();
    expect(
      await rejection(
        runImages(request(), {
          generate: generator(),
          signal: AbortSignal.abort(new Error("Interrupted")),
        }),
      ),
    ).toThrow("Interrupted");
    const stalled: ImageGenerator = async ({
      signal,
    }): ReturnType<ImageGenerator> => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          (): void => {
            resolve();
          },
          { once: true },
        );
      });
      signal.throwIfAborted();
      throw new Error("unreachable");
    };
    expect(
      await rejection(
        runImages({ ...request(), timeoutSeconds: 1 }, { generate: stalled }),
      ),
    ).toThrow("timed out");
    expect(await readdir(join(root, "dracula"))).not.toContain(".images.lock");
    expect(await readdir(join(root, "dracula"))).not.toContain("raw");
  });
  test("recovers the prior valid set after a killed directory replacement", async (): Promise<void> => {
    await saveIdeas();
    await mkdir(join(root, "dracula/.raw.previous"));
    await writeFile(join(root, "dracula/.raw.previous/master.png"), "previous");
    const fail: ImageGenerator = (): ReturnType<ImageGenerator> => {
      throw new Error("unavailable");
    };
    expect(await rejection(runImages(request(), { generate: fail }))).toThrow(
      "unavailable",
    );
    expect(await readFile(join(root, "dracula/raw/master.png"), "utf8")).toBe(
      "previous",
    );
  });
  test("brief preserves composition and excludes underlying paper colors and conversion", (): void => {
    const idea = ideasResponse().ideas[0];
    if (!idea) {
      throw new Error("fixture missing");
    }
    const prompt = buildImagePrompt(request(), idea);
    expect(prompt).toContain(idea.composition);
    expect(prompt).toContain(
      "Exclude only colors whose sole intended use is the underlying paper",
    );
    expect(prompt).toContain("Do not perform character conversion");
    expect(prompt).toContain("transparent_background=true");
  });
});
