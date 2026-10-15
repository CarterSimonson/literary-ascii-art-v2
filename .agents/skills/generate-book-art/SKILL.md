---
name: generate-book-art
description: Create bold, conversion-ready literary illustrations for classic books as transparent PNG masters that will be rebuilt from monospaced characters. Use when Codex needs to research a book's visual language, propose original pictorial concepts, generate or refine book-inspired artwork, choose a coherent palette with intended color uses, or evaluate art for the literary ASCII poster pipeline.
---

# Generate Book Art

Create purely pictorial literary art whose intent survives reduction to a character grid. Treat the image as a mask and color map: every opaque pixel becomes one book character; transparent pixels are skipped.

Compose text-bearing color fields and empty shapes together. Colored sky, sea, walls, or foliage are illustrated environments: they remain opaque artwork even when behind the subject. The underlying paper is a separate render setting. Transparent openings reveal that paper and can form the principal subject through the absence of text.

Carry the composed environment across the whole interior art area, up to a narrow transparent placement margin. Continue colored fields behind and around objects. A ship at sea needs text-bearing sky around the ship as well as text-bearing water; a good animal cutout in the water does not compensate for a large unused transparent sky. Reserve interior transparency for intentional subjects, meaningful openings, and separation channels. Positive subjects also sit within this continuous environment.

Preserve deliberate transparent gaps and gutters between objects for separation, rhythm, or breathing room, even where they interrupt a color field. Keep them wide enough to survive character conversion. Judge whitespace by its compositional purpose, not a maximum-coverage target; eliminate leftover empty canvas without filling useful designed gaps.

## Workflow

### 1. Establish the literary direction

- Accept the book title as the normal input. Ask for the author only when the title is ambiguous; ask about an edition or translation only when it materially changes the imagery.
- Ground concepts in the original text, its themes, setting, recurring objects, and relationships.
- Allow contemporary visual culture to inform recognizability, but synthesize it with the book. Do not reproduce a particular cover, poster, film composition, costume, prop design, or actor likeness.
- Do not send competitor images to the image model. Once the collection has approved original pieces, use those as references only when the user requests collection matching.

### 2. Require a concept gate

Before generating, propose three distinct directions. For each, state:

1. The visual concept, arrangement, scale, and hierarchy, including which regions carry text, which forms emerge from transparent openings, and how the environment continues behind and around subjects to the edges of the interior art area.
2. The concrete literary basis for the idea.
3. A coherent palette listing colors and their intended uses.
4. Why the idea remains legible after character conversion.

Silhouette, negative-space storytelling, a secondary motif, and a two-stage read are useful devices when they strengthen the concept, not mandatory ingredients or separate fields. Do not invent a secondary motif just to fill a slot. Keep dimensions and aspect ratios in generation settings rather than composition descriptions.

Include negative-space-led directions among a set of concepts, alongside positive silhouettes and mixed compositions. In those directions, reveal an important subject as an empty shape within broad, connected colored surroundings. Do not mechanically invert an existing illustration or default every concept to an isolated colored object.

Recommend one direction. Do not generate until the user approves a direction, unless the user explicitly asks to skip concept approval.

Use a two-stage read when it serves the book: an immediate visual identity followed by a subtler thematic discovery. A single clear scene, emblem, or abstract motif can be equally appropriate.

### 3. Build the generation brief

Choose a palette as one system:

- Deliver the master with a truly transparent background.
- List hex colors and their intended uses. Choose the number of colors and their distribution to serve the concept; do not require dominant/accent/foreground/background slots or coverage ratios.
- If an underlying paper color is useful to recommend, identify it in the palette, but keep that matte out of the source master. Colors for illustrated environments belong in the master and must not be excluded as "background."
- Evaluate contrast among neighboring shapes and against the intended poster field. Prefer enough color separation to preserve the visual hierarchy after character conversion.

Apply this visual specification:

- Generate one reusable high-resolution master at poster-friendly dimensions chosen in the generation settings, normally portrait. Later rendering places that master within other poster sizes and fills the surrounding space. Do not bake a target poster size into the concept or regenerate the art for every size.
- Purely pictorial: no title, author, lettering, numbers, logos, signature, or watermark.
- Use broad, connected text-bearing color fields with a clear arrangement suited to the book, whether a scene, emblem, or abstract motif. Give the empty shapes equal compositional attention.
- Preserve a narrow transparent outer placement margin, with colored fields reaching all sides just inside it. Keep intended subject cutouts transparent inside the colored fields; do not erase illustrated environments or leave large unused transparent expanses around objects.
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

Concept: [VISUAL CONCEPT AND ARRANGEMENT]. Preserve the book-specific meaning: [LITERARY RATIONALE]. Describe silhouette, negative-space storytelling, or an integrated secondary motif only when those devices are part of the approved concept.

Composition: [PLACEMENT, SCALE, AND HIERARCHY, INCLUDING TEXT-FILLED REGIONS AND EMPTY FORMS]. Compose broad, connected color fields that carry the book's text across the entire interior art area, reaching all sides just inside a narrow transparent placement margin. Continue the colored environment behind and around subjects; do not leave large unused transparent areas around their contours. Preserve the approved relationship between colored surroundings and empty subjects. Where the concept uses negative space, reveal the subject through transparent openings within opaque artwork. Reserve interior transparency for intentional subject cutouts, meaningful openings, and separation channels. The composition must read immediately as a small thumbnail. Prefer large continuous shapes and expressive silhouette rhythm over literal detail. Use bold structural strokes only where necessary. Every important stroke and every negative-space gap must be wide, clean, evenly separated, and no thinner than about 1% of the canvas width.

Palette: [HEX COLORS AND THEIR INTENDED USES]. Use flat, fully opaque fills and maintain the approved color relationships. Illustrated environments such as sky, sea, walls and foliage are artwork and remain opaque to carry text. Only the underlying paper color belongs to later rendering. Transparent openings reveal that paper.

Whitespace: Preserve deliberate transparent gaps and gutters between objects for separation and breathing room. These can interrupt color fields. Keep designed gaps while eliminating large leftover blank areas; do not maximize color coverage at the expense of composition.

Output requirements: one largest-native-size PNG at the chosen master generation dimensions with a genuinely transparent RGBA background and crisp, fully opaque, flat-color shapes. No white matte and no checkerboard pattern. No words, letters, title, author, numbers, logo, signature, or watermark. No gradients, shading, highlights, shadows, glow, blur, grain, texture, halftones, semitransparency, photorealism, 3D, painterly marks, crosshatching, hairlines, tiny details, border, frame, page, wall, or product mockup.
```

Do not weaken the prompt with vague style labels such as "minimalist" alone. Describe the required geometry, hierarchy, palette, transparency, and failure conditions explicitly.

### 5. Self-check before presenting

Inspect each candidate at full size and as a small thumbnail. Reject and replace an obvious failure before showing it when any of these are true:

- The subject disappears or changes identity at thumbnail size.
- An unintended paper matte or pattern replaces genuine transparency. Intended colored scenery is valid artwork, not a matte.
- An intended empty subject is filled with color, or its surrounding text-bearing environment has been erased.
- Large unused transparent areas surround objects where the composed environment should carry text, even if another part of the image has a successful negative-space motif.
- Text, a signature, a frame, a mockup, shading, texture, or unintended extra colors appear.
- Essential lines merge, break, or become hairlines.
- Negative-space openings close up or become ambiguous.
- Small decorative elements compete with the primary read.
- The concept resembles a known adaptation or supplied reference too closely.

If a candidate still cannot satisfy the constraints after one replacement attempt, present the limitation instead of pretending it is production-ready.

Present the three passing candidates with one sentence each about their hierarchy and conversion resilience. Recommend the strongest candidate; do not choose solely for literal accuracy.

Source thumbnails are preliminary evidence. Before final artwork approval, review a character-rendered preview at the intended grid and font size: empty subjects must remain recognizable and colored fields must retain enough visual weight when fills become glyphs. If conversion was not requested, record this as pending rather than running it implicitly.

### 6. Refine the selection

Use image editing to refine the selected candidate while preserving its approved composition, silhouette, palette, and transparent background. Prefer targeted edits such as widening a gap, merging small shapes, simplifying a contour, enlarging a motif, or removing an artifact. Regenerate from scratch only when the underlying concept or composition failed.

Continue inspecting edits at thumbnail size. Keep post-processing outside this skill until a separate deterministic cleanup stage is approved.

## Deliverables

Provide:

- The selected largest-native-size transparent PNG master, with its generation dimensions recorded separately.
- The approved palette as hex colors with their intended uses, identifying a suggested poster field color if applicable.
- A concise composition statement and literary rationale, with any secondary read described only when the concept uses one.

Do not rasterize an underlying paper matte into the master; preserve opaque illustrated environments. Do not run the downstream character conversion unless the user asks.
