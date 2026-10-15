import type { Idea, ImagesRequest } from "./schema.ts";

export const IMAGE_PROMPT_VERSION = 3;

export function buildImagePrompt(request: ImagesRequest, idea: Idea): string {
  return `Create exactly one original, bold, purely pictorial illustration inspired by ${request.title} by ${request.author}. This is a reusable source master for a literary character-art poster: later, each opaque pixel becomes a monospaced book character and transparent pixels are skipped. Do not perform character conversion.

The user explicitly requests one image for each existing idea and authorizes this concept. Skip further concept approval and variations.
Concept name: ${idea.name}
Composition: ${idea.composition}
Literary basis: ${idea.literary_basis}
Conversion resilience: ${idea.conversion_resilience}
Palette entries (hex color and intended use): ${JSON.stringify(idea.palette)}

Select artwork colors from this palette, including colors used for illustrated environments such as sky, sea, walls and foliage. These surrounding color fields are artwork and must remain opaque so they carry text. Exclude only colors whose sole intended use is the underlying paper in later rendering. Report the selected hex colors as artwork_colors. Use flat fully opaque fills in those colors. Do not paint a paper matte into the image.

Use the native image generation tool with transparent_background=true. Request ${request.size} generation dimensions and a PNG with genuine RGBA transparency in the intended empty shapes and a small outer placement margin. Compose broad, connected color fields that carry text, preserving the approved relationship between those fields and empty regions. When the concept reveals a subject through negative space, cut that subject out as transparency inside the surrounding opaque artwork; do not fill it with a foreground color or erase the illustrated environment. Transparent openings reveal the underlying paper. Keep crisp edges, expressive hierarchy and clean openings. Every essential stroke and gap must be at least about 1% of the canvas width. Use a screen-printed or vector-cut-paper character with flat shapes.

Fill the entire interior art area with the composed text-bearing environment, extending its colored fields to all sides just inside the narrow transparent placement margin. Continue those fields behind and around objects. For example, a ship at sea needs opaque colored sky around its hull, mast and sail as well as an opaque sea; a transparent animal cutout in the sea does not justify leaving the sky empty. Reserve interior transparency for the concept's intentional subject cutouts, meaningful openings and separation channels. Avoid large unused transparent expanses, isolated sticker-like objects, or a scene that ends at its objects' outer contours. A continuous illustrated color field is required artwork, not a paper matte to remove. Use the approved palette and do not add a decorative border.

Preserve deliberate transparent gaps and gutters between objects when they improve separation, rhythm or breathing room. They may interrupt a color field and should remain wide enough to survive character conversion. The goal is purposeful whitespace, not maximum color coverage: keep designed gaps while eliminating large leftover blank areas around the scene.

No words, letters, title, author, numbers, logo, signature, watermark, border, frame, mockup, paper or checkerboard pattern. No gradients, lighting, shading, shadows, glow, blur, grain, texture, halftones, semitransparency, photorealism, 3D, painterly marks, crosshatching, decorative hairlines, tiny details, or busy scenery. Never reproduce an existing cover, film design, actor likeness or competitor composition.

Generate one image only. Do not use an API-key fallback, programmatic drawing, SVG, or shell-generated artwork. If the native tool is unavailable or generation fails, report an error. Visually inspect the result for the requested subject, transparency, lack of text and broad readable forms; inspect at thumbnail scale if available. Check that intended empty subjects remain transparent and surrounding text-bearing fields remain colored. Put visual concerns in review_notes for later human review, not in error. These are unapproved source candidates, not selected production artwork. Only execution failures belong in error; use null when a native PNG was successfully generated and saved. Do not install libraries or write inspection scripts: the CLI decodes and validates the PNG. The user has authorized deterministic cleanup: partial alpha, glow, shading, antialiased edges and palette deviations will be normalized by binary-alpha thresholding, palette mapping and transparent padding. The visual selection happens after that cleanup. A missing thumbnail tool is a review note, not an execution failure. Final selection also needs a rendered character preview because glyphs lighten the colored fields and grid sampling can close openings.

Copy the unmodified native generated PNG into the working directory as master.png. Shell commands may be used only to inspect/read instructions or copy the native file, never to draw or post-process it. The CLI performs deterministic post-processing separately. Return the structured JSON response with artwork_colors, review_notes (an array, empty if none), and error (null on successful native generation).
`;
}
