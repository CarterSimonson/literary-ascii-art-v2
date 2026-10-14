# Bootstrap the literary-art pipeline

The Bun/TypeScript `bookgen ideas <book-id>` and `bookgen images <book-id>` commands
generate ten concepts and one cleaned PNG per concept through the Codex SDK/CLI. Its
[CLI contract](product-specs/bookgen-cli.md)
defines book-grouped outputs and independent stage retries; the README documents
setup and checks. Use this guide for the remaining artwork-to-poster journey.

## 1. Define the first observable outcome

Start with an approved transparent PNG and reviewed `bookgen fetch` text. Produce
character art and a poster proof with recorded inputs and settings. Establish
acceptance criteria for pixel-to-character mapping, character order and wrapping,
text normalization, font geometry, source colors, and print output before building
on those choices.

Run `bookgen images <book-id>` and review/select a generated candidate as the
master. The [source-art skill](../.agents/skills/generate-book-art/SKILL.md) guides
visual quality and any requested refinement. Use a small deterministic
fixture for conversion checks so routine verification does not require image
generation. Run `bookgen fetch <book-id>` independently and review its clean text
and recorded removals before conversion.

Defer dropshipping and store integrations until the local artwork-to-poster
journey works. Record material product decisions and acceptance criteria in the
documentation map.

## 2. Establish the project

Bun, strict TypeScript, lint, formatting, tests, and CI are established. Extend
the CLI with independent commands as pipeline stages are implemented. Keep
actual setup and verification commands in the [README](../README.md) and update
the [architecture](../ARCHITECTURE.md) with each new stage's boundaries and checks.

Local outputs belong under `output/<book-slug>/`, with `ideas.yaml`, latest-attempt
traces, and `raw/<idea-id>.png` masters kept distinct from later-stage
artifacts. Choose durable production storage and versioning for masters, book
texts, converted art, print files, mockups, product records, and store state.
Each new command must define its owned paths and metadata before implementation.

## 3. Close the first feedback loop

Implement conversion and rendering as distinct stages. Provide a reproducible
example and a way to inspect its character data and rendered proof. Report invalid
inputs with enough context to diagnose and repair them.

Verify that opaque pixels receive characters, transparent pixels are skipped,
source colors are preserved, and the selected traversal and text rules give a
stable result. Inspect a rendered proof for font spacing, composition, background,
and output dimensions. Record evidence and limitations with the execution plan.

## 4. Make important rules executable

Use the selected stack's native tools and CI to check meaningful behavior and
enforce stage boundaries. Validate image, text, and render inputs where they enter
the system. Cover edge cases such as fully transparent images, exhausted or empty
text, and invalid print settings according to the chosen acceptance criteria.

Keep checks focused on actual behavior. Add provider and store checks when those
integrations are implemented, including their failure and reconciliation behavior.

## 5. Leave a usable handoff

Verify the first outcome and update the README and architecture to match the
implementation. Link new decisions, specs, and plans from [the index](index.md).
Record unfinished work with concrete next actions. Keep AGENTS.md as the short
entry point. Once bootstrap is complete, remove this guide and its links.
