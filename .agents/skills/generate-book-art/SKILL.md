---
name: generate-book-art
description: Create bold, conversion-ready literary illustrations for classic books as transparent 2:3 PNG masters that will be rebuilt from monospaced characters. Use when Codex needs to research a book's visual language, propose original pictorial concepts, generate or refine book-inspired artwork, choose a limited palette and poster background, or evaluate art for the literary ASCII poster pipeline.
---

# Generate Book Art

Create purely pictorial literary art whose intent survives reduction to a character grid. Treat the image as a mask and color map: every opaque pixel becomes one book character; transparent pixels are skipped.

## Workflow

### 1. Establish the literary direction

- Accept the book title as the normal input. Ask for the author only when the title is ambiguous; ask about an edition or translation only when it materially changes the imagery.
- Ground concepts in the original text, its themes, setting, recurring objects, and relationships.
- Allow contemporary visual culture to inform recognizability, but synthesize it with the book. Do not reproduce a particular cover, poster, film composition, costume, prop design, or actor likeness.
- Do not send competitor images to the image model. Once the collection has approved original pieces, use those as references only when the user requests collection matching.

### 2. Require a concept gate

Before generating, propose three distinct directions. For each, state:

1. The dominant visual mass or compact tableau.
2. The subject revealed by silhouette or negative space.
3. The secondary literary motif and how it is integrated.
4. The dominant color, optional accent color, and proposed poster background.
5. Why the idea remains legible after character conversion.

Recommend one direction. Do not generate until the user approves a direction, unless the user explicitly asks to skip concept approval.

Favor a two-stage read: an immediate, recognizable subject followed by a subtler thematic discovery. Treat this as a strong default, not a rule that overrides a better book-specific idea.

### 3. Build the generation brief

Choose a palette as one system:

- Deliver the master with a truly transparent background.
- Recommend a separate finished-poster background, normally warm off-white or near-black.
- Use one book-specific dominant artwork color for at least 80% of the visible art.
- Permit one optional accent color.
- Ensure both artwork colors contrast strongly with the recommended poster background.

Apply this visual specification:

- 2:3 portrait composition.
- Purely pictorial: no title, author, lettering, numbers, logos, signature, or watermark.
- One dominant text-bearing mass with clear negative-space storytelling; use either an emblem or a compact tableau according to the book.
- Visible artwork occupies about 65–85% of the canvas with a deliberate transparent perimeter.
- Large, clean, evenly separated shapes with crisp edges and a screen-printed or vector-cut-paper character.
- Prefer solid masses and negative-space cutouts. Allow only a few structural strokes when the subject needs them, such as masts, legs, cables, or columns.
- Make every essential stroke and negative-space gap at least about 1% of the canvas width. Exaggerate fragile features rather than depicting them literally.
- Use flat, fully opaque fills only. No gradients, lighting, shading, shadows, glow, blur, grain, texture, halftones, antialiased haze, or semitransparent elements.
- No photorealism, 3D rendering, painterly brushwork, sketch marks, crosshatching, decorative hairlines, busy scenery, tiny isolated details, border, frame, poster mockup, paper texture, or checkerboard transparency pattern.

### 4. Generate three controlled variations

Use the available image-generation tool. Generate three candidates from the approved concept. Keep the literary idea, palette, background transparency, and technical constraints fixed; vary only composition, scale, balance, and silhouette rhythm.

Use this prompt structure, replacing the bracketed values with the approved concept:

```text
Create a bold, purely pictorial illustration inspired by [BOOK TITLE] by [AUTHOR], designed as the source mask and color map for a literary character-art poster. Every opaque pixel will later become one monospaced character from the book, while every transparent pixel will be skipped.

Concept: [DOMINANT MASS / TABLEAU]. Reveal [PRIMARY SUBJECT] through [SILHOUETTE OR NEGATIVE-SPACE MECHANISM]. Integrate [SECONDARY MOTIF] as [INTEGRATION]. Preserve the book-specific meaning: [LITERARY RATIONALE].

Composition: portrait 2:3. Use one substantial, unified visual mass occupying roughly 65–85% of the canvas, surrounded by a deliberate transparent perimeter. The composition must read immediately as a small thumbnail. Prefer large continuous shapes and expressive silhouette rhythm over literal detail. Use bold structural strokes only where necessary. Every important stroke and every negative-space gap must be wide, clean, evenly separated, and no thinner than about 1% of the canvas width.

Palette: flat [DOMINANT COLOR] carries at least 80% of the visible artwork; use [ACCENT COLOR OR "no accent"] sparingly. The intended finished-poster background is [BACKGROUND COLOR AND HEX], but do not render that background into the image.

Output requirements: a largest-native-size 2:3 PNG with a genuinely transparent RGBA background and crisp, fully opaque, flat-color shapes. No white matte and no checkerboard pattern. No words, letters, title, author, numbers, logo, signature, or watermark. No gradients, shading, highlights, shadows, glow, blur, grain, texture, halftones, semitransparency, photorealism, 3D, painterly marks, crosshatching, hairlines, tiny details, border, frame, page, wall, or product mockup.
```

Do not weaken the prompt with vague style labels such as "minimalist" alone. Describe the required geometry, hierarchy, palette, transparency, and failure conditions explicitly.

### 5. Self-check before presenting

Inspect each candidate at full size and as a small thumbnail. Reject and replace an obvious failure before showing it when any of these are true:

- The subject disappears or changes identity at thumbnail size.
- The background is white, colored, patterned, or only appears transparent.
- Text, a signature, a frame, a mockup, shading, texture, or unintended extra colors appear.
- Essential lines merge, break, or become hairlines.
- Negative-space openings close up or become ambiguous.
- Small decorative elements compete with the primary read.
- The concept resembles a known adaptation or supplied reference too closely.

If a candidate still cannot satisfy the constraints after one replacement attempt, present the limitation instead of pretending it is production-ready.

Present the three passing candidates with one sentence each about their hierarchy and conversion resilience. Recommend the strongest candidate; do not choose solely for literal accuracy.

### 6. Refine the selection

Use image editing to refine the selected candidate while preserving its approved composition, silhouette, palette, and transparent background. Prefer targeted edits such as widening a gap, merging small shapes, simplifying a contour, enlarging a motif, or removing an artifact. Regenerate from scratch only when the underlying concept or composition failed.

Continue inspecting edits at thumbnail size. Keep post-processing outside this skill until a separate deterministic cleanup stage is approved.

## Deliverables

Provide:

- The selected largest-native-size 2:3 transparent PNG master.
- The recommended poster background name and hex value.
- The dominant artwork color and optional accent color as hex values.
- A concise concept statement identifying the primary and secondary literary reads.

Do not rasterize a background into the master. Do not run the downstream character conversion unless the user asks.
