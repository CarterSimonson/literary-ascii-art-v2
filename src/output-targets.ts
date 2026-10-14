import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { slugSchema } from "./ideas/schema.ts";

const pixelInsetSchema = z.number().int().nonnegative();
const edgeInsetsSchema = z.strictObject({
  top: pixelInsetSchema,
  right: pixelInsetSchema,
  bottom: pixelInsetSchema,
  left: pixelInsetSchema,
});

export const outputTargetSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(240),
    size_inches: z.strictObject({
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    canvas_px: z.strictObject({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    bleed_px: edgeInsetsSchema,
    gutter_px: edgeInsetsSchema,
  })
  .refine(
    (target) =>
      target.canvas_px.width -
        target.bleed_px.left -
        target.bleed_px.right -
        target.gutter_px.left -
        target.gutter_px.right >
      0,
    { message: "Bleed and gutter must leave a positive content width" },
  )
  .refine(
    (target) =>
      target.canvas_px.height -
        target.bleed_px.top -
        target.bleed_px.bottom -
        target.gutter_px.top -
        target.gutter_px.bottom >
      0,
    { message: "Bleed and gutter must leave a positive content height" },
  );

export type OutputTarget = z.infer<typeof outputTargetSchema> & { id: string };

export const outputTargetRegistrySchema = z.strictObject({
  schema_version: z.literal(1),
  targets: z.record(slugSchema, outputTargetSchema),
});

export async function findOutputTarget(
  id: string,
  registryPath = "output-targets.yaml",
): Promise<OutputTarget | undefined> {
  const input: unknown = parse(await readFile(resolve(registryPath), "utf8"));
  const registry = outputTargetRegistrySchema.parse(input);

  if (!Object.hasOwn(registry.targets, id)) {
    return undefined;
  }

  const target = registry.targets[id];

  if (!target) {
    return undefined;
  }

  return { ...target, id };
}

export async function resolveOutputTarget(
  id: string,
  registryPath = "output-targets.yaml",
): Promise<OutputTarget> {
  slugSchema.parse(id);
  const target = await findOutputTarget(id, registryPath);

  if (!target) {
    throw new Error(
      `Unknown output target ID '${id}'. Add it to ${resolve(registryPath)}`,
    );
  }

  return target;
}
