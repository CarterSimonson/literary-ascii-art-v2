# Literary ASCII Art v2

An end-to-end system for creating and selling literary character art. Each opaque
source-image pixel becomes a monospaced character from the book, preserving the
pixel's color; transparent pixels are skipped. The resulting artwork becomes a
print-ready poster and, eventually, a product in an online store.

## Current state

`bookgen` is a Bun/TypeScript CLI. Its first command, `bookgen ideas <book>`, uses
the Codex SDK to generate ten original poster composition ideas, validated and
saved as book-grouped YAML with a trace of the latest attempt. It follows the
[source-art skill](.agents/skills/generate-book-art/SKILL.md) for bold, transparent
compositions and coherent palettes, aiming for literary character-art posters
in the spirit of [Litographs](https://www.litographs.com/).

Ideas are proposals. Image generation, character conversion, poster rendering,
product preparation, and store operations remain future CLI steps. Image
generation will require concept selection through the source-art workflow.

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
bun run bookgen ideas "Dracula" --author "Bram Stoker"
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

```sh
bookgen ideas "Dracula" --author "Bram Stoker"
bookgen ideas "Dracula" --author "Bram Stoker" --timeout 600
bookgen ideas "The Trial" --author "Franz Kafka" --slug kafka-the-trial
bookgen ideas --help
```

Options: `--author`, `--slug`, `--output` (default `output` relative to your current
directory), `--model`, and `--timeout` (default 300 seconds). Quote multiword titles.
Use an explicit slug to distinguish same-title books or editions, or for titles
that cannot be normalized into a lowercase ASCII folder name. Input errors and
failed attempts exit nonzero; success prints the absolute YAML path to stdout.

## Outputs and retries

```text
output/dracula/
  ideas.yaml
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
and visual quality before image generation.

Rerunning the command replaces `ideas.yaml` only after a complete, validated
response, and replaces the latest trace on each attempt. Failed attempts preserve
the last valid YAML. Other stages' files, including future `raw/<idea-id>.png`
masters, remain intact. Only one ideas attempt per book may run at a time. After
a forced process kill, confirm no run is active before removing a stale
`output/<slug>/.ideas.lock` directory. See the [CLI contract](docs/product-specs/bookgen-cli.md).

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
Routine tests use a fake SDK event stream and require no credentials or network;
the live ideas command is the integration check. Editor whitespace defaults are
in `.editorconfig`; formatting is defined in `.prettierrc.json`.

## Intended pipeline and project knowledge

Every stage must be independently executable through `bookgen`, with explicit
inputs, outputs, provenance, validation, and ownership of retryable output paths:
ideas → approved source artwork → character conversion → poster rendering →
product preparation → store operations.

- [Agent instructions](AGENTS.md)
- [Architecture](ARCHITECTURE.md)
- [CLI contract](docs/product-specs/bookgen-cli.md)
- [Documentation map and execution plans](docs/index.md)
- [Remaining bootstrap work](docs/BOOTSTRAP.md)
- [Linear project and work queue](docs/project-tracking.md)
