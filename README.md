# Literary ASCII Art v2

An end-to-end system for creating and selling literary character art. Each opaque
source-image pixel becomes a monospaced character from the book, preserving the
pixel's color; transparent pixels are skipped. The resulting artwork becomes a
print-ready poster and, eventually, a product in an online store.

## Current state

This repository contains project guidance and a
[source-art generation skill](.agents/skills/generate-book-art/SKILL.md). The skill
defines concept selection, transparent 2:3 PNG masters, limited palettes, and
visual review. It requires an image-generation tool supplied by the agent's
environment.

There is no application implementation, selected runtime, dependency manifest,
automated test suite, or CI workflow yet. No generated artwork, converted art,
print files, product records, or store state are checked in.

## Intended pipeline

1. Create and approve original book-inspired source artwork.
2. Convert opaque pixels to characters from an identified book text.
3. Render and validate print-ready posters.
4. Create dropshipping products, mockups, metadata, and listings.
5. Operate and maintain the online store.

Each stage should have explicit inputs, outputs, metadata, and validation. Keep
the stage outputs distinct and retain enough provenance to reproduce a result.
The [architecture map](ARCHITECTURE.md) describes the intended boundaries and what
exists today.

## Working locally

Only Git and a text editor are needed to work on the current repository. There are
no install, application run, or test commands yet. Start with [AGENTS.md](AGENTS.md)
and follow the [bootstrap guide](docs/BOOTSTRAP.md) when implementing the pipeline.
Document actual setup, run, and verification commands here as tooling is added.

Useful checks for the current documentation-only repository:

```sh
git status --short --branch
git diff --check
git diff --cached --check
```

Editor defaults are in `.editorconfig`. Local environment files, agent worktrees,
and scratch outputs under `.artifacts/` are ignored. `.artifacts/` is for disposable
local work; durable production assets still need an explicit storage and versioning
decision during bootstrap.

## Project knowledge

- [Agent instructions](AGENTS.md)
- [Architecture](ARCHITECTURE.md)
- [Documentation map and execution-plan conventions](docs/index.md)
- [Bootstrap guide](docs/BOOTSTRAP.md)
- [Linear project and work queue](docs/project-tracking.md)
