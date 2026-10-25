import type { Idea, ImagesRequest } from "./schema.ts";

export const IMAGE_PROMPT_VERSION = 4;

// Placeholders are filled from the book, request, and idea. Eval rounds run
// variant templates through the same filling, so a winning variant can replace
// this template directly.
export const IMAGE_PROMPT_TEMPLATE = `Create exactly one original, bold, purely pictorial illustration inspired by {{title}} by {{author}}. This is a reusable source master for a literary character-art poster: later, each opaque pixel becomes a monospaced book character and transparent pixels are skipped. Do not perform character conversion.

The user explicitly requests one image for each existing idea and authorizes this concept. Skip further concept approval and variations.
Concept name: {{name}}
Composition: {{composition}}
Literary basis: {{literary_basis}}
Conversion resilience: {{conversion_resilience}}
Palette entries (hex color and intended use): {{palette}}

Select artwork colors from this palette. Exclude only colors whose sole intended use is the underlying paper in later rendering. Report the selected hex colors as artwork_colors. Use flat fully opaque fills in those colors. Do not paint a paper matte into the image.

Use the native image generation tool with transparent_background=true. Request {{size}} generation dimensions and a PNG with genuine RGBA transparency in the intended empty shapes and a small outer placement margin.

Visual system: one rectangular field of the primary ink color fills the whole interior art area, reaching all sides just inside the narrow transparent margin. One iconic subject is cut out of that field as a crisp transparent silhouette, so the paper shows through as the subject. Draw the subject's interior details (features, folds, steps, waves, architecture) as bold transparent lines and channels through the field, not with extra colors or shading. If the palette has an accent color, use it for the single named accent element only, and surround that element with a transparent channel so it never touches the primary field directly. Keep the rest of the field plain and calm: no secondary scenery, props, or scattered shapes.

Edges: smooth vector contours with confident curves and clean straight lines, like a precise paper cut or screen print. No torn, ragged, rough, distressed, dithered, or hand-cut edges, no specks, and no isolated fragments. Every essential stroke, channel, and gap must be at least about 1% of the canvas width.

No words, letters, title, author, numbers, logo, signature, watermark, border, frame, mockup, paper or checkerboard pattern. No gradients, lighting, shading, shadows, glow, blur, grain, texture, halftones, semitransparency, photorealism, 3D, painterly marks, crosshatching, decorative hairlines, tiny details, or busy scenery. Never reproduce an existing cover, film design, actor likeness or competitor composition.

Generate one image only. Do not use an API-key fallback, programmatic drawing, SVG, or shell-generated artwork. If the native tool is unavailable or generation fails, report an error. Visually inspect the result for the requested subject, transparency, lack of text, smooth edges and clear separation channels; inspect at thumbnail scale if available. Check that the subject remains transparent inside a continuous primary field and that any accent element is separated by a transparent channel. Put visual concerns in review_notes for later human review, not in error. These are unapproved source candidates, not selected production artwork. Only execution failures belong in error; use null when a native PNG was successfully generated and saved. Do not install libraries or write inspection scripts: the CLI decodes and validates the PNG. The user has authorized deterministic cleanup: partial alpha, glow, shading, antialiased edges and palette deviations will be normalized by binary-alpha thresholding, palette mapping and transparent padding. The visual selection happens after that cleanup. A missing thumbnail tool is a review note, not an execution failure. Final selection also needs a rendered character preview because glyphs lighten the colored fields and grid sampling can close openings.

Copy the unmodified native generated PNG into the working directory as master.png. Shell commands may be used only to inspect/read instructions or copy the native file, never to draw or post-process it. The CLI performs deterministic post-processing separately. Return the structured JSON response with artwork_colors, review_notes (an array, empty if none), and error (null on successful native generation).
`;

export interface ImagePromptBook {
  title: string;
  author: string;
  size: ImagesRequest["size"];
}

const placeholderPattern = /\{\{([a-z_]+)\}\}/g;

export function fillImagePrompt(
  template: string,
  book: ImagePromptBook,
  idea: Idea,
): string {
  const values = new Map<string, string>([
    ["title", book.title],
    ["author", book.author],
    ["size", book.size],
    ["name", idea.name],
    ["composition", idea.composition],
    ["literary_basis", idea.literary_basis],
    ["conversion_resilience", idea.conversion_resilience],
    ["palette", JSON.stringify(idea.palette)],
  ]);

  // One pass with a replacer function, so values are never re-scanned and `$`
  // sequences in book text stay literal.
  return template.replace(placeholderPattern, (match, key: string) => {
    const value = values.get(key);

    if (value === undefined) {
      throw new Error(`Unknown image prompt placeholder ${match}`);
    }

    return value;
  });
}

export function buildImagePrompt(request: ImagesRequest, idea: Idea): string {
  return fillImagePrompt(IMAGE_PROMPT_TEMPLATE, request, idea);
}
