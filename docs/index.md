# Documentation map

## Entry points

- [README](../README.md): purpose, current state, and actual development commands.
- [Agent instructions](../AGENTS.md): working conventions and product rules.
- [Architecture](../ARCHITECTURE.md): implemented workflow and intended boundaries.
- [Bootstrap](BOOTSTRAP.md): establish the first reproducible pipeline journey.
- [Bookgen CLI contract](product-specs/bookgen-cli.md): commands, book-grouped
  outputs, stage ownership, and retry behavior.
- [Bookgen ideas execution plan](exec-plans/completed/bookgen-ideas.md): first Bun
  CLI and Codex SDK tracer implementation and verification.
- [Bookgen images execution plan](exec-plans/completed/bookgen-images.md): shared
  book registry, native Codex image generation, cleanup, and rerun verification.
- [Bookgen fetch execution plan](exec-plans/completed/bookgen-fetch.md): pinned
  Gutenberg editions, dynamic cleanup ranges, reproducible text artifacts, and verification.
- [Bookgen render execution plan](exec-plans/completed/bookgen-render.md):
  full-color print output, 6.5 pt typography, sampled character grids, and verification.
- [Fetch readability refactor](exec-plans/completed/fetch-readability.md): coding
  conventions, phase boundaries, and unchanged-artifact verification.
- [Negative-space examples](exec-plans/completed/negative-space-examples.md): source-art
  direction correction, regenerated Dracula examples, and typography/margin proofs.
- [Noto standardization](exec-plans/completed/noto-standardization.md): selected font,
  tighter spacing, and regenerated poster examples.
- [Litographs direction](exec-plans/completed/litographs-direction.md): single-field
  compositions, three-color palettes, whole-cell color separation, and haze cleanup.
- [Project tracking](project-tracking.md): Linear project, initial queue, and
  verification and review conventions.
- [Starter alignment](exec-plans/completed/starter-alignment.md): adopted baseline,
  verification, and remaining work.

## Growing the documentation

Add links here as documents are written. Each document should capture useful
project knowledge; create directories only when they have content.

```text
docs/
  design-docs/            Decisions, rationale, and project-specific principles
  product-specs/          Intended behavior and acceptance criteria
  exec-plans/
    active/              Substantial work in progress
    completed/           Finished plans and their outcomes
    tech-debt-tracker.md  Known gaps and follow-up work, when needed
  generated/             Derived schemas or API references, when useful
  references/            External context needed to work on the project
```

Keep decisions with their rationale and validation status. Mark generated material
with its source and regeneration command. Add a local index when a collection
becomes difficult to navigate. Split out reliability, security, or UI guidance
when concrete project rules warrant it.

## Execution plans

For work that spans sessions or involves significant uncertainty, save a plan
under `exec-plans/active/`. Include the outcome, context, steps, validation, and
current progress. Record decisions and discoveries as you go, with a concrete
next action so another agent can resume. Move the plan to `completed/` when
finished, recording results and remaining follow-up. Small changes need no plan.

## Keeping the repository useful

Compare docs with actual behavior during development and cleanup. Remove stale
guidance and address small inconsistencies before they spread. Track meaningful
quality gaps once there is evidence to assess; turn repeated review feedback into
a focused check or durable decision. Add recurring maintenance automation when
the volume of work warrants it.

This baseline comes from `CarterSimonson/starter` at commit
`fc2b1f7334b6f2d09b08d3fe88babf0b065d6645`. Architecture, tooling, and review and
merge policy remain project decisions.
