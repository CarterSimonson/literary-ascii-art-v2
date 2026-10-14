# Literary ASCII Art v2

## Map

- [README](README.md): project purpose, current state, and development commands.
- [Architecture](ARCHITECTURE.md): pipeline boundaries and dependency rules.
- [Documentation](docs/index.md): decisions, designs, and execution plans.
- [Bootstrap](docs/BOOTSTRAP.md): remaining work to establish the first working pipeline.
- [Generate book art](.agents/skills/generate-book-art/SKILL.md): source-art workflow.

## Project tracking

- Linear project: [Literary ASCII Art v2](https://linear.app/codekips/project/literary-ascii-art-v2-6cfd6b18fd52).
- Linear team: Codekips (`COD`).
- [Tracking conventions and initial queue](docs/project-tracking.md). Linear owns
  current issue status and dependencies; keep durable designs and plans here.

## Product

We're building an end-to-end system for selling literary character art:

1. Create original book-inspired source artwork.
2. Convert each opaque source pixel into a monospaced character from the book; skip transparent pixels and preserve source colors.
3. Render print-ready posters.
4. Create dropshipping products, mockups, metadata, and listings.
5. Operate and maintain the online store.

Favor reproducible pipeline stages with explicit inputs, outputs, metadata, and validation. Keep generated masters, converted art, print files, mockups, product records, and store state distinct.

## CLI and outputs

- Use Bun and TypeScript. Every pipeline step must be independently executable
  through the `bookgen` CLI; the first step is `bookgen ideas <book-id>` through the
  Codex SDK, producing ten original poster composition ideas.
- Resolve shared book IDs through root `books.yaml`. `bookgen images <book-id>`
  generates and cleans one unapproved PNG candidate per idea through Codex CLI.
- Aim for recognizable literary character-art posters in the spirit of
  Litographs, grounded in the book and the source-art skill's conversion rules.
- Generate one reusable source master; poster rendering adapts it to other sizes
  by placing the art and filling the surrounding space. Keep image dimensions out
  of composition ideas. Use a flexible palette with intended uses for colors;
  silhouette, negative-space storytelling, and secondary motifs are optional.
- Group local generated outputs under `output/<book-id>/`: `ideas.yaml`,
  `raw/<idea-id>.png` masters, and separate later-stage artifacts. Keep output tidy
  and ignored by Git.
- Each command regenerates its own expected outputs at stable paths so steps can
  be retried independently. Preserve the last valid artifact if generation fails;
  never silently delete or rewrite another stage's outputs. See
  [CLI contract](docs/product-specs/bookgen-cli.md) for metadata and retry details.

## Working conventions

- Keep durable knowledge in the repository. Record decisions where a future
  agent can find them, and update affected docs with the code.
- For substantial work, keep an execution plan using the convention in the
  [documentation map](docs/index.md). Small changes need no extra paperwork.
- Make behavior observable and verify the requested outcome using the project's
  tools. Include the evidence and any remaining gaps in the handoff.
- When a recurring failure reveals a missing capability, improve the relevant
  tool, check, or documentation so the next attempt has better feedback.
- Enforce important boundaries with checks; leave implementation choices open
  within those boundaries. Keep changes small enough to review and correct.
- Keep this file short. Add guidance when it captures a project-specific decision
  or prevents a demonstrated mistake; remove instructions that no longer help.
