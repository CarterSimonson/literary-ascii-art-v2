import { z } from "zod";

export const DEFAULT_IDEA_COUNT = 10;
export const MAX_PALETTE_COLORS = 3;
export const MAX_IDEA_COUNT = 20;
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

// Downstream stages accept any nonempty set; only generation enforces a count.
export const ideaListSchema = z.array(ideaSchema).min(1);

export const ideasResponseSchema = z.strictObject({
  ideas: ideaListSchema,
});

export type IdeasResponse = z.infer<typeof ideasResponseSchema>;

// New ideas are limited to a primary ink, one accent, and a suggested paper;
// older saved ideas with larger palettes remain readable downstream.
export function createIdeasResponseSchema(
  ideaCount: number,
): typeof ideasResponseSchema {
  const generatedIdea = ideaSchema.extend({
    palette: ideaSchema.shape.palette.max(MAX_PALETTE_COLORS),
  });

  return z.strictObject({
    ideas: z.array(generatedIdea).min(1).length(ideaCount),
  });
}

// Omit the count to validate a previously published set of any size.
export function parseIdeasResponse(
  response: string,
  ideaCount?: number,
): IdeasResponse {
  const input: unknown = JSON.parse(response);

  let result: IdeasResponse;

  if (ideaCount === undefined) {
    result = ideasResponseSchema.parse(input);
  } else {
    result = createIdeasResponseSchema(ideaCount).parse(input);
  }

  const total = result.ideas.length;

  if (new Set(result.ideas.map((idea) => idea.id)).size !== total) {
    throw new Error("Codex returned duplicate idea IDs; all must be unique");
  }

  const names = new Set(result.ideas.map((idea) => idea.name.toLowerCase()));

  if (names.size !== total) {
    throw new Error(
      "Codex returned duplicate idea names; use distinct concepts",
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
  ideaCount: z.number().int().min(1).max(MAX_IDEA_COUNT),
});

export type IdeasRequest = z.infer<typeof requestSchema>;
