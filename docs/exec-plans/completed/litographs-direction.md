# Litographs-style direction and color separation

## Outcome

Posters read like the competitor reference: one text field in one primary ink, one
iconic subject cut out as negative space, details drawn as unprinted channels, at
most one accent color, and visible gaps between differently colored regions. Every
printed character stays whole.

## Context

The first Great Gatsby run (`--count 3`, ideas prompt v5, images prompt v3) produced
multi-color scene compositions. Compared with Litographs posters, ours looked busy
and rough:

- Adjacent color regions touched, so boundaries became color changes mid-word.
- Masters had torn, ragged edges and stray transparent blobs that rendered as
  scattered text fragments.
- Litographs uses one tinted field, one subject, and deliberate empty gaps.

A prototype clipped glyph pixels to the master for smooth silhouette edges. It was
rejected: the product must never print partial characters. Edge quality comes from
designed gaps in the art and whole-cell separation instead.

## Decisions

- Ideas prompt v6 and images prompt v4 describe the single-field, single-subject
  system, smooth vector contours, and a transparent channel around any accent.
- Newly generated palettes are capped at three entries (primary ink, optional
  accent, optional paper). Saved larger palettes still load downstream.
- Render v4 adds `--separation <cells>` (default 1, 0 disables). Where two ink
  colors meet, the cells of the color that sorts later by RGB within the radius are
  left empty, giving exactly one empty cell at radius 1. Separated cells consume no
  text. The master is unchanged and glyphs are never clipped.

## Validation

- `bun run check`: typecheck, lint, format, and tests, including separation and
  palette-cap specs.
- The re-rendered v3 clock master shows one-cell gaps between all color regions
  with no partial glyphs (3,802 cells separated at 18 × 24).
- Regenerate three Gatsby ideas and images with the new prompts; render and compare
  against the v5 set and the Litographs reference.

## Progress

- [x] Renderer separation and tests
- [x] Prompt, schema, skill, and doc updates
- [x] Gatsby regeneration and visual comparison
- [x] Cleanup v2 and reclean

## Results

Ideas v6 and images v4 produced three single-field, single-ink Gatsby masters
(`the-distance-of-desire`, `the-weight-of-shirts`, `the-machine-of-carelessness`),
all within the three-color cap. `the-weight-of-shirts` matches the reference
system closely: one silhouette, folds drawn as channels, smooth contours. The
other two have clean primary subjects but also stray ragged islands (clouds,
smoke, abstract shapes).

Codex review notes on all three native images report cloudy or mottled shading.
Binary alpha thresholding in cleanup turns that soft tone into torn-edged islands,
so the remaining roughness comes from image cleanup, not composition or rendering.
Separation skipped 68 cells on the one two-color master and none on single-ink
masters.

## Cleanup v2

The native alpha showed the cause: designed cutouts are crisp (alpha near 0),
while the model's smoky halos are semi-transparent. Images processing version 2
fills enclosed transparent regions where fewer than half the pixels were crisp,
and removes holes and specks smaller than 1% of the width. `images --reclean`
reprocesses traced natives without Codex. On Gatsby it filled 2 and 12 haze
regions (desire, car), plus 11 and 43 pinholes, and changed one pixel on the
already-clean shirt. Renders now show one clean subject in a plain field.

## Remaining follow-up

- Accent elements such as the green light still touch the primary field in the
  master; render separation inserts the gap, but the image prompt could make it
  more reliable.
- Existing masters for other books predate processing v2. Run `images --reclean`
  where their traces are intact; otherwise regenerate.
- Print proofs and human selection remain pending.
