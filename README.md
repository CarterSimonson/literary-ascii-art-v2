# Literary ASCII Art v2

An end-to-end system for creating and selling literary character art. Each opaque
source-image pixel becomes a monospaced character from the book, preserving the
pixel's color; transparent pixels are skipped. The resulting artwork becomes a
print-ready poster and, eventually, a product in an online store.

## Current state

`bookgen` is a Bun/TypeScript CLI. `bookgen ideas <book-id>` uses
the Codex SDK to generate ten original poster composition ideas, validated and
saved as book-grouped YAML with a trace of the latest attempt. It follows the
[source-art skill](.agents/skills/generate-book-art/SKILL.md) for bold, transparent
compositions and coherent palettes, aiming for literary character-art posters
in the spirit of [Litographs](https://www.litographs.com/).

`bookgen images <book-id>` consumes all ten ideas, generates one native transparent
PNG per idea through the same authenticated Codex CLI, and deterministically cleans
alpha and artwork colors. Images remain unapproved candidates for human review.
Character conversion, poster rendering, product preparation, and store operations
remain future steps.

## Setup and commands

Install [Bun](https://bun.com/docs/installation) 1.3.14 or later. The lockfile and
CI use Bun 1.3.14. Install dependencies and register the executable:

```sh
bun install --frozen-lockfile
bun link
export PATH="$HOME/.bun/bin:$PATH"
bookgen --help
```

`bun link` exposes `bookgen` in Bun's global bin directory (normally
`~/.bun/bin`). The PATH command above enables it in the current shell; configure
your shell's PATH if you want that to persist. If you configured a different Bun
global bin directory, use that directory instead. You can always run the local
CLI without linking:

```sh
bun run bookgen --help
bun run bookgen ideas dracula
bun run bookgen images dracula
```

The [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) includes its pinned Codex
CLI. Authenticate it once using your existing Codex login, or run its bundled
login command:

```sh
bun node_modules/@openai/codex/bin/codex.js login
```

Alternatively, supply `CODEX_API_KEY` in the environment or an ignored `.env`
file. The SDK inherits your Codex configuration and authentication; omit `--model`
to use your configured default. Generation consumes your Codex usage or configured
provider's API usage.

Define reusable book identities in the root [books.yaml](books.yaml):

```yaml
schema_version: 1
books:
  dracula:
    title: Dracula
    author: Bram Stoker
```

Registry keys are stable lowercase IDs used as output folder names. Both commands
accept `--registry <path>` (default `books.yaml` in the calling directory) and
`--output <directory>` (default `output`). Unknown IDs and malformed registries
fail before generation. Registered identity cannot be overridden by flags.

```sh
bookgen ideas dracula
bookgen images dracula
bookgen images dracula --timeout 900
bookgen ideas --help
bookgen images --help
```

Both commands use your Codex login and configured Codex model; `--model` overrides
that model, not the native image backend. No separate Images API key is required.
Images requires a Codex CLI/account with native image generation available; it
fails explicitly if that capability is unavailable. It creates a temporary
workspace with write access so Codex can copy the generated PNG into it.

Ideas timeout defaults to 300 seconds. Images timeout defaults to 600 seconds
**per attempt**, with sequential generation and at most one replacement per idea; a
full batch may take several minutes.
Images accepts `--size` (`1024x1536` default, `1536x1024`, or `1024x1024`) as a
request to the native tool; the manifest records actual returned dimensions.
`--alpha-threshold` defaults to 128 (valid range 1–255).

Legacy title-style ideas calls such as `bookgen ideas "Dracula" --author "Bram Stoker"`
still work with a valid registry. Lowercase ID-shaped arguments resolve as registry
IDs. Add new books to the registry to use them throughout the pipeline.
Failed commands exit nonzero; success prints the absolute artifact/manifest path.

## Outputs and retries

```text
output/dracula/
  ideas.yaml
  raw/
    <idea-id>.png
    manifest.yaml
  traces/images/
    ideas.yaml
    run.json
    <idea-id>/
      attempt-1/           # attempt-2 exists only for a replacement
        prompt.txt
        events.jsonl
        generated.png
        response.json
        failure.json       # only on failure
  traces/ideas/
    prompt.txt
    events.jsonl
    response.json
    run.json
```

YAML contains book identity, generation provenance, and ten concepts with
composition, literary basis, a list of hex colors with intended uses, and
conversion rationale. Silhouette, negative-space storytelling, and secondary
motifs are optional visual devices. Image dimensions belong to generation
settings: one reusable master will be placed within different poster sizes,
with surrounding space filled at render time. The trace saves the exact prompt, SDK
events, raw response when available, completion/failure status, and token usage.
The CLI uses the model's knowledge of the book; it does not fetch or verify the
original text in this first stage. Human review still evaluates literary fidelity
and visual quality before selecting artwork for downstream conversion.

Rerunning the command replaces `ideas.yaml` only after a complete, validated
response, and replaces the latest trace on each attempt. Failed attempts preserve
the last valid YAML. Other stages' files, including `raw/<idea-id>.png`
masters, remain intact. Only one ideas attempt per book may run at a time. After
a forced process kill, confirm no run is active before removing a stale
`output/<slug>/.ideas.lock` directory. See the [CLI contract](docs/product-specs/bookgen-cli.md).

Images validates the entire ideas YAML against the registry before generating.
Each native original, including rejected candidates when available, remains in the
latest trace. A failed candidate gets one replacement attempt before the batch fails.
Cleanup keeps source geometry,
sets alpha below the cutoff to zero and all remaining alpha to 255, maps opaque
pixels to the nearest selected artwork palette color in sRGB, and adds a transparent
margin of 2% of source width on each side. Poster field colors are excluded by the
generation brief and selected artwork palette. Opaque mattes and empty artwork
are rejected; cleanup does not infer background removal, repair composition, or
verify literary accuracy. Final masters are RGBA PNGs with binary alpha and flat
palette colors, ready as inputs for a future conversion step.

Images generates into staging and publishes `raw/` as one complete set. A successful
rerun replaces all PNGs and the manifest, including obsolete idea IDs. A failed
batch preserves the previous complete set and replaces only the latest images
trace. Ideas and later-stage files remain intact. The manifest records upstream
YAML hash, image/prompt hashes, palette, dimensions, processing settings, usage,
native visual-review notes, and `review_status: unapproved`; stale outputs can be
detected by their input hash.
Changing ideas during image generation causes the attempt to fail.

Only one images run per book may execute at a time. After a forced kill, confirm
no run is active before removing `output/<id>/.images.lock`. The next run restores
`.raw.previous` if a kill interrupted publication; staging is rebuilt. Publication
uses directory renames with recovery, so readers should wait for CLI completion.

Generated `output/`, dependencies, coverage, and local environment files are
ignored by Git. These local outputs are iteration artifacts; durable production
asset storage remains a later decision.

## Development and verification

```sh
bun run check
bun run typecheck
bun run lint
bun run format:check
bun run format
bun test
```

`check` runs strict TypeScript, type-aware ESLint with zero warnings, Prettier,
and Bun tests. CI installs from the frozen lockfile and runs the same checks.
Routine tests use fake Codex generation and small PNG fixtures, with no credentials
or network. Live ideas/images commands exercise the real Codex integration. Editor
whitespace defaults are
in `.editorconfig`; formatting is defined in `.prettierrc.json`.

## Intended pipeline and project knowledge

Every stage must be independently executable through `bookgen`, with explicit
inputs, outputs, provenance, validation, and ownership of retryable output paths:
ideas → image candidates → approved source artwork → character conversion → poster rendering →
product preparation → store operations.

- [Agent instructions](AGENTS.md)
- [Architecture](ARCHITECTURE.md)
- [CLI contract](docs/product-specs/bookgen-cli.md)
- [Documentation map and execution plans](docs/index.md)
- [Remaining bootstrap work](docs/BOOTSTRAP.md)
- [Linear project and work queue](docs/project-tracking.md)
