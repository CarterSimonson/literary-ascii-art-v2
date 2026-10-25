import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { parse, stringify } from "yaml";

import { replaceSuiteIdea } from "../src/evals/ideas.ts";
import {
  runJudgeCheck,
  summarize,
  type Comparison,
  type Judge,
} from "../src/evals/judge.ts";
import { planNextRound, type PromptWriter } from "../src/evals/improve.ts";
import { measureImage } from "../src/evals/metrics.ts";
import { runRound, type RunRoundArgs } from "../src/evals/round.ts";
import { startPortal } from "../src/evals/serve.ts";
import { loadSuite } from "../src/evals/suite.ts";
import type { ImageGenerator } from "../src/images/codex.ts";
import type { SourceImage } from "../src/render/convert.ts";
import {
  fakeGenerator as fakeIdeaGenerator,
  fixtureUsage,
  ideasResponse,
  rejection,
  responseEvents,
} from "./fixtures.ts";

type Rgba = [number, number, number, number];

const INK: Rgba = [0x26, 0x3d, 0x48, 255];
const ACCENT: Rgba = [0x52, 0x74, 0x5d, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

// The shirts idea's primary ink.
const SHIRTS_INK: Rgba = [0x56, 0x3e, 0x4b, 255];

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
function field(x: number, y: number, ink = INK): Rgba {
  if (!between(x, 0, 39) || !between(y, 0, 39)) {
    return CLEAR;
  }

  if (between(x, 15, 24) && between(y, 15, 24)) {
    return CLEAR;
  }

  return ink;
}

async function fieldPng(): Promise<Buffer> {
  const image = paint(48, 48, (x, y) => field(x - 4, y - 4, SHIRTS_INK));

  return sharp(image.rgba, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

interface RoundFixture {
  root: string;
  prompts: string;
  args: (generate: ImageGenerator) => RunRoundArgs;
}

// A one-idea suite, two prompt templates, fetched text, and a tiny 24 × 36
// target, so a whole round renders in milliseconds.
async function roundFixture(): Promise<RoundFixture> {
  const root = await mkdtemp(join(tmpdir(), "bookgen-round-"));
  const suite = join(root, "suite");
  const prompts = join(root, "prompts");

  await mkdir(join(suite, "cases", "the-great-gatsby"), { recursive: true });
  await cp(
    "tests/fixtures/eval-suite/the-great-gatsby/the-weight-of-shirts.yaml",
    join(suite, "cases", "the-great-gatsby", "the-weight-of-shirts.yaml"),
  );
  await writeFile(
    join(suite, "suite.yaml"),
    "schema_version: 2\nsuite_version: 1\ncases:\n  - book: the-great-gatsby\n    idea: the-weight-of-shirts\n",
  );

  await mkdir(prompts);
  await writeFile(
    join(prompts, "control.prompt.md"),
    "Draw {{name}} from {{title}} in {{palette}}.",
  );
  await writeFile(
    join(prompts, "flat.prompt.md"),
    "Draw {{name}} as a flat screen print.",
  );
  await writeFile(join(prompts, "notes.md"), "flat: tests a flatter look.");

  const text = join(root, "output", "the-great-gatsby", "text");
  await mkdir(text, { recursive: true });
  await writeFile(
    join(text, "book.txt"),
    "In my younger and more vulnerable years.\n",
  );

  const targets = join(root, "targets.yaml");
  await writeFile(
    targets,
    [
      "schema_version: 1",
      "targets:",
      "  poster-24x36:",
      "    name: Tiny 24 x 36",
      "    size_inches: { width: 0.6, height: 0.9 }",
      "    canvas_px: { width: 180, height: 270 }",
      "    bleed_px: { top: 0, right: 0, bottom: 0, left: 0 }",
      "    gutter_px: { top: 5, right: 5, bottom: 5, left: 5 }",
      "",
    ].join("\n"),
  );

  return {
    root,
    prompts,
    args: (generate) => ({
      roundId: "round-1",
      outputRoot: join(root, "output"),
      suiteDirectory: suite,
      targetRegistry: targets,
      concurrency: 2,
      timeoutSeconds: 60,
      generate,
    }),
  };
}

function fakeGenerator(
  prompts: string[],
  colors = ["#563E4B"],
  gate: Promise<void> = Promise.resolve(),
): ImageGenerator {
  return async (input) => {
    prompts.push(input.prompt);
    await gate;

    return {
      png: await fieldPng(),
      artworkColors: colors,
      threadId: "fixture-thread",
      usage: fixtureUsage,
      reviewNotes: [],
    };
  };
}

async function readResult(
  root: string,
  prompt: string,
): Promise<Record<string, unknown>> {
  const path = join(
    root,
    "output",
    "evals",
    "rounds",
    "round-1",
    "images",
    prompt,
    "the-great-gatsby",
    "the-weight-of-shirts",
    "result.yaml",
  );

  return parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("image-prompt suite", () => {
  test("the committed suite freezes three ideas from each of three books", async () => {
    const suite = await loadSuite();

    expect(suite.cases).toHaveLength(9);
    expect(new Set(suite.cases.map((entry) => entry.book.slug))).toEqual(
      new Set(["the-great-gatsby", "odyssey", "war-of-the-worlds"]),
    );
    expect(suite.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("a case file holding a different idea is rejected", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bookgen-suite-"));
    await cp("evals/image-prompt", directory, { recursive: true });
    const suite = await loadSuite({ directory });
    const [first, second] = suite.cases;

    if (!first || !second) {
      throw new Error("The suite needs at least two cases");
    }

    await cp(
      join(directory, "cases", first.book.slug, `${first.idea.id}.yaml`),
      join(directory, "cases", second.book.slug, `${second.idea.id}.yaml`),
    );

    const failure = await rejection(loadSuite({ directory }));

    expect(failure).toThrow(`its file name requires '${second.idea.id}'`);
  });
});

describe("eval rounds", () => {
  test("a round renders and records every prompt × idea, and a rerun skips finished images", async () => {
    const fixture = await roundFixture();
    const prompts: string[] = [];

    const first = await runRound({
      ...fixture.args(fakeGenerator(prompts)),
      promptsDirectory: fixture.prompts,
    });

    expect(first).toMatchObject({ done: 2, failed: 0, skipped: 0 });
    expect(prompts).toContain(
      "Draw The Weight of Shirts as a flat screen print.",
    );

    const result = await readResult(fixture.root, "control");
    expect(result).toMatchObject({ status: "done", attempt: 1 });
    expect(result.metrics).toEqual({ native_haze: 0, accent_contact: null });

    const preview = await sharp(
      join(
        first.directory,
        "images",
        "control",
        "the-great-gatsby",
        "the-weight-of-shirts",
        "attempt-1",
        "preview.png",
      ),
    ).metadata();
    expect(preview.width).toBe(60);

    const second = await runRound(fixture.args(fakeGenerator(prompts)));

    expect(second).toMatchObject({ done: 0, skipped: 2 });
    expect(prompts).toHaveLength(2);
  });

  test("a failed image is recorded, and the next run retries it as a new attempt", async () => {
    const fixture = await roundFixture();
    const working = fakeGenerator([]);
    let calls = 0;
    const failingOnce: ImageGenerator = async (input) => {
      calls++;

      if (calls === 1) {
        throw new Error("Native image tool unavailable");
      }

      return working(input);
    };

    const first = await runRound({
      ...fixture.args(failingOnce),
      promptsDirectory: fixture.prompts,
      concurrency: 1,
    });

    expect(first).toMatchObject({ done: 1, failed: 1 });
    expect(await readResult(fixture.root, "control")).toMatchObject({
      status: "failed",
      error: "Native image tool unavailable",
    });

    await runRound(fixture.args(failingOnce));

    expect(await readResult(fixture.root, "control")).toMatchObject({
      status: "done",
      attempt: 2,
    });
  });

  test("a template with an unknown placeholder is rejected before generating", async () => {
    const fixture = await roundFixture();
    await writeFile(join(fixture.prompts, "typo.prompt.md"), "Draw {{nmae}}.");
    const prompts: string[] = [];

    const failure = await rejection(
      runRound({
        ...fixture.args(fakeGenerator(prompts)),
        promptsDirectory: fixture.prompts,
      }),
    );

    expect(failure).toThrow("Unknown image prompt placeholder {{nmae}}");
    expect(prompts).toHaveLength(0);
  });

  test("a rating saved from the page is stored with the image it judged", async () => {
    const fixture = await roundFixture();
    await runRound({
      ...fixture.args(fakeGenerator([])),
      promptsDirectory: fixture.prompts,
    });
    const { server } = startPortal({
      outputRoot: join(fixture.root, "output"),
      port: 0,
    });
    const base = `http://127.0.0.1:${String(server.port)}`;

    try {
      const saved = await fetch(`${base}/api/rounds/round-1/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "flat",
          book: "the-great-gatsby",
          idea: "the-weight-of-shirts",
          stars: 4,
          tags: ["ragged", "haze"],
          note: "Edges are crisp; a little haze at the collar.",
        }),
      });
      expect(saved.status).toBe(200);

      const view = (await (
        await fetch(`${base}/api/rounds/round-1`)
      ).json()) as { cells: { key: string; feedback: unknown }[] };
      const rated = view.cells.find(
        (image) => image.key === "flat/the-great-gatsby/the-weight-of-shirts",
      );
      expect(rated?.feedback).toMatchObject({ stars: 4, attempt: 1 });

      const log = await readFile(
        join(
          fixture.root,
          "output",
          "evals",
          "rounds",
          "round-1",
          "feedback.jsonl",
        ),
        "utf8",
      );
      expect(JSON.parse(log.trim())).toMatchObject({
        prompt: "flat",
        stars: 4,
        tags: ["ragged", "haze"],
        master_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
      });

      const page = await fetch(`${base}/`);
      expect(await page.text()).toContain("<title>Prompt Rounds</title>");
    } finally {
      await server.stop();
    }
  });
});

// A template that passes the prompt agent's checks.
const VALID_TEMPLATE =
  "Draw {{name}} ({{composition}}; {{literary_basis}}) from {{title}} by {{author}} in {{palette}}, as a flat screen print. Use transparent_background=true, save master.png, and return artwork_colors and review_notes.";

interface WriterCall {
  text: string;
  images: string[];
}

function fakeWriter(
  calls: WriterCall[],
  prompts: { id: string; template: string }[],
): PromptWriter {
  return async (input) => {
    calls.push({
      text: input.input
        .map((item) => (item.type === "text" ? item.text : ""))
        .join("\n"),
      images: input.input.flatMap((item) =>
        item.type === "local_image" ? [item.path] : [],
      ),
    });

    return Promise.resolve({
      response: JSON.stringify({
        analysis: "Flat prints scored higher; haze persists in the control.",
        prompts: prompts.map((prompt) => ({
          ...prompt,
          hypothesis: `Testing ${prompt.id}`,
        })),
      }),
      usage: fixtureUsage,
    });
  };
}

async function rate(
  root: string,
  ratings: { prompt: string; stars: number; note: string }[],
  roundId = "round-1",
): Promise<void> {
  const { server } = startPortal({ outputRoot: join(root, "output"), port: 0 });

  try {
    for (const rating of ratings) {
      await fetch(
        `http://127.0.0.1:${String(server.port)}/api/rounds/${roundId}/feedback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: rating.prompt,
            book: "the-great-gatsby",
            idea: "the-weight-of-shirts",
            stars: rating.stars,
            tags: [],
            note: rating.note,
          }),
        },
      );
    }
  } finally {
    await server.stop();
  }
}

describe("next rounds", () => {
  test("the prompt agent sees ratings and posters, and the best prompt carries forward unchanged", async () => {
    const fixture = await roundFixture();
    await runRound({
      ...fixture.args(fakeGenerator([])),
      promptsDirectory: fixture.prompts,
    });
    await rate(fixture.root, [
      { prompt: "control", stars: 2, note: "Hazy collar" },
      { prompt: "flat", stars: 4, note: "Crisp edges" },
    ]);
    const calls: WriterCall[] = [];

    const planned = await planNextRound({
      outputRoot: join(fixture.root, "output"),
      kind: "image",
      direction: "Keep the edges crisp",
      newPrompts: 1,
      suiteDirectory: join(fixture.root, "suite"),
      writer: fakeWriter(calls, [
        { id: "solid-block", template: VALID_TEMPLATE },
      ]),
    });

    expect(planned.roundId).toBe("round-2");
    expect(calls[0]?.text).toContain("Crisp edges");
    expect(calls[0]?.text).toContain("Keep the edges crisp");
    expect(calls[0]?.images).toHaveLength(2);
    expect(
      await readFile(join(planned.promptsDirectory, "flat.prompt.md"), "utf8"),
    ).toBe("Draw {{name}} as a flat screen print.");
    expect(
      await readFile(join(planned.promptsDirectory, "notes.md"), "utf8"),
    ).toContain("flat (control): best so far");
  });

  test("a new prompt that drops a required instruction is rejected", async () => {
    const fixture = await roundFixture();
    await runRound({
      ...fixture.args(fakeGenerator([])),
      promptsDirectory: fixture.prompts,
    });
    await rate(fixture.root, [{ prompt: "flat", stars: 3, note: "" }]);

    const failure = await rejection(
      planNextRound({
        outputRoot: join(fixture.root, "output"),
        kind: "image",
        direction: "",
        newPrompts: 1,
        suiteDirectory: join(fixture.root, "suite"),
        writer: fakeWriter(
          [],
          [
            {
              id: "short",
              template: VALID_TEMPLATE.replace("master.png", "a file"),
            },
          ],
        ),
      }),
    );

    expect(failure).toThrow("dropped the required instruction 'master.png'");
  });

  test("clicking next round on the page writes prompts and generates the new round", async () => {
    const fixture = await roundFixture();
    await runRound({
      ...fixture.args(fakeGenerator([])),
      promptsDirectory: fixture.prompts,
    });
    await rate(fixture.root, [{ prompt: "flat", stars: 4, note: "Good" }]);
    const generated: string[] = [];
    const { server, tasks } = startPortal({
      outputRoot: join(fixture.root, "output"),
      port: 0,
      suiteDirectory: join(fixture.root, "suite"),
      targetRegistry: join(fixture.root, "targets.yaml"),
      writer: fakeWriter([], [{ id: "solid-block", template: VALID_TEMPLATE }]),
      generate: fakeGenerator(generated),
    });
    const base = `http://127.0.0.1:${String(server.port)}`;

    try {
      const started = await fetch(`${base}/api/next`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "image", direction: "", newPrompts: 1 }),
      });
      expect(started.status).toBe(200);
      await tasks.idle();

      const [task] = (await (await fetch(`${base}/api/tasks`)).json()) as {
        state: string;
        message: string;
        error: string | null;
      }[];
      expect(task).toMatchObject({ state: "done", error: null });
      expect(task?.message).toContain("round-2: 2 generated");
      expect(await (await fetch(`${base}/api/rounds`)).json()).toEqual([
        "round-2",
        "round-1",
      ]);
    } finally {
      await server.stop();
    }
  });

  test("replacing an idea swaps it in the suite and retires the old one", async () => {
    const fixture = await roundFixture();
    const suiteDirectory = join(fixture.root, "suite");

    const idea = await replaceSuiteIdea({
      book: "the-great-gatsby",
      idea: "the-weight-of-shirts",
      reason: "Too literal",
      suiteDirectory,
      generate: fakeIdeaGenerator(
        responseEvents(JSON.stringify(ideasResponse("fresh", 1))),
      ),
    });

    const suite = await loadSuite({ directory: suiteDirectory });
    expect(idea.id).toBe("fresh-1");
    expect(suite.cases.map((entry) => entry.id)).toEqual([
      "the-great-gatsby/fresh-1",
    ]);
    expect(suite.suiteVersion).toBe(2);
    expect(
      parse(
        await readFile(
          join(
            suiteDirectory,
            "retired",
            "the-great-gatsby",
            "the-weight-of-shirts.yaml",
          ),
          "utf8",
        ),
      ),
    ).toMatchObject({ retired: { reason: "Too literal" } });
  });

  test("two images regenerate in parallel, and the same image twice is refused", async () => {
    const fixture = await roundFixture();
    await runRound({
      ...fixture.args(fakeGenerator([])),
      promptsDirectory: fixture.prompts,
    });
    let open = (): void => {};
    const gate = new Promise<void>((resolveGate) => {
      open = resolveGate;
    });
    const generated: string[] = [];
    const { server, tasks } = startPortal({
      outputRoot: join(fixture.root, "output"),
      port: 0,
      suiteDirectory: join(fixture.root, "suite"),
      targetRegistry: join(fixture.root, "targets.yaml"),
      generate: fakeGenerator(generated, ["#563E4B"], gate),
    });
    const regenerate = async (key: string): Promise<Response> =>
      fetch(
        `http://127.0.0.1:${String(server.port)}/api/rounds/round-1/regenerate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key }),
        },
      );

    try {
      const control = "control/the-great-gatsby/the-weight-of-shirts";
      const flat = "flat/the-great-gatsby/the-weight-of-shirts";

      expect((await regenerate(control)).status).toBe(200);
      expect((await regenerate(flat)).status).toBe(200);
      const duplicate = await regenerate(control);
      expect(duplicate.status).toBe(400);
      expect(await duplicate.text()).toContain("Already running");

      open();
      await tasks.idle();

      expect(generated).toHaveLength(2);
      expect(await readResult(fixture.root, "control")).toMatchObject({
        attempt: 2,
      });
      expect(await readResult(fixture.root, "flat")).toMatchObject({
        attempt: 2,
      });
    } finally {
      await server.stop();
    }
  });

  test("an ideas round writes fresh ideas per prompt and draws them with the best image prompt", async () => {
    const fixture = await roundFixture();
    await runRound({
      ...fixture.args(fakeGenerator([])),
      promptsDirectory: fixture.prompts,
    });
    await rate(fixture.root, [{ prompt: "flat", stars: 4, note: "Good" }]);
    const generated: string[] = [];
    const { server, tasks } = startPortal({
      outputRoot: join(fixture.root, "output"),
      port: 0,
      suiteDirectory: join(fixture.root, "suite"),
      targetRegistry: join(fixture.root, "targets.yaml"),
      writer: fakeWriter(
        [],
        [
          {
            id: "bold-symbols",
            template: "Ideas for {{book}}; give {{count}}.",
          },
        ],
      ),
      generate: fakeGenerator(generated, ["#80182A"]),
      ideaGenerator: fakeIdeaGenerator(
        responseEvents(JSON.stringify(ideasResponse("fresh", 3))),
      ),
    });
    const base = `http://127.0.0.1:${String(server.port)}`;

    try {
      await fetch(`${base}/api/next`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "idea", direction: "", newPrompts: 1 }),
      });
      await tasks.idle();

      const view = (await (
        await fetch(`${base}/api/rounds/round-2`)
      ).json()) as {
        round: { kind: string };
        image_prompt: { id: string };
        cells: { result: { status: string } | null }[];
      };
      expect(view.round.kind).toBe("idea");
      expect(view.image_prompt.id).toBe("flat");
      expect(view.cells).toHaveLength(6);
      expect(view.cells.every((cell) => cell.result?.status === "done")).toBe(
        true,
      );
      expect(generated).toContain("Draw fresh 1 as a flat screen print.");
    } finally {
      await server.stop();
    }
  });

  test("a round from before idea snapshots still loads its ideas from the suite", async () => {
    const fixture = await roundFixture();
    const summary = await runRound({
      ...fixture.args(fakeGenerator([])),
      promptsDirectory: fixture.prompts,
    });
    const roundPath = join(summary.directory, "round.yaml");
    const legacy = parse(await readFile(roundPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      roundPath,
      stringify({
        ...legacy,
        cases: [
          {
            book: "the-great-gatsby",
            book_title: "The Great Gatsby",
            idea: "the-weight-of-shirts",
            name: "The Weight of Shirts",
          },
        ],
      }),
    );
    await rm(join(summary.directory, "cases.yaml"));

    const second = await runRound(fixture.args(fakeGenerator([])));

    expect(second).toMatchObject({ done: 0, skipped: 2 });
    expect(await Bun.file(join(summary.directory, "cases.yaml")).exists()).toBe(
      true,
    );
  });
});

describe("image metrics", () => {
  test("haze in the native image is scored, crisp art is not", () => {
    const crisp = paint(40, 40, (x, y) => field(x, y));
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
    const plain = paint(40, 40, (x, y) => field(x, y));

    expect(measureImage(ringed, ringed).accent_contact).toBe(0);
    expect(measureImage(touching, touching).accent_contact).toBe(1);
    expect(measureImage(plain, plain).accent_contact).toBeNull();
  });
});

describe("AI judge check", () => {
  test("the judge is scored against my ratings and never sees the round it is judging", async () => {
    const fixture = await roundFixture();
    await runRound({
      ...fixture.args(fakeGenerator([])),
      promptsDirectory: fixture.prompts,
    });
    await runRound({
      ...fixture.args(fakeGenerator([])),
      roundId: "round-2",
      promptsDirectory: fixture.prompts,
    });
    await rate(fixture.root, [
      { prompt: "control", stars: 3, note: "first round control" },
      { prompt: "flat", stars: 3, note: "first round flat" },
    ]);
    await rate(
      fixture.root,
      [
        { prompt: "control", stars: 3, note: "second round control" },
        { prompt: "flat", stars: 3, note: "second round flat" },
      ],
      "round-2",
    );
    const briefs: string[] = [];
    const judge: Judge = async (input) => {
      const text = input.input
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n");
      briefs.push(text);
      const images = (text.match(/Image \d+: poster/g) ?? []).length;

      return Promise.resolve({
        response: JSON.stringify({
          ranking: Array.from({ length: images }, (_, index) => index + 1),
          ratings: Array.from({ length: images }, (_, index) => ({
            image: index + 1,
            stars: 3,
            tags: [],
            note: "Clean but plain",
            confidence: "medium",
          })),
        }),
        usage: null,
      });
    };

    const { directory, summary } = await runJudgeCheck({
      outputRoot: join(fixture.root, "output"),
      rubricPath: "evals/judge/rubric.md",
      concurrency: 2,
      judge,
    });

    expect(summary).toMatchObject({ rated_images: 4, exact: 1, within_one: 1 });
    const roundOneBrief = briefs.find((brief) =>
      brief.includes("second round"),
    );
    const roundTwoBrief = briefs.find((brief) => brief.includes("first round"));
    expect(roundOneBrief).not.toContain("first round");
    expect(roundTwoBrief).not.toContain("second round");
    expect(await readFile(join(directory, "report.md"), "utf8")).toContain(
      "Within one star: 100%",
    );
  });

  test("the judge's ranking decides row order and round winners; stars give agreement", () => {
    const entry = (
      prompt: string,
      row: string,
      human: number,
      judge: number,
      rank: number,
    ): Comparison => ({
      round: "round-1",
      key: `${prompt}/${row}`,
      prompt,
      row,
      human,
      judge,
      judge_rank: rank,
      confidence: "high",
      human_note: "",
      judge_note: "",
    });
    const comparisons = [
      entry("a", "x", 5, 4, 1),
      entry("b", "x", 2, 2, 2),
      entry("a", "y", 3, 1, 2),
      entry("b", "y", 1, 2, 1),
    ];
    // Row z was judged but never rated by the user; it still counts for ranks.
    const ranked = [
      ...comparisons.map((item) => ({
        round: item.round,
        row: item.row,
        prompt: item.prompt,
        rank: item.judge_rank,
      })),
      { round: "round-1", row: "z", prompt: "b", rank: 1 },
      { round: "round-1", row: "z", prompt: "a", rank: 2 },
    ];

    const summary = summarize(comparisons, ranked);

    expect(summary.exact).toBe(0.25);
    expect(summary.within_one).toBe(0.75);
    // Row x keeps the user's order; row y reverses it.
    expect(summary.row_pairs).toBe(2);
    expect(summary.row_order_agreement).toBe(0.5);
    expect(summary.rounds[0]).toMatchObject({
      human_winner: "a",
      judge_winner: "b",
      judge_mean_ranks: { a: 1.667, b: 1.333 },
    });
  });
});
