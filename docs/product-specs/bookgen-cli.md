# Bookgen CLI contract

Every pipeline step is independently invocable through the Bun/TypeScript
`bookgen` CLI. Current steps are `ideas` and `images`, both using the authenticated
Codex CLI through its TypeScript SDK. Outputs are grouped by stable book ID.

## Shared book identity

The root `books.yaml` is versioned configuration, separate from generated output:

```yaml
schema_version: 1
books:
  dracula:
    title: Dracula
    author: Bram Stoker
```

Each key is a lowercase ASCII ID, words separated by hyphens, at most 100
characters. Entries require nonempty title and author. IDs determine output
folders; choose separate IDs for editions or same-title books. Registry schema
version, entries, duplicate YAML keys and safe IDs are validated before generation.
Unknown IDs fail with instructions to edit the registry. Both commands accept
`--registry <path>` and `--output <directory>`; defaults are `books.yaml` and
`output`, relative to the calling directory. The registry is never rewritten by
pipeline commands. Neither command hardcodes a Codex model; `--model` is optional.

`ideas` also retains legacy title calls with `--author` and `--slug` when the
argument is not ID-shaped. A valid registry is still required. Registered IDs
cannot override registry identity with these flags. Images requires a registered
ID and exact matching title, author and ID in `ideas.yaml`; rerun ideas after an
identity change.

## Ideas

`bookgen ideas <book-id>` generates exactly ten original composition ideas,
grounded in the book's themes, objects, setting, and relationships. Aim for
literary character-art posters inspired by the product category at
[Litographs](https://www.litographs.com/), using the
[source-art brief](../../.agents/skills/generate-book-art/SKILL.md). Ideas are
proposals; this command neither generates images nor approves concepts.

Timeout defaults to 300 seconds. The SDK runs in an isolated temporary read-only
workspace, without web search. This stage uses model knowledge rather than
fetching the original text. Literary accuracy requires review.

`ideas.yaml` uses schema version 2 and includes book identity, generation
provenance, and ten concepts with unique safe IDs and distinct names. Each concept
contains `id`, `name`, `composition`, `literary_basis`, `palette`, and
`conversion_resilience`. Palette is a nonempty list of `{ color, use }` entries,
without fixed roles, count or coverage ratios. Poster field colors may be
suggested with that intended use and remain outside the source master.

Composition describes the picture and arrangement. Silhouette, negative-space
storytelling, secondary motifs and two-stage reads are optional devices, not
mandatory ingredients. Favor substantial flat opaque shapes, transparent
perimeter and legible strokes/gaps. Dimensions and aspect ratio belong to image
settings, not idea compositions. Version 1 used fixed palette roles and separate
visual-device fields; rerun ideas to replace it with version 2.

Replace `ideas.yaml` atomically only after the full response validates. Failure,
timeout and interruption preserve the prior valid YAML. Replace `traces/ideas/`
on every generation attempt, saving prompt, events, raw response, run status,
thread ID and token usage. Only one ideas attempt per book may run at a time via
`.ideas.lock`. The command never clears images or downstream files.

## Images

`bookgen images <book-id>` consumes a validated snapshot of `ideas.yaml` and
produces exactly one processed PNG per idea. The user's batch request authorizes
all existing concepts, overriding the interactive skill's concept gate and three
variation workflow. Outputs remain unapproved candidates; selection/refinement
and later character conversion are separate work.

Generate sequentially, with one replacement attempt after a candidate generation or
validation failure. Pass the failure back into the replacement brief and retain
both attempt traces. Cancellation stops immediately. Generate through native Codex
image generation with existing Codex
authentication, not a separate API-key backend. Each idea has an isolated temporary
write workspace and a fixed `master.png` handoff; reject missing/nonregular files,
files over 50 MiB, incomplete turns, invalid structured responses and reported
native-tool failures. Trace SDK events before interpreting the final
response. No shell-generated artwork, external image references or programmatic
drawing fallback. Prompts request original pictorial art, true transparency,
wide structural features, flat opaque fills, no text, frames, mockups or texture.

Settings:

- `--timeout <seconds>` defaults to 600 **per attempt** (range 1–3600).
- `--size` requests `1024x1536` by default; `1536x1024` and `1024x1024` are also
  accepted. Native-tool dimensions are requested through the prompt, not guaranteed;
  record actual generated and processed dimensions.
- `--alpha-threshold` defaults to 128 (range 1–255).
- `--model` overrides the Codex agent model, not a specific image model.

The Codex response selects artwork colors from the idea palette, excluding entries
used solely for the poster field. Reject colors outside that palette. Deterministic
post-processing with Sharp:

1. Decode a single PNG with actual alpha, bounded to 16,777,216 pixels, into sRGB
   RGBA. Require at least one fully transparent source pixel; never infer or erase
   an opaque matte or drawn checkerboard.
2. Set alpha below the threshold to zero and remaining alpha to 255. Clear RGB in
   skipped pixels and reject a result with no opaque artwork.
3. Map each opaque pixel to the nearest selected artwork palette color using
   squared sRGB distance; ties use palette order. No dithering or resampling.
4. Add a transparent margin on each side equal to `ceil(source width * 0.02)`
   pixels (at least one). Preserve all original artwork geometry. Encode RGBA PNG.

Cleanup enforces alpha and colors, not literary accuracy, text absence, shape
widths, silhouette quality or removal of an almost-opaque background. Codex records visual self-review concerns in `review_notes`, without judging the
uncleaned original as a final artifact; a human must still inspect full size and thumbnail before
choosing a master. Quantization may change color boundaries; original PNGs remain
in traces for diagnosis and future improvements.

## Output ownership and reruns

```text
output/<book-id>/
  ideas.yaml
  raw/
    <idea-id>.png
    manifest.yaml
  traces/ideas/
    prompt.txt
    events.jsonl
    response.json
    run.json
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
```

Images owns `raw/` and `traces/images/`; it never changes ideas, their trace or
later stages. The manifest (schema version 1) records registry identity, upstream
YAML SHA-256, prompt/processing/Sharp/SDK/bookgen versions, requested model and size,
timeout, alpha/padding/color settings, and `review_status: unapproved`. Each image
records its idea ID, relative PNG path, output/native/prompt hashes, artwork colors,
thread ID, usage, successful attempt number, native visual-review notes, native/processed dimensions and cleanup
pixel statistics.
Downstream consumers must compare the recorded ideas hash with the current YAML
and inspect/select the intended master; idea IDs can change on regeneration.

A successful images rerun rebuilds and replaces the entire `raw/` set, including
obsolete IDs and the manifest. Generate into `.raw.staging` and publish only after
all ten outputs pass, cancellation is checked and the input hash still matches.
A generation failure preserves the previous complete image set, removes staging,
records the failing idea/error and exits nonzero. The latest trace replaces the
previous trace; originals and events from completed ideas in a failed attempt
remain there. Invalid inputs fail before touching existing outputs/traces.

A per-book `.images.lock` prevents overlapping image attempts. Publication moves
prior `raw/` to `.raw.previous`, then renames staging into place, restoring the prior
set if that rename fails. The next attempt recovers `.raw.previous` if a process
kill left `raw/` absent, or clears it if a complete `raw/` exists. After a forced
kill, confirm no run is active before manually removing the stale lock. Readers
should wait for successful CLI completion; directory replacement involves two
renames and is not a continuously available transactional filesystem view.

Artifacts/traces are local ignored iteration outputs at stable paths, not run
archives. Authentication and tool availability failures are explicit; generation
is stochastic, and recorded inputs/settings/hashes provide provenance rather than
identical future generation. Retaining the selected master makes conversion and
rendering reproducible. Poster rendering will place the master within different
poster sizes and fill surrounding space without regenerating the source artwork.

## Acceptance criteria

- Fresh frozen dependency install and `bun run check` pass.
- Help/input errors do not invoke Codex. Unknown book IDs and malformed registries
  fail before generation; both stages resolve the same registered identity.
- Ideas produces exactly ten validated concepts and preserves YAML on failure.
- Images produces one PNG per idea with binary alpha, selected palette colors,
  transparent perimeter, manifest and latest-attempt traces.
- Successful reruns remove obsolete image IDs. Partial failures, interruptions
  and timeouts preserve the previous complete set and release the image lock.
- Mismatched book identities, duplicate ideas, invalid PNGs, opaque backgrounds,
  empty artwork and changed upstream input are rejected without publication.
- Live Codex execution verifies native image generation with existing login;
  deterministic tests verify complete batches and failure/retry boundaries.
