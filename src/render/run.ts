import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { stringify } from "yaml";

import packageJson from "../../package.json";
import {
  assignCharacters,
  decodeMaster,
  sampleGrid,
  separateColorCells,
} from "./convert.ts";
import { fontMetrics, loadRenderFont, supportedCharacters } from "./font.ts";
import {
  loadRenderInputs,
  renderRequestSchema,
  sha256,
  verifySnapshots,
  type RenderRequest,
} from "./input.ts";
import {
  preparePublication,
  publicationPaths,
  publish,
} from "./publication.ts";
import { renderPoster, targetLayout } from "./raster.ts";
import { normalizeRenderText } from "./text.ts";

export interface RenderOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export async function runRender(
  input: RenderRequest,
  options: RenderOptions = {},
): Promise<string[]> {
  const request = renderRequestSchema.parse(input);
  options.signal?.throwIfAborted();
  const inputs = await loadRenderInputs(request);
  const font = await loadRenderFont();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    inputs.text.bytes,
  );
  options.onProgress?.("Removing formatting and normalizing word spacing");
  const normalized = normalizeRenderText(text);
  const supported = supportedCharacters(normalized, font.font);
  const source = await decodeMaster(inputs.image.bytes);
  const metrics = fontMetrics(supported.characters, font.font);

  if (
    source.width !== inputs.imageDimensions.width ||
    source.height !== inputs.imageDimensions.height
  ) {
    throw new Error("Source image dimensions differ from its manifest");
  }

  for (const target of inputs.targets) {
    targetLayout(source, target, metrics);
  }

  const bookDirectory = resolve(request.outputRoot, request.slug);
  const paths = publicationPaths(bookDirectory, request.idea);

  try {
    await mkdir(paths.lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `A render run is already active for ${request.slug}. Lock: ${paths.lock}`,
        { cause: error },
      );
    }

    throw error;
  }

  try {
    await preparePublication(paths);

    for (const target of inputs.targets) {
      options.signal?.throwIfAborted();
      options.onProgress?.(`Rendering ${request.idea} for ${target.id}`);
      const layout = targetLayout(source, target, metrics);
      const sampled = sampleGrid(source, layout.gridWidth, layout.gridHeight);
      const { grid, separatedCells } = separateColorCells(
        sampled,
        request.separation,
        request.background,
      );
      const art = assignCharacters(
        grid,
        supported.characters,
        request.background,
      );
      const result = await renderPoster(
        art,
        target,
        font,
        layout,
        request.background,
        options.signal,
      );
      const directory = join(paths.staging, target.id);
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory);
      await writeFile(join(directory, "poster.png"), result.png);
      await writeFile(
        join(directory, "manifest.yaml"),
        stringify({
          schema_version: 1,
          render_version: 4,
          bookgen_version: packageJson.version,
          dependencies: packageJson.dependencies,
          generated_at: new Date().toISOString(),
          book: {
            slug: request.slug,
            title: request.title,
            author: request.author,
            gutenberg_id: request.gutenberg_id,
          },
          idea_id: request.idea,
          review_status: "unapproved",
          inputs: inputs.snapshots.map((snapshot) => ({
            path: relative(join(paths.final, target.id), snapshot.path),
            sha256: snapshot.sha256,
          })),
          target,
          background: request.background,
          font: { name: font.name, sha256: font.sha256 },
          conversion: {
            traversal:
              "row-major; skip transparent, white, and background-colored pixels; preserve word spaces; cycle text",
            text_cleanup:
              "Markdown to text; decode entities; NFC; collapse whitespace to single spaces; remove controls, *, _, backticks, ~; unsupported glyphs become ?",
            normalized_text_sha256: sha256(normalized.join("")),
            glyph_text_sha256: sha256(supported.characters.join("")),
            text_characters: supported.characters.length,
            unsupported_characters: supported.replacements,
            source_width: source.width,
            source_height: source.height,
            grid_width: art.width,
            grid_height: art.height,
            resampling:
              "nearest-neighbor pixel centers; original master unchanged",
            unique_text_characters_used: Math.min(
              art.characterCount,
              supported.characters.length,
            ),
            text_characters_omitted: Math.max(
              0,
              supported.characters.length - art.characterCount,
            ),
            color_separation_radius_cells: request.separation,
            color_separation_cells_skipped: separatedCells,
            character_count: art.characterCount,
            background_pixels_skipped: art.backgroundPixels,
            transparent_pixels_skipped: art.transparentPixels,
            full_text_cycles: Math.floor(
              art.characterCount / supported.characters.length,
            ),
            remaining_characters:
              art.characterCount % supported.characters.length,
          },
          layout: {
            ...result.layout,
            character_cell:
              "rectangular; font size in points; no glyph stretching",
            placement: "centered inside bleed and gutter",
          },
          output: {
            path: "poster.png",
            sha256: sha256(result.png),
            bytes: result.png.length,
            ...target.canvas_px,
            color_space: "sRGB",
            format: "PNG",
          },
        }),
      );
    }

    await verifySnapshots(inputs.snapshots);
    options.signal?.throwIfAborted();
    await publish(paths);
    await rm(paths.backup, { recursive: true, force: true }).catch(() => {
      options.onProgress?.(
        "Poster published; old backup will be cleaned on the next render",
      );
    });

    return inputs.targets.map((target) =>
      join(paths.final, target.id, "poster.png"),
    );
  } finally {
    try {
      await rm(paths.staging, { recursive: true, force: true });
    } finally {
      await rm(paths.lock, { recursive: true, force: true });
    }
  }
}
