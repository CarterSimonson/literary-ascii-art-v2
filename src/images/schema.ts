import { z } from "zod";
import { bookSchema } from "../books.ts";
import {
  ideasResponseSchema,
  parseIdeasResponse,
  slugSchema,
} from "../ideas/schema.ts";

export const imagesRequestSchema = bookSchema.extend({
  slug: slugSchema,
  outputRoot: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  timeoutSeconds: z.number().int().min(1).max(3600),
  size: z.enum(["1024x1536", "1536x1024", "1024x1024"]),
  alphaThreshold: z.number().int().min(1).max(255),
});
export type ImagesRequest = z.infer<typeof imagesRequestSchema>;
export type Idea = z.infer<typeof ideasResponseSchema>["ideas"][number];

const ideasArtifactSchema = z.object({
  schema_version: z.literal(2),
  book: z.object({
    title: z.string(),
    author: z.string().nullable(),
    slug: slugSchema,
  }),
  generation: z.looseObject({}),
  ideas: ideasResponseSchema.shape.ideas,
});

export function parseIdeasArtifact(
  input: unknown,
  request: ImagesRequest,
): Idea[] {
  const artifact = ideasArtifactSchema.parse(input);
  if (
    artifact.book.slug !== request.slug ||
    artifact.book.title !== request.title ||
    artifact.book.author !== request.author
  ) {
    throw new Error(
      "ideas.yaml book identity differs from the registry; rerun bookgen ideas for this ID",
    );
  }
  return parseIdeasResponse(JSON.stringify({ ideas: artifact.ideas })).ideas;
}

export const imageResponseSchema = z.strictObject({
  artwork_colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1),
  review_notes: z.array(z.string()),
  error: z.string().nullable(),
});
