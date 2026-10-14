# Architecture

## Implemented today

The Bun/TypeScript `bookgen` CLI implements idea and image generation through the Codex SDK/CLI.
The [CLI contract](docs/product-specs/bookgen-cli.md) defines inputs, outputs, and
retry semantics. Modules have these responsibilities:

- `src/cli.ts`: command parsing, settings, progress, exit codes, and interruption.
- `src/books.ts` and `books.yaml`: shared validated book-ID registry.
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
- `tests/`: input, output, retry, failure, and CLI checks using fake SDK generation
  and decoded PNG fixtures.

The [generate-book-art skill](.agents/skills/generate-book-art/SKILL.md) guides
concept selection, image generation, visual review, and refinement. Ideas and generated images are
unapproved candidates. The images command intentionally consumes every idea, as
authorized by the user, without a selection gate. The CLI does not yet convert
characters, render posters, or operate products or the store.

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
  mapping. The poster background is a render input; it is not painted into the
  transparent master.
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
tests; CI runs the same command after a frozen dependency install. Runtime
validation enforces ten complete concepts with unique safe IDs and names, hex
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

The [bootstrap guide](docs/BOOTSTRAP.md) describes remaining stages. Character-grid
rules, text normalization, font metrics, print format, durable asset storage, and
external providers remain undecided. Record decisions and their rationale through
the [documentation map](docs/index.md).
