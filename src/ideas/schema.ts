import { z } from "zod";

export const IDEA_COUNT = 10;
export const IDEAS_SCHEMA_VERSION = 2;
const text = z.string().trim().min(1);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const slugSchema = z
  .string()
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase words separated by hyphens",
  );

export const ideaSchema = z.strictObject({
  id: slugSchema,
  name: text,
  composition: text,
  literary_basis: text,
  palette: z.array(z.strictObject({ color: hexColor, use: text })).min(1),
  conversion_resilience: text,
});

export const ideasResponseSchema = z.strictObject({
  ideas: z.array(ideaSchema).length(IDEA_COUNT),
});

export type IdeasResponse = z.infer<typeof ideasResponseSchema>;

export function parseIdeasResponse(response: string): IdeasResponse {
  const input: unknown = JSON.parse(response);
  const result = ideasResponseSchema.parse(input);
  if (new Set(result.ideas.map((idea) => idea.id)).size !== IDEA_COUNT) {
    throw new Error(
      "Codex returned duplicate idea IDs; all ten must be unique",
    );
  }
  if (
    new Set(result.ideas.map((idea) => idea.name.toLowerCase())).size !==
    IDEA_COUNT
  ) {
    throw new Error(
      "Codex returned duplicate idea names; use ten distinct concepts",
    );
  }
  return result;
}

export function titleToSlug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const requestSchema = z.strictObject({
  title: text.max(240),
  author: text.max(240).optional(),
  slug: slugSchema,
  outputRoot: text,
  model: text.optional(),
  timeoutSeconds: z.number().int().min(1).max(3600),
});

export type IdeasRequest = z.infer<typeof requestSchema>;
