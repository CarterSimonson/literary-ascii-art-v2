import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stringify } from "yaml";

import { rejection } from "./fixtures.ts";

import {
  findOutputTarget,
  outputTargetRegistrySchema,
  outputTargetSchema,
  resolveOutputTarget,
} from "../src/output-targets.ts";

const target = {
  name: "Poster with asymmetric bleed and gutter",
  size_inches: { width: 18, height: 24 },
  canvas_px: { width: 5490, height: 7260 },
  bleed_px: { top: 20, right: 60, bottom: 40, left: 30 },
  gutter_px: { top: 150, right: 100, bottom: 200, left: 150 },
};

const directories: string[] = [];

async function writeRegistry(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bookgen-targets-"));
  directories.push(directory);
  const path = join(directory, "targets.yaml");
  await writeFile(path, contents);
  return path;
}

afterEach(async (): Promise<void> => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("output target registry", (): void => {
  test.each([
    ["poster-18x24", 18, 24, 5400, 7200],
    ["poster-24x36", 24, 36, 7200, 10800],
  ] as const)(
    "%s has the agreed print dimensions and half-inch gutter",
    async (id, width, height, pixelWidth, pixelHeight): Promise<void> => {
      const registered = await resolveOutputTarget(id);

      expect(registered.id).toBe(id);
      expect(registered.size_inches).toEqual({ width, height });
      expect(registered.canvas_px).toEqual({
        width: pixelWidth,
        height: pixelHeight,
      });
      expect(registered.bleed_px).toEqual({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
      expect(registered.gutter_px).toEqual({
        top: 150,
        right: 150,
        bottom: 150,
        left: 150,
      });
    },
  );

  test("loads custom targets with independent per-edge insets without rewriting YAML", async (): Promise<void> => {
    const contents = stringify({
      schema_version: 1,
      targets: { custom: target },
    });
    const path = await writeRegistry(contents);

    expect(await resolveOutputTarget("custom", path)).toEqual({
      ...target,
      id: "custom",
    });
    expect(await readFile(path, "utf8")).toBe(contents);
    expect(await findOutputTarget("absent", path)).toBeUndefined();
    expect(await findOutputTarget("constructor", path)).toBeUndefined();
    expect(await rejection(resolveOutputTarget("absent", path))).toThrow(
      `Unknown output target ID 'absent'. Add it to ${path}`,
    );
  });

  test.each([
    { ...target, canvas_px: { width: 340, height: 7260 } },
    { ...target, canvas_px: { width: 5490, height: 410 } },
    { ...target, bleed_px: { ...target.bleed_px, left: 6000 } },
    { ...target, gutter_px: { ...target.gutter_px, bottom: -1 } },
    { ...target, bleed_px: { ...target.bleed_px, top: 0.5 } },
    { ...target, canvas_px: { width: 5400.5, height: 7200 } },
    { ...target, size_inches: { width: 0, height: 24 } },
    { ...target, gutter_px: { top: 150 } },
    { ...target, unknown: true },
  ])("rejects invalid dimensions, insets, and fields: %j", (input): void => {
    expect(outputTargetSchema.safeParse(input).success).toBe(false);
  });

  test("allows a positive content area down to one pixel", (): void => {
    expect(
      outputTargetSchema.safeParse({
        ...target,
        canvas_px: { width: 341, height: 411 },
      }).success,
    ).toBe(true);
  });

  test("rejects unsupported registry versions and unsafe IDs", (): void => {
    expect(
      outputTargetRegistrySchema.safeParse({ schema_version: 2, targets: {} })
        .success,
    ).toBe(false);
    expect(
      outputTargetRegistrySchema.safeParse({
        schema_version: 1,
        targets: { "../poster": target },
      }).success,
    ).toBe(false);
  });

  test("validates the entire registry and rejects duplicate YAML keys", async (): Promise<void> => {
    const path = await writeRegistry(
      stringify({
        schema_version: 1,
        targets: { valid: target, broken: { ...target, name: "" } },
      }),
    );
    expect(await rejection(resolveOutputTarget("valid", path))).toThrow();

    const duplicatePath = await writeRegistry(
      "schema_version: 1\ntargets: {}\ntargets: {}\n",
    );
    expect(
      await rejection(resolveOutputTarget("valid", duplicatePath)),
    ).toThrow();
  });
});
