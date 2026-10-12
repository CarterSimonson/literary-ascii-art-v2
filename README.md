# Literary ASCII Art v2

Modernize the [original Node generator](https://github.com/CarterSimonson/literary-ascii-art/tree/master/src)
by first making one Odyssey poster work from image generation through character
conversion to display. Then build a small curation web app and integrate Printful.
Storefronts and sales are outside the current scope.

## Current state

This repo contains documentation and the [source-art skill](.agents/skills/generate-book-art/SKILL.md).
The legacy script worked; its source has been reviewed. The new pipeline has not
been implemented. **Go** is the chosen starting point, with Go modules for
dependencies, the standard library, and `golang.org/x/image` for image/font work.

## Implementation path

1. **One Odyssey poster:** cache the Gutenberg text, generate and approve a
   transparent master, convert it into colored monospaced characters, and open
   a preview. Deliver a PNG and enough settings to rerun it.
2. **Curation web app:** browse variants, promote or scrap them, and iterate while
   preserving earlier candidates and review decisions.
3. **Printful poster:** prepare one promoted design for an actual catalog variant
   and generate its mockup or product template.
4. **Other formats:** try a mug after the poster integration works.

The [active plan](docs/exec-plans/active/odyssey-tracer-bullet.md) contains first-pass
defaults and acceptance checks. [Architecture](ARCHITECTURE.md) maps the small
planned pipeline; [tracking](docs/project-tracking.md) links the Linear queue.

## Working locally

There are no install, generation, or application test commands yet. Implementation
will pin the supported Go toolchain, commit `go.mod` and `go.sum`, and document
the actual `go run`, `go build`, and `go test` commands.

Current documentation checks:

```sh
git status --short --branch
git diff --check
git diff --cached --check
```

Use `.artifacts/` for disposable local runs. Keep retained masters, source text,
converted data, posters, and review records distinct; start with local files and
small JSON metadata. Decide durable binary storage when the first real assets exist.

Start with [AGENTS.md](AGENTS.md) and the [documentation map](docs/index.md).
