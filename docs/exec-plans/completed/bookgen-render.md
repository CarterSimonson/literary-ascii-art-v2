# Bookgen render

## Outcome

Implement `bookgen render <book-id> --idea <idea-id>` for all registered targets,
with optional `--target`. Publish a poster PNG and manifest per target under
`output/<book-id>/print/<idea-id>/<target-id>/`.

## Decisions

- Default to all registered targets; an explicit `--target` limits the run.
- Validate book, selected image, text, and target snapshots/hashes before publication.
- Strip Markdown presentation and collapse whitespace to ordinary word spaces in
  a render-only text stream. Spaces consume artwork cells but render no glyph.
- The prototype clarified that the minimum is **6.5 points**, not 6 px: about
  27.083 px at 300 PPI. Preserve actual font size and natural glyph proportions.
- Use rectangular cells with nominal width 0.63 × font size and a row height that
  accommodates glyph bounds. Round cell dimensions upward to whole pixels.
- Resample a target-specific working grid with nearest-neighbor sampling, preserving
  sampled colors and binary alpha. Compensate for rectangular cells and center the
  complete artwork inside the agreed ½-inch gutters. Keep the original master intact.
- Assign one character per visible working-grid pixel in row-major order, skipping
  transparent, opaque white, and exact background-colored pixels without consuming text. Use as
  much leading text as fits; repeat only when text is shorter than the grid.
- Render full-color sRGB PNGs using bundled Roboto Mono Bold 700 (the family's
  available bold weight). Record unsupported glyph substitutions, font/input/output
  hashes, grid/layout settings, and text usage in manifests.
- Stage selected targets as a complete batch; preserve old output on failures and
  retain unselected targets and upstream artifacts.

## Verification

Automated checks cover cleanup, traversal, color/alpha preservation, nearest-neighbor
sampling, point-to-pixel typography, centered gutters, target selection, stale inputs,
publication preservation/recovery, and CLI validation. Render actual Dracula inputs
at both configured sizes and inspect a thumbnail and full-resolution crop.

## Outcome and evidence

Completed the CLI, input validation, conversion and color rasterization modules,
batch publication/recovery, documentation, and 19 render tests.

- `bun run check`: typecheck, lint, formatting, and all 129 tests passed.
- `bun install --frozen-lockfile`: 117 installs checked with no changes.
- `bun run bookgen render dracula --idea the-descending-count`: both targets
  published successfully from existing local source/text artifacts.
- 18×24: 5400×7200 px, 300 PPI, 6.5 pt / 27.083 px font, 18×28 px cells,
  258×246 working grid, 26,243 characters used from 833,502 cleaned characters including word spaces.
- 24×36: 7200×10800 px, 300 PPI, same typography, 383×364 working grid,
  57,661 characters used. Neither print needed repeated text.
- Inspected a 750 px thumbnail and a native-resolution character crop. Artwork
  remains recognizable, letters are distinct, and sampled palette colors remain
  visible. Synthetic tests also verify pure red, green, and blue ink in sRGB output.
- Local ignored evidence: `.artifacts/render-validation/poster-preview.png` and
  `character-crop.png`. Posters/manifests remain under the documented print paths.

## Limits and follow-up

Physical print/printer approval is still required; outputs remain unapproved.
Nearest-neighbor sampling can discard thin details; font white space makes artwork
lighter than solid source fills. The bundled Latin font substitutes unsupported
characters with `?` and records them. Provider-specific CMYK/PDF/bleed requirements,
font selection, and aesthetic refinements remain later work. Full-novel Markdown
cleanup currently takes roughly 30 seconds for Dracula on this machine; rendering
reports that phase explicitly.

## Spacing and background correction

Render version 2 preserves word spaces, normalizing repeated whitespace and Markdown
block boundaries into single spaces. Spaces consume an artwork cell but never draw
or become fallback question marks. Opaque white and exact configured-background
pixels are now skipped alongside transparent pixels without consuming text. A
synthetic grid verifies white, transparent, custom-background, and pale foreground
cases; the raster test checks that word-space cells stay blank.

Both Dracula posters were regenerated and the full-resolution crop was inspected:
word spacing is visible. This master has no opaque pure-white/background matches;
37,225 and 81,751 transparent working-grid pixels were skipped in the two sizes.
Its nonwhite pale artwork remains eligible by design. Manifests record skipped
background and transparent pixel counts separately.
