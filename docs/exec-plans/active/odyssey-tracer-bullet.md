# One Odyssey poster, end to end

Ticket: [COD-67](https://linear.app/codekips/issue/COD-67).
Status: plan updated; implementation has not started.

## Outcome

Download the Odyssey text, generate and approve one source image, convert it to
colored book characters, and display the poster. Start with one command, one book,
one master, and one output size. Improve it from the visible result.

## What we learned from the old script

Read `src/index.js`, `src/imageGenerator.js`, `src/constants/posterSizes.js`, and
`package.json` at legacy commit `2feebc79a376ee63fc3757aebe8bc74dd61f1e41`.
[Source](https://github.com/CarterSimonson/literary-ascii-art/tree/2feebc79a376ee63fc3757aebe8bc74dd61f1e41/src).
The script reads text/image files, normalizes whitespace, crops/resizes the image,
counts visible cells, assigns word-aware text lines, renders RGB glyphs with
Canvas, and saves PNGs with margins. It already demonstrated the product idea.

Reuse the behavior that matters, not exact output compatibility. Begin with a
simple sequential character stream and one size instead of porting the custom
word-fitting algorithm and all size presets. Correct character-cell geometry and
avoid silent failures. Measure a real run before pursuing speed improvements.

## Starting choices

- Go, chosen by the user after comparing Python/Pillow and Rust. Go modules own
  dependencies; pin the supported toolchain in project configuration and retain
  `go.mod` / `go.sum`. Use the standard library plus `golang.org/x/image` for
  nearest-neighbor scaling, font metrics, and glyph drawing.
- Go fits the small explicit conversion loop and later local HTTP app. It is a
  packaging/maintenance choice, not a measured performance claim. Python remains
  viable and would use uv if revisited; Rust is also viable but adds complexity
  to this first pass. [Go font support](https://pkg.go.dev/golang.org/x/image/font/opentype).
- [Gutenberg #1727](https://www.gutenberg.org/ebooks/1727): Samuel Butler's English
  prose translation. Download its [UTF-8 text](https://www.gutenberg.org/cache/epub/1727/pg1727.txt),
  retain the raw file/source information, and select the story body excluding
  Gutenberg notices, contents, and prefatory material.
- Generate the transparent 2:3 master using the existing skill's concept approval
  and visual review. Retain prompt, palette, selected PNG, and background choice.
- Start with 12 x 18 inches at 300 DPI (3600 x 5400 pixels), a 0.75-inch margin,
  and a redistributable monospaced font retained with its license. Adjust defaults
  if the proof shows poor readability; Printful-specific settings come later.
- Prepare a nearest-neighbor character grid, using actual font metrics to preserve
  artwork proportions. Grid density is a practical configurable setting; select
  it from the preview rather than solving an exact full-book fitting problem.
- Traverse left to right, top to bottom. Alpha zero skips a cell without consuming
  text; any nonzero alpha receives a character in its sampled RGB color. Collapse
  whitespace to single spaces, retain punctuation, and wrap the text stream only
  if the chosen grid exhausts it. Record these settings and characters used.
- Keep masters/text, mapping, poster, preview, and one small JSON run record
  distinct. Local files are sufficient. Reruns use cached text/master, not fresh
  image generation. Do not overwrite the selected master or earlier candidates.

These are first-pass defaults, not permanent compatibility promises. Capture any
necessary changes alongside the proof.

## Implementation steps

1. Add a small Go module with a pinned supported toolchain; document its commands.
2. Cache and prepare the Odyssey text; obtain the approved generated master.
3. Implement the small mapping and Go rendering functions. Get a visible
   preview early, then tune grid density, font, margins, and background.
4. Save the poster PNG, inspectable mapping, preview, and run record; open the
   preview in Codex/browser. A static preview is enough for this first bullet.
5. Verify a tiny fixture's skipping/order/colors/dimensions and the real poster's
   appearance. Record actual duration, output size, command, and proof.

Success is an inspectable Odyssey poster that a fresh checkout can rerender with
Go and cached inputs. It is not contingent on CI, a generic schema system, a web
app, or Printful being built first.

## After the first poster

[COD-68](https://linear.app/codekips/issue/COD-68) adds a local curation interface:
review candidates, promote/scrap, retain decisions, and iterate on linked variants.
[COD-74](https://linear.app/codekips/issue/COD-74) integrates one promoted design
with Printful catalog requirements and its mockup/template workflow. Use a thin
Go `net/http` client over [Printful's API](https://developers.printful.com/docs/);
an SDK is not required for this small integration.
[COD-75](https://linear.app/codekips/issue/COD-75) explores a mug only afterward.
Storefronts, checkout, sales, and live order fulfillment are outside this plan.

## Next action

Start COD-67 with the Go module and cached Odyssey text. Use the artwork
skill to present source concepts while useful conversion work proceeds.
