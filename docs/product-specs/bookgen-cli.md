# Bookgen CLI contract

The initial journey is `bookgen ideas <book>`, a Bun/TypeScript CLI using the
Codex TypeScript SDK. Generate exactly ten distinct, original poster composition
ideas, grounded in the book's themes, objects, setting, and relationships. Aim
for literary character-art posters inspired by the product category at
[Litographs](https://www.litographs.com/), using the
[source-art brief](../../.agents/skills/generate-book-art/SKILL.md). The ideas
command proposes concepts; it does not generate images or approve a concept.

## Input and output

Accept a book title, optional author, output root, explicit book slug, model,
and request timeout. Default to `output/` relative to the calling directory and
a normalized title slug. Use `--slug` to distinguish same-title books or editions.
Do not hardcode a model: use the user's configured Codex default unless overridden.

```text
output/
  dracula/
    ideas.yaml
    traces/ideas/
      prompt.txt
      events.jsonl
      response.json
      run.json
    raw/<idea-id>.png       # reserved for a later image-generation command
```

`ideas.yaml` uses schema version 2 and includes book identity, generation
provenance, and ten concepts with unique stable-safe IDs. Each concept contains
`id`, `name`, `composition`, `literary_basis`, `palette`, and
`conversion_resilience`. Palette is a nonempty list of `{ color, use }` entries:
hex colors and their intended uses, without a fixed number of colors, predefined
roles, or coverage ratios. A suggested poster field color can be included in the
palette, but is applied at render time rather than painted into the master.

Composition describes the picture and its arrangement. Subject, silhouette,
negative-space storytelling, secondary motifs, and a two-stage read are available
devices, not required fields or ingredients. Favor meaningful book-specific art
over forcing every concept into the same visual formula. Conversion still needs
substantial flat opaque shapes, a transparent perimeter, and legible strokes/gaps.

Generate one reusable high-resolution source master in poster-friendly dimensions
chosen by the image-generation step. Image dimensions and aspect ratios are
generation settings and must not appear in idea compositions. Rendering adapts
the master to different poster sizes by placing the art and filling surrounding
space, rather than regenerating the concept for each size. Exact master dimensions
and placement settings will be selected when those commands are implemented.

Version 1 used separate subject/negative-space/motif fields and fixed palette roles.
Rerun `bookgen ideas` to replace it with version 2; old traces are not relabeled.

Every pipeline step must be invocable independently through `bookgen`. A step
owns a declared set of files and replaces those files on successful regeneration.
Paths identify the latest outputs, not timestamped run archives. Idea IDs are
unique within a run; a regenerated set can introduce new IDs. Later commands must
record the upstream artifact identity so stale downstream outputs can be detected.

## Retries and observation

Replace `ideas.yaml` atomically only after parsing and validating all ten concepts.
A failed or timed-out attempt exits nonzero and leaves the previous valid YAML
intact. Replace the latest ideas trace on every attempt, record completion/failure,
thread ID and token usage when available, and retain the exact prompt, SDK events,
and raw final response for diagnosis. Trace data can contain book input and model
output; it is ignored by Git alongside the artifacts.

Allow one ideas attempt per book at a time through an exclusive local lock.
Normal failure and interruption clean up the lock; after a forced process kill,
remove the stale `output/<slug>/.ideas.lock` directory only after confirming no
run is active. Regenerating ideas does not clear raw images or later-stage outputs.
Generation is stochastic; the saved prompt, settings, version, and artifact hash
provide provenance rather than a guarantee of identical future output.

## Acceptance criteria

- Fresh dependency installation, type checks, strict lint, formatting checks,
  and deterministic tests are runnable as CLI commands.
- Help and input errors do not invoke Codex. Failed input exits nonzero.
- A live command generates exactly ten validated concepts in book-grouped YAML.
- Retry replaces the expected artifact and trace, preserves unrelated files, and
  does not publish malformed, incomplete, or duplicate concepts.
- An SDK failure is observable and preserves any prior valid ideas artifact.
