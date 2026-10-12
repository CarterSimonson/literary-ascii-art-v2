# Bootstrap the literary-art pipeline

The repository standards are in place, but the application has not been built.
Use this guide to establish the first working journey. Choose implementation
details to suit the product; do not add layers or integrations before they are
needed.

## 1. Define the first observable outcome

Start with an approved transparent PNG and an identified book text. Produce
character art and a poster proof with recorded inputs and settings. Establish
acceptance criteria for pixel-to-character mapping, character order and wrapping,
text normalization, font geometry, source colors, and print output before building
on those choices.

The [source-art skill](../.agents/skills/generate-book-art/SKILL.md) can supply a
master through its existing concept and approval workflow. Use a small deterministic
fixture for conversion checks so routine verification does not require image
generation.

Defer dropshipping and store integrations until the local artwork-to-poster
journey works. Record material product decisions and acceptance criteria in the
documentation map.

## 2. Establish the project

Choose the runtime and its conventional source layout. Make dependency setup
reproducible and document actual install, run, and verification commands in the
[README](../README.md). Update the [architecture](../ARCHITECTURE.md) with code
locations, public interfaces, and allowed dependency directions.

Choose storage and versioning for masters, book texts, converted art, print files,
mockups, product records, and store state. Define stage metadata that identifies
inputs, outputs, settings, and tool versions. Keep disposable local output separate
from durable assets.

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
