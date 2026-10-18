# Architecture

## Implemented today

The Bun/TypeScript `bookgen` CLI implements idea/image generation, Gutenberg text
fetching with Codex cleanup, and local character-art poster rendering.
The [CLI contract](docs/product-specs/bookgen-cli.md) defines inputs, outputs, and
retry semantics. Modules have these responsibilities:

- `src/cli.ts`: command parsing, settings, progress, exit codes, and interruption.
- `src/books.ts` and `books.yaml`: shared validated book-ID registry.
- `src/output-targets.ts` and `output-targets.yaml`: validated print-target registry
  with finished sizes, full canvas dimensions, bleed, and empty framing gutters.
- `src/ideas/schema.ts`: version 2 concept/palette validation and book/idea folder
  naming. Composition carries the visual design; palette lists colors and uses.
- `src/ideas/prompt.ts`: versioned literary composition brief.
- `src/ideas/codex.ts`: SDK adapter; streamed structured output from an isolated
  temporary working directory with read-only sandbox and noninteractive execution.
- `src/ideas/run.ts`: per-book locking, latest-attempt trace, artifact provenance,
  timeout, validation, and atomic replacement of `ideas.yaml`.
- `src/images/schema.ts`: validated requests and imported ideas/book identity.
- `src/images/prompt.ts`: native generation brief and artwork palette selection.
- `src/images/codex.ts`: isolated temporary write workspace, native generation
  through authenticated Codex, streamed events, and fixed PNG file ingestion.
- `src/images/process.ts`: Sharp PNG decoding, binary alpha, nearest-sRGB palette
  mapping, transparent padding, and validation without resampling artwork.
- `src/images/candidate.ts`: per-attempt trace, original preservation, timeout,
  artwork palette validation and cleanup boundary.
- `src/images/run.ts`: per-book images lock, sequential generation, input hash
  checks, stage-owned set replacement/recovery, provenance, and latest traces.
- `src/fetch/download.ts`: bounded, timed Gutenberg plain-text download.
- `src/fetch/text.ts`: UTF-8/header/boundary checks, validated range extraction,
  and faithful text normalization without rewriting.
- `src/fetch/schema.ts` and `src/fetch/codex.ts`: versioned cleanup instructions,
  structured removal ranges, and isolated read-only agent inspection.
- `src/fetch/run.ts`: orchestration, deadline/cancellation, and latest-attempt trace.
- `src/fetch/artifact.ts`: source/text provenance and staged artifact assembly.
- `src/fetch/publication.ts`: per-book locking, complete-set publication, rollback,
  and recovery after interrupted publication.
- `src/render/input.ts`: target selection and validated upstream snapshots/hashes.
- `src/render/text.ts` and `src/render/convert.ts`: render-only text cleanup and
  nearest-neighbor working grids and row-major pixel-to-character mapping,
  independent of glyph rasterization.
- `src/render/font.ts` and `src/render/raster.ts`: pinned font outlines, 6.5 pt rectangular-cell
  layout, source-color glyph rendering, and exact print-size PNG encoding.
- `src/render/run.ts` and `src/render/publication.ts`: rendering orchestration,
  manifests, locking, staged batch replacement, and publication recovery.
- `src/evals/suite.ts` and `evals/image-prompt/`: frozen image-prompt eval suite
  (Gatsby ideas) with validation and a suite hash.
- `src/evals/metrics.ts`, `src/evals/masks.ts`, and `src/evals/grid.ts`: versioned,
  deterministic image metrics from the native PNG and cleaned master, scored on
  the 24 × 36 character grid. See the
  [image-prompt evals plan](docs/exec-plans/active/image-prompt-evals.md).
- `tests/`: input, output, retry, failure, and CLI checks using fake SDK generation
  and decoded PNG fixtures.

The [generate-book-art skill](.agents/skills/generate-book-art/SKILL.md) guides
concept selection, image generation, visual review, and refinement. Ideas and generated images are
unapproved candidates. The images command intentionally consumes every idea, as
authorized by the user, without a selection gate. Render requires explicit idea selection and leaves posters unapproved for human
review. The CLI does not yet operate products or the store.

Text fetching runs independently of artwork. The required registry Gutenberg ID
selects an English edition; code downloads it and strips its explicit wrapper.
Codex dynamically identifies non-book ranges, while code validates anchors and
copies remaining text. The text manifest records source and clean hashes plus
all removal decisions. Semantic cleanup remains unapproved for human review.

## Intended stage boundaries

| Stage                | Inputs                                                         | Outputs                                                   | Validation needed                                                                   |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Source artwork       | Book identity, approved concept, palette                       | Transparent PNG master and generation metadata            | Composition, transparency, palette, and visual legibility                           |
| Character conversion | Approved master, identified book text, conversion settings     | Character placement and source-color data with provenance | Pixel coverage, transparent-pixel skipping, character order, and color preservation |
| Poster rendering     | Converted art, font, layout, poster background, print settings | Print file and render metadata                            | Dimensions, resolution, font behavior, margins, and visual proof                    |
| Product preparation  | Validated print file, provider settings, editorial metadata    | Mockups, product records, and listing drafts              | Asset references and provider-specific requirements                                 |
| Store operations     | Approved product records and external service responses        | Published listings and separately recorded store state    | External response validation and reconciliation                                     |

## Dependency rules

- Conversion consumes approved artwork and book text without invoking image
  generation or depending on a store or dropshipping service.
- Rendering consumes converted data without changing the master or character
  mapping. The underlying paper color is a render input; it is not painted into
  the transparent master. Opaque text fields carry text; transparent openings
  reveal subjects through missing text. Rendering separates differently colored
  regions with whole empty cells and never clips glyphs.
- Product preparation consumes validated print files. Publishing and store
  reconciliation belong at the external-service boundary.
- A downstream stage must not silently modify an upstream artifact. Changed
  inputs produce a new result with its own provenance.
- Keep generated masters, converted art, print files, mockups, product records,
  and store state distinct under `output/<book-slug>/`. Declare each step's owned
  paths as it is implemented; it may replace those files but not another step's.

## Reproducibility and external boundaries

Record the book and text source, master identity, stage settings, tool versions,
and input/output identities with each result. Image generation records its
prompt, selected artwork palette, settings, and unapproved review status; retaining
the selected master makes downstream work
reproducible even when generation itself cannot be replayed exactly.

Validate imported images, text, fonts, provider responses, and store responses
where they enter the system. Keep credentials in ignored local configuration or
the execution environment. Define schemas, versioning, and retry behavior when
the corresponding integration exists.

## Checks and open decisions

`bun run check` enforces strict TypeScript, type-aware lint, formatting, and Bun
tests; CI runs the same checks as separately named steps after a frozen dependency install. Runtime
validation enforces the requested number of complete concepts with unique safe IDs and names, hex
palettes, complete SDK turns, and safe book slugs. Tests cover ideas atomic
publication, complete image-set replacement and recovery,
failure preservation, trace replacement, locking, cancellation, upstream identity
and hash validation, binary alpha/palette cleanup, and CLI errors. Automated image
checks cannot establish composition, minimum feature widths, or literary fidelity;
human review remains necessary before choosing a master for conversion.

Composition descriptions are independent of output dimensions and do not require
specific visual devices. Source generation produces one reusable master per idea;
poster rendering owns size adaptation and the surrounding field. Negative-space
storytelling and secondary motifs are available techniques rather than schema
requirements. Palettes have no fixed role names, color count, or coverage ratios.

The [render contract](docs/product-specs/bookgen-cli.md#render) defines character-grid
rules, whitespace/glyph handling, font geometry, and PNG output. The
[bootstrap guide](docs/BOOTSTRAP.md) describes remaining production work. Durable
asset storage and external providers remain undecided. Record decisions and their rationale through
the [documentation map](docs/index.md).
