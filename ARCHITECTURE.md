# Architecture

## Implementation

The TypeScript coordinator, Codex SDK adapter, and Go artifact CLI are implemented.
The [source-art skill](.agents/skills/generate-book-art/SKILL.md) provides editorial guidance.
The legacy [Node source](https://github.com/CarterSimonson/literary-ascii-art/tree/2feebc79a376ee63fc3757aebe8bc74dd61f1e41/src)
was reviewed as a behavioral reference: Jimp prepares a grid, Canvas draws colored
characters, and poster settings add dimensions and margins. The new pipeline uses Go for deterministic image/font work.

Start with Go modules, the standard library, and `golang.org/x/image`. A CLI and a
few cohesive functions are enough for the first poster. Prefer measured font metrics to the
old fixed aspect-ratio assumption. Separate the retained master, sampled grid,
character mapping, and rendered poster without inventing a framework around them.

## First working path

```text
Book request -> resolved work/edition + cached story text
    -> grounded literary research -> three concepts -> saved recipes
    -> Codex image generation -> cached raw candidates -> prepared masters
    -> Go character mapping/rendering -> draft posters + contact sheet
    -> awaiting human review -> promoted candidate record
```

The TypeScript `add-book` coordinator uses the Codex SDK and owns source
resolution, stage order, caches, budgets, workflow/review state, and durable
artifacts. It runs research, composition ideation, and built-in image generation
using the existing ChatGPT subscription. A separate Go CLI owns deterministic
preparation, mapping, and rendering through versioned JSON job/result manifests.
There is no paid API-key dependency or automatic API fallback. The subscription SDK smoke test has verified a native PNG path; real book drafts
provide the visual acceptance proof.

The user chose automatic concepts/drafts and human review before promotion,
waiving the source-art skill's concept gate for this workflow. Its literary/visual
rules become versioned runtime prompts and style data. New books require no
manually invented compositions or interactive Codex operator. Codex remains the
automated model/tool runtime; Go handles deterministic image preparation and glyphs.
TypeScript invokes the Go binary with explicit argument arrays. Its stdout carries
JSON artifact results and stderr carries diagnostics. The Go CLI operates offline
without model calls or Codex credentials. Bun 1.3.14 runs the tested SDK 0.162.1 integration; dependencies and the Go
toolchain are pinned.

Research, ideation, and fresh images are stochastic; saved outputs provide replay.
Keep raw candidates and deterministic alpha/palette preparation distinct. A model
recommendation cannot promote a draft. Human promotion freezes a candidate ID/hash;
rerendering uses cached inputs without calling Codex or a model API.
The CLI owns input/output paths and settings. Keep source pixels/colors and text
order inspectable, and record the font, input identities, prompt, palette, grid,
and output dimensions in a small run record.

Nearest-neighbor sampling makes each prepared nontransparent pixel one character
cell. Transparent cells consume no text. Preserve the sampled RGB colors and
compensate for the actual monospaced cell shape so the artwork is not distorted.
Text begins at the story's first character and follows book order. Truncate when
the grid fills; never wrap or repeat the book. If text ends first, leave remaining
cells empty and report it. Rendering consumes the mapping; it does not change
assignments or overwrite inputs.

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

The first loop needs automatic Odyssey concepts/drafts, a second book's grounded
research/ideation smoke check, and a small offline fixture checking
transparent skipping, text order, colors, and output dimensions. Record runtime
and output size on the real poster before optimizing. Add checks when they protect
observed behavior; CI and general schemas are not prerequisites to seeing the
first result. Detailed defaults and progress belong in the [completed plan](docs/exec-plans/completed/odyssey-tracer-bullet.md).
