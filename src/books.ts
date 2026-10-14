import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { slugSchema } from "./ideas/schema.ts";

export const bookSchema = z.strictObject({
  title: z.string().trim().min(1).max(240),
  author: z.string().trim().min(1).max(240),
});
export type Book = z.infer<typeof bookSchema> & { slug: string };
export const registrySchema = z.strictObject({
  schema_version: z.literal(1),
  books: z.record(slugSchema, bookSchema),
});

export async function findBook(
  id: string,
  registryPath = "books.yaml",
): Promise<Book | undefined> {
  const path = resolve(registryPath);
  const input: unknown = parse(await readFile(path, "utf8"));
  const registry = registrySchema.parse(input);
  if (!Object.hasOwn(registry.books, id)) return undefined;
  const book = registry.books[id];
  return book ? { ...book, slug: id } : undefined;
}

export async function resolveBook(
  id: string,
  registryPath = "books.yaml",
): Promise<Book> {
  slugSchema.parse(id);
  const book = await findBook(id, registryPath);
  if (!book)
    throw new Error(
      `Unknown book ID '${id}'. Add it to ${resolve(registryPath)}`,
    );
  return book;
}
