import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { parse, stringify } from "yaml";

import { runCli } from "../src/cli.ts";
import {
  assignCharacters,
  convertToCharacters,
  decodeMaster,
  sampleGrid,
} from "../src/render/convert.ts";
import { loadRenderFont, supportedCharacters } from "../src/render/font.ts";
import { sha256, type RenderRequest } from "../src/render/input.ts";
import { targetLayout } from "../src/render/raster.ts";
import { runRender } from "../src/render/run.ts";
import { normalizeRenderText } from "../src/render/text.ts";
import { ideasResponse, rejection } from "./fixtures.ts";

let root: string;
let bookDirectory: string;
let image: Buffer;
const book = {
  slug: "dracula",
  title: "Dracula",
  author: "Bram Stoker",
  gutenberg_id: 345,
};
const target = {
  name: "Test poster",
  size_inches: { width: 0.6, height: 0.8 },
  canvas_px: { width: 186, height: 250 },
  bleed_px: { top: 4, right: 4, bottom: 6, left: 2 },
  gutter_px: { top: 5, right: 5, bottom: 5, left: 5 },
};

function request(): RenderRequest {
  return {
    ...book,
    idea: "concept-1",
    targetRegistry: join(root, "targets.yaml"),
    outputRoot: root,
    background: "#FFFFFF",
  };
}

function posterPath(id = "small"): string {
  return join(bookDirectory, "print", "concept-1", id, "poster.png");
}

beforeEach(async (): Promise<void> => {
  root = await mkdtemp(join(tmpdir(), "bookgen-render-"));
  bookDirectory = join(root, "dracula");
  await mkdir(join(bookDirectory, "raw"), { recursive: true });
  await mkdir(join(bookDirectory, "text"));
  const ideas = stringify({
    schema_version: 2,
    book: { slug: book.slug, title: book.title, author: book.author },
    ...ideasResponse(),
  });
  const pixels = Buffer.from([
    255, 0, 0, 255, 12, 34, 56, 0, 0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0,
    255, 0, 0, 0, 0,
  ]);
  image = await sharp(pixels, { raw: { width: 3, height: 2, channels: 4 } })
    .png()
    .toBuffer();
  const text = "**AB** \n C";
  await Promise.all([
    writeFile(join(bookDirectory, "ideas.yaml"), ideas),
    writeFile(join(bookDirectory, "raw", "concept-1.png"), image),
    writeFile(
      join(bookDirectory, "raw", "manifest.yaml"),
      stringify({
        schema_version: 1,
        book: { slug: book.slug, title: book.title, author: book.author },
        ideas_sha256: sha256(ideas),
        images: [
          {
            idea_id: "concept-1",
            path: "concept-1.png",
            sha256: sha256(image),
            width: 3,
            height: 2,
          },
        ],
      }),
    ),
    writeFile(join(bookDirectory, "text", "book.txt"), text),
    writeFile(
      join(bookDirectory, "text", "manifest.yaml"),
      stringify({
        schema_version: 1,
        book: { ...book, language: "en" },
        text: { path: "book.txt", sha256: sha256(text) },
      }),
    ),
    writeFile(
      join(root, "targets.yaml"),
      stringify({
        schema_version: 1,
        targets: {
          small: target,
          large: { ...target, canvas_px: { width: 276, height: 370 } },
        },
      }),
    ),
  ]);
});

afterEach(async (): Promise<void> => {
  await rm(root, { recursive: true, force: true });
});

describe("render text and character conversion", (): void => {
  test("removes presentation while retaining words, punctuation, and link labels", (): void => {
    const source =
      "# Title\n\n**Bold** _under_ ~~strike~~ `code` [label](https://example.com) <u>word</u> &amp; end!\n\n- first\n- second\n\n---\n\n<script>hidden</script>";
    expect(normalizeRenderText(source).join("")).toBe(
      "Title Bold under strike code label word & end! first second",
    );
    expect(normalizeRenderText("e\u0301\tA\u00a0B\u200bC").join("")).toBe(
      "é A BC",
    );
    expect(() => normalizeRenderText(" \n ** _ ~ `\t")).toThrow(
      "no characters",
    );
  });

  test("preserves word spacing across prose, Markdown blocks, and explicit line breaks", (): void => {
    expect(normalizeRenderText("I ate a sandwich").join("")).toBe(
      "I ate a sandwich",
    );
    expect(normalizeRenderText("I  ate\n\ta **sandwich**").join("")).toBe(
      "I ate a sandwich",
    );
    expect(
      normalizeRenderText("First paragraph.\n\nSecond paragraph.").join(""),
    ).toBe("First paragraph. Second paragraph.");
    expect(
      normalizeRenderText("a<br>b\n\n<div>c</div><div>d</div>").join(""),
    ).toBe("a b c d");
  });

  test("background pixels never consume text, while word spaces occupy blank artwork cells", (): void => {
    const source = {
      width: 7,
      height: 1,
      rgba: Buffer.from([
        255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0, 0,
        255, 255, 250, 244, 232, 255, 254, 254, 254, 255,
      ]),
    };
    const art = assignCharacters(source, Array.from("A B"), "#FAF4E8");
    expect(Array.from(art.characterIndices)).toEqual([1, 0, 0, 2, 3, 0, 1]);
    expect(art.characterCount).toBe(4);
    expect(art.backgroundPixels).toBe(2);
    expect(art.transparentPixels).toBe(1);
    expect(art.characters[1]).toBe(" ");
    expect(() =>
      assignCharacters(
        { width: 1, height: 1, rgba: Buffer.from([255, 255, 255, 255]) },
        ["A"],
      ),
    ).toThrow("no visible artwork");
  });

  test("keeps fenced content and table cells without their formatting", (): void => {
    expect(
      normalizeRenderText(
        "```text\nhello world\n```\n\n| A | B |\n|---|---|\n| C | D |",
      ).join(""),
    ).toBe("hello world A B C D");
  });

  test("assigns one character per opaque pixel, skips transparent pixels, and wraps", async (): Promise<void> => {
    const art = await convertToCharacters(image, ["A", "B", "C"]);
    expect(Array.from(art.characterIndices)).toEqual([1, 0, 2, 3, 1, 0]);
    expect(art.characterCount).toBe(4);
    expect(Array.from(art.rgba.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  });

  test("nearest-neighbor sampling preserves source colors and binary alpha", async (): Promise<void> => {
    const source = await decodeMaster(image);
    const grid = sampleGrid(source, 6, 4);
    const art = assignCharacters(grid, ["A", "B", "C"]);
    expect(art.characterCount).toBe(16);
    expect(Array.from(grid.rgba.subarray(0, 16))).toEqual([
      255, 0, 0, 255, 255, 0, 0, 255, 12, 34, 56, 0, 12, 34, 56, 0,
    ]);
    expect(source.width).toBe(3);
    expect(source.height).toBe(2);
    const reduced = sampleGrid(source, 1, 2);
    expect(Array.from(reduced.rgba)).toEqual([12, 34, 56, 0, 255, 0, 0, 255]);
  });

  test("uses only the leading text when the grid cannot fit the full content", async (): Promise<void> => {
    const art = await convertToCharacters(image, Array.from("ABCDEFGHIJ"));
    expect(Array.from(art.characterIndices)).toEqual([1, 0, 2, 3, 4, 0]);
    expect(art.characters[3]).toBe("D");
  });

  test("rejects partial alpha, empty artwork, and empty text", async (): Promise<void> => {
    for (const alpha of [0, 128]) {
      const png = await sharp(Buffer.from([100, 50, 10, alpha]), {
        raw: { width: 1, height: 1, channels: 4 },
      })
        .png()
        .toBuffer();
      expect(await rejection(convertToCharacters(png, ["A"]))).toThrow();
    }
    expect(await rejection(convertToCharacters(image, []))).toThrow(
      "nonempty text",
    );
  });

  test("records unsupported glyph replacements instead of relying on system fonts", async (): Promise<void> => {
    const font = await loadRenderFont();
    expect(supportedCharacters(["A", " ", "界", "界"], font.font)).toEqual({
      characters: ["A", " ", "?", "?"],
      replacements: ["界"],
    });
  });
});

describe("print layout and publication", (): void => {
  test("fits a rectangular grid without shrinking the 6.5 pt font", (): void => {
    const metrics = { top: 0.8, bottom: -0.2 };
    const layout = targetLayout(
      { width: 3, height: 2 },
      { ...target, id: "small" },
      metrics,
    );
    expect(layout).toMatchObject({
      fontSizePoints: 6.5,
      cellWidth: 18,
      cellHeight: 28,
      gridWidth: 9,
      gridHeight: 4,
      left: 11,
      top: 68,
      width: 162,
      height: 112,
      ppi: 300,
    });
    expect(layout.fontSizePixels).toBeCloseTo(27.0833333);
    expect(() =>
      targetLayout(
        { width: 100000, height: 1 },
        { ...target, id: "small" },
        metrics,
      ),
    ).toThrow("too small");
    expect(() =>
      targetLayout(
        { width: 3, height: 2 },
        { ...target, id: "bad", size_inches: { width: 3, height: 3 } },
        metrics,
      ),
    ).toThrow("resolution");
    const larger = targetLayout(
      { width: 1066, height: 1578 },
      {
        id: "poster-24x36",
        name: "24 × 36",
        canvas_px: { width: 7200, height: 10800 },
        size_inches: { width: 24, height: 36 },
        bleed_px: { top: 0, right: 0, bottom: 0, left: 0 },
        gutter_px: { top: 150, right: 150, bottom: 150, left: 150 },
      },
      metrics,
    );
    expect(larger.fontSizePixels).toBe(layout.fontSizePixels);
    expect(larger.gridWidth).toBeGreaterThan(layout.gridWidth);
    expect(larger.gridHeight).toBeLessThan(1578);
  });

  test("renders all targets with correct dimensions, background-only borders, colors, and provenance", async (): Promise<void> => {
    const outputs = await runRender(request());
    expect(outputs).toEqual([posterPath(), posterPath("large")]);
    const png = await readFile(posterPath());
    const metadata = await sharp(png).metadata();
    expect(metadata.width).toBe(186);
    expect(metadata.height).toBe(250);
    expect(metadata.density).toBe(300);
    expect(metadata.hasAlpha).toBe(false);
    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const colors = new Set<string>();
    let redInk = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const pixel = Array.from(
          data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3),
        );
        colors.add(pixel.join(","));
        if (
          x < 7 ||
          x >= 177 ||
          y < 9 ||
          y >= 239 ||
          (x >= 65 && x < 119 && y >= 68 && y < 124) ||
          (x >= 47 && x < 65 && y >= 68 && y < 96)
        ) {
          expect(pixel).toEqual([255, 255, 255]);
        }
        if (
          pixel[0] === 255 &&
          (pixel[1] ?? 255) < 255 &&
          pixel[1] === pixel[2]
        ) {
          redInk++;
        }
      }
    }
    expect(redInk).toBeGreaterThan(0);
    expect(colors.has("255,0,0")).toBe(true);
    expect(colors.has("0,255,0")).toBe(true);
    expect(colors.has("0,0,255")).toBe(true);
    expect(metadata.space).toBe("srgb");
    expect(metadata.hasProfile).toBe(true);
    const manifest: unknown = parse(
      await readFile(
        join(bookDirectory, "print/concept-1/small/manifest.yaml"),
        "utf8",
      ),
    );
    expect(manifest).toMatchObject({
      idea_id: "concept-1",
      target: { id: "small" },
      conversion: {
        character_count: 24,
        text_characters: 4,
        full_text_cycles: 6,
        remaining_characters: 0,
        grid_width: 9,
        grid_height: 4,
      },
      output: { sha256: sha256(png) },
    });
  });

  test("a single-target rerun preserves other targets and upstream files and is deterministic", async (): Promise<void> => {
    await runRender(request());
    const prior = await readFile(posterPath());
    const other = await readFile(posterPath("large"));
    await writeFile(
      join(bookDirectory, "print/concept-1/small/obsolete.txt"),
      "old",
    );
    await runRender({ ...request(), target: "small" });
    expect(await readFile(posterPath())).toEqual(prior);
    expect(await readFile(posterPath("large"))).toEqual(other);
    expect(
      (await readdir(join(bookDirectory, "print/concept-1/small"))).sort(),
    ).toEqual(["manifest.yaml", "poster.png"]);
    expect(
      sha256(await readFile(join(bookDirectory, "raw/concept-1.png"))),
    ).toBe(sha256(image));
    expect(await readFile(join(bookDirectory, "text/book.txt"), "utf8")).toBe(
      "**AB** \n C",
    );
  });

  test("stale or changed upstream inputs preserve the previous complete batch", async (): Promise<void> => {
    await runRender(request());
    const prior = await readFile(posterPath());
    const large = await readFile(posterPath("large"));
    const textPath = join(bookDirectory, "text/book.txt");
    expect(
      await rejection(
        runRender(request(), {
          signal: AbortSignal.abort(),
        }),
      ),
    ).toThrow();
    await writeFile(textPath, "modified");
    expect(await rejection(runRender(request()))).toThrow("hash mismatch");
    await writeFile(textPath, "**AB** \n C");
    const controller = new AbortController();
    expect(
      await rejection(
        runRender(request(), {
          signal: controller.signal,
          onProgress: (message): void => {
            if (message.includes("large")) {
              controller.abort(new Error("stop batch"));
            }
          },
        }),
      ),
    ).toThrow("stop batch");
    expect(await readFile(posterPath())).toEqual(prior);
    expect(await readFile(posterPath("large"))).toEqual(large);
    expect(await readdir(bookDirectory)).not.toContain(".render.lock");
  });

  test("rechecks snapshots before publication", async (): Promise<void> => {
    await runRender(request());
    const prior = await readFile(posterPath());
    let mutation: Promise<void> | undefined;
    expect(
      await rejection(
        runRender(request(), {
          onProgress: (): void => {
            mutation = writeFile(
              join(bookDirectory, "text/book.txt"),
              "changed during render",
            );
          },
        }),
      ),
    ).toThrow("changed during rendering");
    await mutation;
    expect(await readFile(posterPath())).toEqual(prior);
  });

  test("recovers interrupted publication and rejects concurrent runs", async (): Promise<void> => {
    await runRender(request());
    const print = join(bookDirectory, "print");
    await rename(join(print, "concept-1"), join(print, ".concept-1.previous"));
    await runRender({ ...request(), target: "small" });
    expect(await Bun.file(posterPath("large")).exists()).toBe(true);
    await mkdir(join(bookDirectory, ".render.lock"));
    expect(await rejection(runRender(request()))).toThrow("already active");
  });

  test("rejects unknown selections and stale ideas before publishing", async (): Promise<void> => {
    expect(
      await rejection(runRender({ ...request(), target: "absent" })),
    ).toThrow("No matching");
    expect(
      await rejection(runRender({ ...request(), idea: "absent" })),
    ).toThrow("Unknown or ungenerated");
    await writeFile(
      join(bookDirectory, "ideas.yaml"),
      (await readFile(join(bookDirectory, "ideas.yaml"), "utf8")) + "\n",
    );
    expect(await rejection(runRender(request()))).toThrow("stale");
    expect(await readdir(bookDirectory)).not.toContain("print");
  });
});

describe("render CLI", (): void => {
  test.each([undefined, "poster-18x24"])(
    "defaults to all targets and passes an explicit target: %s",
    async (targetId): Promise<void> => {
      const args = ["render", "dracula", "--idea", "concept-1"];
      if (targetId) {
        args.push("--target", targetId);
      }
      let called = false;
      let output = "";
      expect(
        await runCli(args, {
          render: (input): Promise<string[]> => {
            called = true;
            expect(input.target).toBe(targetId);
            expect(input.idea).toBe("concept-1");
            expect(input.background).toBe("#FFFFFF");
            return Promise.resolve(["/one/poster.png", "/two/poster.png"]);
          },
          stdout: (message): void => {
            output += message;
          },
        }),
      ).toBe(0);
      expect(called).toBe(true);
      expect(output).toBe("/one/poster.png\n/two/poster.png\n");
    },
  );

  test("help works without inputs and missing or unsafe selections never render", async (): Promise<void> => {
    for (const args of [
      ["render", "dracula"],
      ["render", "dracula", "--idea", "../bad"],
      ["render", "dracula", "--idea", "valid", "--background", "red"],
    ]) {
      let called = false;
      expect(
        await runCli(args, {
          render: (): Promise<string[]> => {
            called = true;
            return Promise.resolve([]);
          },
          stdout: (): void => {},
          stderr: (): void => {},
        }),
      ).toBe(1);
      expect(called).toBe(false);
    }
    expect(await runCli(["render", "--help"], { stdout: (): void => {} })).toBe(
      0,
    );
  });
});
