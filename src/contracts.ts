import { z } from "zod";
export const Evidence = z
  .object({ paragraphId: z.string(), quote: z.string().min(1) })
  .strict();
export const Motif = z
  .object({
    name: z.string(),
    meaning: z.string(),
    evidence: z.array(Evidence).min(1),
  })
  .strict();
export const Brief = z
  .object({
    summary: z.string(),
    themes: z.array(Motif).min(2),
    objects: z.array(Motif).min(2),
    relationships: z.array(Motif).min(1),
    uncertainties: z.array(z.string()),
  })
  .strict();
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const Concept = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,50}$/),
    name: z.string(),
    dominantMass: z.string(),
    subject: z.string(),
    negativeSpace: z.string(),
    secondaryMotif: z.string(),
    rationale: z.string(),
    evidence: z.array(Evidence).min(1),
    dominant: Hex,
    accent: Hex.nullable(),
    background: Hex,
    conversionRationale: z.string(),
  })
  .strict();
export const Concepts = z
  .object({
    concepts: z.array(Concept).length(3),
    recommendedId: z.string(),
    recommendation: z.string(),
  })
  .strict();
export type ConceptValue = z.infer<typeof Concept>;
export type Paragraph = { id: string; text: string };
export function validateEvidence(value: unknown, paragraphs: Paragraph[]) {
  const sources = new Map(paragraphs.map((p) => [p.id, p.text]));
  function check(item: unknown) {
    if (Array.isArray(item)) {
      item.forEach(check);
      return;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if ("paragraphId" in record) {
        const source = sources.get(String(record.paragraphId));
        const quote = String(record.quote);
        if (!source || quote.trim().length === 0 || !source.includes(quote))
          throw new Error(
            `Invalid source evidence ${record.paragraphId}: quote must match the cached paragraph exactly.`,
          );
      }
      Object.values(record).forEach(check);
    }
  }
  check(value);
}

export function resolveEvidence<T>(
  value: T,
  paragraphs: Paragraph[],
): { value: T; corrections: { from: string; to: string; quote: string }[] } {
  const result = structuredClone(value);
  const sources = new Map(paragraphs.map((p) => [p.id, p.text]));
  const corrections: { from: string; to: string; quote: string }[] = [];
  function resolve(item: unknown) {
    if (Array.isArray(item)) {
      item.forEach(resolve);
      return;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if ("paragraphId" in record) {
        const quote = String(record.quote),
          from = String(record.paragraphId);
        if (quote.trim() && !sources.get(from)?.includes(quote)) {
          const matches = paragraphs.filter((p) => p.text.includes(quote));
          if (matches.length === 1) {
            record.paragraphId = matches[0].id;
            corrections.push({ from, to: matches[0].id, quote });
          }
        }
      }
      Object.values(record).forEach(resolve);
    }
  }
  resolve(result);
  validateEvidence(result, paragraphs);
  return { value: result, corrections };
}
