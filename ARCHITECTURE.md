# Architecture

## Current and planned implementation

Today only the [source-art skill](.agents/skills/generate-book-art/SKILL.md) exists.
The legacy [Node source](https://github.com/CarterSimonson/literary-ascii-art/tree/2feebc79a376ee63fc3757aebe8bc74dd61f1e41/src)
was reviewed as a behavioral reference: Jimp prepares a grid, Canvas draws colored
characters, and poster settings add dimensions and margins. This repo's Go
implementation has not been built yet.

Start with Go modules, the standard library, and `golang.org/x/image`. A CLI and a
few cohesive functions are enough for the first poster. Prefer measured font metrics to the
old fixed aspect-ratio assumption. Separate the retained master, sampled grid,
character mapping, and rendered poster without inventing a framework around them.

## First working path

```text
Gutenberg text + generated transparent master
    -> prepared text and character grid
    -> colored character mapping
    -> poster PNG + browser preview
```

Image generation uses the existing skill and approval workflow; rerendering uses
cached inputs. Standard-library PNG support and `x/image` handle images and glyphs.
The CLI owns input/output paths and simple settings. Keep source pixels/colors and text
order inspectable, and record the font, input identities, prompt, palette, grid,
and output dimensions in a small run record.

Nearest-neighbor preparation makes each sampled nontransparent pixel one character
cell. Transparent cells consume no text. Preserve the sampled RGB colors and
compensate for the actual monospaced cell shape so the artwork is not distorted.
Rendering consumes the mapping; it does not change assignments or overwrite inputs.

## Next additions

The curation web app reuses generation/conversion/rendering functions and adds
persistent promote/scrap decisions and variant links. Start with the smallest local
interface that supports this loop; choose its web stack when implementing it.

Printful then consumes promoted poster files and adds catalog/template/mockup
references. Use `net/http` for a thin adapter over its
[REST API](https://developers.printful.com/docs/). Storefront publishing and sales
are outside the plan. A mug is a later layout experiment, not an upfront product
abstraction.

## Verification

The first loop needs one real Odyssey proof and a small offline fixture checking
transparent skipping, text order, colors, and output dimensions. Record runtime
and output size on the real poster before optimizing. Add checks when they protect
observed behavior; CI and general schemas are not prerequisites to seeing the
first result. Detailed defaults and progress belong in the [active plan](docs/exec-plans/active/odyssey-tracer-bullet.md).
