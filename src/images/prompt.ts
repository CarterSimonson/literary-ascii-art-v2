import type { Idea, ImagesRequest } from "./schema.ts";

export const IMAGE_PROMPT_VERSION = 1;

export function buildImagePrompt(request: ImagesRequest, idea: Idea): string {
  return `Create exactly one original, bold, purely pictorial illustration inspired by ${request.title} by ${request.author}. This is a reusable source master for a literary character-art poster: later, each opaque pixel becomes a monospaced book character and transparent pixels are skipped. Do not perform character conversion.

The user explicitly requests one image for each existing idea and authorizes this concept. Skip further concept approval and variations.
Concept name: ${idea.name}
Composition: ${idea.composition}
Literary basis: ${idea.literary_basis}
Conversion resilience: ${idea.conversion_resilience}
Palette entries (hex color and intended use): ${JSON.stringify(idea.palette)}

Select only artwork colors from this palette; exclude any color whose sole intended use is the later poster field/background. Report the selected hex colors as artwork_colors. Use flat fully opaque fills in those colors. Do not paint a poster field into the image.

Use the native image generation tool with transparent_background=true. Request ${request.size} generation dimensions, a PNG with genuinely transparent RGBA background, and a generous transparent perimeter. Keep large continuous text-bearing shapes with crisp edges, expressive hierarchy and clean negative-space openings. Every essential stroke and gap must be at least about 1% of the canvas width. Use a screen-printed or vector-cut-paper character with flat shapes.

No words, letters, title, author, numbers, logo, signature, watermark, border, frame, mockup, paper or checkerboard pattern. No gradients, lighting, shading, shadows, glow, blur, grain, texture, halftones, semitransparency, photorealism, 3D, painterly marks, crosshatching, decorative hairlines, tiny details, or busy scenery. Never reproduce an existing cover, film design, actor likeness or competitor composition.

Generate one image only. Do not use an API-key fallback, programmatic drawing, SVG, or shell-generated artwork. If the native tool is unavailable or generation fails, report an error. Visually inspect the result for the requested subject, transparency, lack of text and broad readable forms; inspect at thumbnail scale if available. Put visual concerns in review_notes for later human review, not in error. These are unapproved source candidates, not selected production artwork. Only execution failures belong in error; use null when a native PNG was successfully generated and saved. Do not install libraries or write inspection scripts: the CLI decodes and validates the PNG. The user has authorized deterministic cleanup: partial alpha, glow, shading, antialiased edges and palette deviations will be normalized by binary-alpha thresholding, palette mapping and transparent padding. The visual selection happens after that cleanup. A missing thumbnail tool is a review note, not an execution failure.

Copy the unmodified native generated PNG into the working directory as master.png. Shell commands may be used only to inspect/read instructions or copy the native file, never to draw or post-process it. The CLI performs deterministic post-processing separately. Return the structured JSON response with artwork_colors, review_notes (an array, empty if none), and error (null on successful native generation).
`;
}
