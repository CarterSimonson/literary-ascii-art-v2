import { z } from "zod";

import { registeredBookSchema } from "../books.ts";
import { slugSchema } from "../ideas/schema.ts";

export const fetchRequestSchema = registeredBookSchema.extend({
  slug: slugSchema,
  outputRoot: z.string().trim().min(1),
  timeoutSeconds: z.number().int().min(1).max(3600),
  model: z.string().trim().min(1).optional(),
  editionContext: z.string().trim().min(1).max(4000).optional(),
});

export type FetchRequest = z.infer<typeof fetchRequestSchema>;

export const cleanupSchema = z.strictObject({
  matches_book: z.boolean(),
  english: z.boolean(),
  complete_work: z.boolean(),
  uncertainty: z.string().nullable(),
  edition_notes: z.string(),
  removals: z.array(
    z.strictObject({
      start_line: z.number().int().positive(),
      end_line: z.number().int().positive(),
      first_line: z.string(),
      last_line: z.string(),
      reason: z.enum([
        "contents",
        "transcriber_note",
        "publisher_matter",
        "illustration",
        "gutenberg",
      ]),
      explanation: z.string().trim().min(1),
    }),
  ),
});

export type Cleanup = z.infer<typeof cleanupSchema>;
