# Establish Bun and the bookgen ideas tracer

## Outcome

Implement the [CLI contract](../../product-specs/bookgen-cli.md): a reproducible
Bun/TypeScript project and `bookgen ideas <book>` through the Codex SDK, producing
ten validated literary poster concepts with tidy outputs and observable retries.

## Steps

1. Record CLI, output ownership, and retry guidance in project context.
2. Install pinned tooling and SDK dependencies; configure strict TypeScript,
   type-aware lint, formatting, Bun tests, and CI.
3. Implement CLI parsing, concept schema/brief, SDK adapter, tracing, and safe
   output replacement.
4. Test successful regeneration, invalid input/output, and failed attempts.
5. Run a live Dracula example, inspect YAML/trace, update entry-point docs, and
   record results and remaining gaps here.

## Decisions and progress

- Bun 1.3.14 is available. Use the SDK's bundled Codex executable by default.
- Follow official [Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk)
  and installed SDK types for structured responses and streamed events.
- Ideas are proposals only; image generation remains a subsequent approved step.
- Pinned TypeScript 6.0.3 because the installed ESLint parser supports TypeScript
  below 6.1; the initially resolved TypeScript 7 produced peer warnings.
- Implemented the single ideas command, structured SDK streaming, schema
  validation, prompt/version hashes, token usage, locking, timeout/cancellation,
  and atomic publication. Latest traces replace prior attempts; later stages'
  artifacts remain untouched.
- Registered the CLI with `bun link` and verified the executable. This host's
  PATH omits `~/.bun/bin`; README documents the explicit PATH setup and local
  `bun run bookgen` alternative.

## Verification and results

- `bun install --frozen-lockfile`: passed, no dependency changes.
- `bun run check`: strict type check, zero-warning type-aware lint, formatting,
  and all 29 Bun tests. Tests cover exact concept count, duplicate IDs/names,
  malformed output, unsafe slugs, CLI errors, successful retry, failed/incomplete
  streams, timeout/cancellation, lock contention, and preserving other artifacts.
- `bun run bookgen ideas Dracula --author 'Bram Stoker'`: live SDK run passed
  using existing Codex authentication and the configured default model. Generated
  ten validated concepts at `output/dracula/ideas.yaml` in about 199 seconds.
  Inspected the complete YAML and trace: literary motifs are distinct; prompts,
  thread ID, completed status, token usage, and artifact hash are retained.
- `/Users/cs/.bun/bin/bookgen --help`: linked Bun executable passed.
- `git diff --check`: passed. Entry-point docs reflect the implementation.
- CI uses Bun 1.3.14, frozen install, and the same `check` command; remote CI has
  not run because this work has not been pushed.

## Remaining work

Implement source-image generation as its own command after concept selection,
with `raw/<idea-id>.png` outputs and image validation. Ideas currently use model
knowledge without retrieving or verifying original text; literary fidelity and
visual quality require human review. Character conversion, rendering, product
preparation, store integrations, and durable production storage are future stages.
Forced kills can leave a stale lock; recovery is documented in the CLI contract.

## Revision: flexible compositions and palettes

User review identified that the original format imposed an image ratio, fixed
color roles, and mandatory storytelling devices on every idea. Revised the
contract, prompt (version 2), YAML artifact schema (version 2), source-art skill,
and project entry points:

- Composition describes the visual arrangement without image dimensions or
  aspect ratios. Generate one reusable master; rendering owns placement in
  different poster sizes and filling surrounding space.
- Palette is a nonempty list of hex colors with intended uses, allowing granular
  assignments without fixed role names, color count, or coverage percentages.
- Removed separate primary-subject, negative-space, and secondary-motif fields.
  These devices may appear in composition when useful; literary basis and
  conversion resilience remain required.

Verification: `bun run check` passed with 32 tests, including simple compositions,
one-color and granular palettes, and invalid/empty palette rejection. The skill
creator's `quick_validate.py` passed using an isolated PyYAML dependency through
`uv run --no-project --with pyyaml`. All 38 local documentation links resolve.
The live Dracula command regenerated ten version 2 ideas in about 212 seconds;
inspected all compositions and palettes. None mention aspect ratios or image
dimensions, palettes contain four or five colors with specific uses, and the
updated prompt/hash and complete SDK trace are retained. The previous version 1
sample was replaced through the same CLI command, without manual YAML edits.
