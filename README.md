# Literary ASCII Art v2

Turn a book into original literary art made from its own words. TypeScript uses
the Codex SDK for grounded research, composition ideation, and native image
generation under your existing ChatGPT subscription. A separate Go CLI prepares
images, maps book characters, and renders posters offline.

## Project tracking

- [Literary ASCII Art v2](https://linear.app/codekips/project/literary-ascii-art-v2-6cfd6b18fd52)
  in Codekips (`COD`). Tickets apply to this repository.
- [Tracking conventions](docs/project-tracking.md) and the [grab skill](.agents/skills/grab/SKILL.md).
- [COD-67 execution plan](docs/exec-plans/completed/odyssey-tracer-bullet.md).

## Setup

Tested with Bun 1.3.14, Codex SDK/CLI 0.162.1, and Go 1.26.9. Go modules select the
pinned toolchain automatically when toolchain downloads are enabled. The font and
its redistribution license are retained in `assets/fonts/`.

```sh
bun install --frozen-lockfile
codex login
bun run build:go
bun run art doctor
```

Sign in with ChatGPT. The coordinator rejects API-key authentication, removes API
billing credentials from child environments, and has no paid API fallback. Native
image generation consumes your existing Codex allowance. Subscription/authentication
failures retain progress; the tool does not buy credits or switch providers.

## Add a book

```sh
bun run art add-book "The Odyssey" --author Homer --gutenberg-id 1727
bun run art add-book "Dracula" --author "Bram Stoker" --ideate-only
```

The normal input is a title; `--author` narrows the source search. Gutenberg sources
are resolved against Gutendex metadata. Ambiguous editions return `needs-input`
with retrieved IDs; choose one with `--gutenberg-id`. For an already prepared story
body, use `--text /absolute/body.txt --author "Author"` instead.

The workflow caches source text, excludes Gutenberg notices/prefaces/footnotes,
researches the whole story in bounded sections, proposes three grounded concepts,
generates one image per concept, and renders three drafts. No book-specific code
or manually invented composition is required. Its opening text flows through
visible cells in order, stopping when the poster fills; it never repeats the book.

Outputs live in `.artifacts/books/<request-id>/` unless `--out` is supplied. The
final JSON prints that directory and candidate IDs. Open its `preview.html` for a
contact sheet with source masters, actual character posters, and rationale.
Default posters are 3600 × 5400 pixels (12 × 18 inches at 300 DPI), with 225-pixel
margins and 420 character columns. All candidates remain drafts.

## Resume, iterate, and review

```sh
bun run art resume --run /absolute/run-directory
bun run art new-batch --run /absolute/run-directory
bun run art re-ideate --run /absolute/run-directory
bun run art render --run /absolute/run-directory --candidate candidate-id --columns 480
bun run art review --run /absolute/run-directory --candidate candidate-id --decision promote
```

Ordinary reruns reuse completed stages. New batches reuse research/concepts and
retain the previous images; re-ideation reuses source/research and creates new
concepts. Offline `render` creates a sibling output and never calls Codex. Review
writes a separate promote/scrap record; recommendations do not promote drafts.

The initial budget is three image attempts. Completed images are never regenerated
automatically. An interrupted attempt has an unknown outcome: inspect its
`*.attempt.json`, event log, and native generated artifacts before explicitly
retrying. A stale `run.lock` includes its PID; remove it only after that process
has exited. Preserve earlier outputs. `--image-budget` can raise an explicit run
budget; it does not erase failed-attempt markers. Use a new batch/revision for a
new attempt. No automatic aesthetic repair loop is included in COD-67.

## Go artifact commands

```sh
.artifacts/bin/literary-art prepare /absolute/prepare.job.json
.artifacts/bin/literary-art map /absolute/map.job.json
.artifacts/bin/literary-art render /absolute/render.job.json
```

Each job is a version `"1"` JSON object. Commands write machine-readable result
JSON to stdout and diagnostics to stderr; they reject overwriting output files.
[Manifest contracts](docs/references/artifact-jobs.md) document fields and examples.
The renderer verifies font identity and preserves assignments from the mapping.

## Verification

```sh
bun run check
bun run format:check
bun test
go test ./...
go vet ./...
git diff --check
```

Tests use local fixtures and mocked Codex calls; they do not generate images or
consume subscription allowance. The explicit `bun run smoke` command generates
one capability-test image through the SDK and records events under `.artifacts/`.

Use `bun run art replay --proof assets/proofs/odyssey/proof.json --out .artifacts/replay`
for the retained Odyssey proof ; replay makes no Codex calls and
checks the rendered pixel hashes. Use a new output directory on each replay.

Retained source art, text, concepts, and provenance belong in `assets/` when chosen
for a durable proof. Disposable mappings/posters and review experiments remain
separate. [Architecture](ARCHITECTURE.md) describes these boundaries. The legacy
[Node generator](https://github.com/CarterSimonson/literary-ascii-art/tree/2feebc79a376ee63fc3757aebe8bc74dd61f1e41/src)
is a behavioral reference.

COD-68 adds a local curation UI; COD-74 prepares a promoted Printful poster and
mockup; COD-75 optionally explores mugs. Storefronts and sales are outside scope.
Start with [AGENTS.md](AGENTS.md) and the [documentation map](docs/index.md).

Raw Gutenberg downloads retain their original bytes, including CRLF and whitespace.
Git attributes preserve them without textual diffs; the separate story body and
source metadata remain inspectable.
