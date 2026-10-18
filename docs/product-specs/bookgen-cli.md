# Bookgen CLI contract

Every pipeline step is independently invocable through the Bun/TypeScript
`bookgen` CLI. Current steps are `ideas`, `images`, `fetch`, and `render`. Generation and text
cleanup use the authenticated Codex CLI through its TypeScript SDK; rendering is
entirely local. Outputs are grouped by stable book ID.

## Shared book identity

The root `books.yaml` is versioned configuration, separate from generated output:

```yaml
schema_version: 1
books:
  dracula:
    title: Dracula
    author: Bram Stoker
    gutenberg_id: 345
```

Each key is a lowercase ASCII ID, words separated by hyphens, at most 100
characters. Entries require nonempty title and author plus a positive integer `gutenberg_id`.
The Gutenberg ID pins the English source edition; no other text provider or
automatic edition selection is supported. IDs determine output
folders; choose separate IDs for editions or same-title books. Registry schema
version, entries, duplicate YAML keys and safe IDs are validated before generation.
Unknown IDs fail with instructions to edit the registry. All commands accept
`--registry <path>` and `--output <directory>`; defaults are `books.yaml` and
`output`, relative to the calling directory. The registry is never rewritten by
pipeline commands. Ideas and images default to `gpt-6.1-sol` with fixed `high`
reasoning effort. Their optional `--model` overrides the agent model while keeping
high reasoning effort. Both stages record the selected model and reasoning effort
in artifact provenance and run traces. Fetch inherits the configured Codex model
unless `--model` is supplied.

`ideas` also retains legacy title calls with `--author` and `--slug` when the
argument is not ID-shaped. A valid registry is still required. Registered IDs
cannot override registry identity with these flags. Images requires a registered
ID and exact matching title, author and ID in `ideas.yaml`; rerun ideas after an
identity change.

## Output target registry

The root `output-targets.yaml` is manually maintained versioned configuration,
separate from `books.yaml` and generated outputs. Its shape is `schema_version: 1`
and `targets`, keyed by stable lowercase hyphen-separated IDs (at most 100
characters). There are no registry-management commands. Pipeline
commands use `--registry` for books only; render uses `--targets` for this registry.

Each target requires:

- `name`: nonempty display name, at most 240 characters.
- `size_inches`: positive finite `width` and `height` of the finished, trimmed poster.
- `canvas_px`: positive integer `width` and `height` of the entire print file,
  including any bleed. These explicit dimensions are authoritative for rendering.
- `bleed_px`: nonnegative integer `top`, `right`, `bottom`, and `left` insets from
  the full canvas to the trim boundary. This region is cut off during production.
- `gutter_px`: nonnegative integer insets on the same four edges, measured inward
  from the trim boundary. This visibly empty border contains only the poster
  background color, never characters or artwork. It accommodates frame overlap.

Layout is full canvas → inset bleed → finished poster → inset gutter → content
area. The poster background extends through the gutter and bleed. Insets are
explicit for every target; no hidden defaults or additional safe margin apply.
Bleed and gutter together must leave a positive content width and height.
Pixel dimensions and insets must be safe integers. Unknown fields, unsupported
versions, unsafe IDs, and duplicate YAML keys are rejected.

The initial `poster-18x24` and `poster-24x36` targets use the requested
5400 × 7200 and 7200 × 10800 px canvases, zero bleed, and 150 px gutters on all
edges. This is a ½-inch border at 300 PPI, chosen to leave visible space beyond
typical frame overlap. Other resolutions and per-edge overrides are allowed;
the schema does not enforce 300 PPI or derive pixel dimensions from inches.

`src/output-targets.ts` exposes `findOutputTarget` and `resolveOutputTarget`,
following the book registry loader pattern. Both validate the entire file;
`resolveOutputTarget` rejects unknown IDs with instructions to edit the registry.
An optional registry path defaults to `output-targets.yaml` relative to the calling
directory. Loading never modifies the registry or generated artifacts.
Render consumes this registry; provider-specific print settings remain future work.

## Ideas

`bookgen ideas <book-id>` generates exactly `--count` original composition ideas
(default 10, integer 1–20),
grounded in the book's themes, objects, setting, and relationships. Aim for
literary character-art posters inspired by the product category at
[Litographs](https://www.litographs.com/), using the
[source-art brief](../../.agents/skills/generate-book-art/SKILL.md). Ideas are
proposals; this command neither generates images nor approves concepts.

Timeout defaults to 300 seconds. The SDK runs in an isolated temporary read-only
workspace, without web search. This stage uses model knowledge rather than
fetching the original text. Literary accuracy requires review.

`ideas.yaml` uses schema version 2 and includes book identity, generation
provenance (including `idea_count`), and that many concepts with unique safe IDs
and distinct names. Downstream stages accept any nonempty set of saved ideas. Each concept
contains `id`, `name`, `composition`, `literary_basis`, `palette`, and
`conversion_resilience`. Palette is a nonempty list of `{ color, use }` entries.
Newly generated ideas have at most three: a primary text ink, an optional accent
ink, and an optional suggested paper color, which stays outside the source master.
Saved ideas with larger palettes remain readable downstream.

Ideas prompt version 6 follows the Litographs visual system: one rectangular text
field in one primary ink fills the interior art area; one iconic subject is cut out
of it as a crisp transparent silhouette; interior details are drawn as bold
transparent channels rather than extra colors; an optional accent colors one
element only, ringed by a transparent channel. The rest of the field stays plain,
without secondary scenery. Contours are smooth vector shapes with no torn or
ragged edges, and strokes and gaps stay at least about 1% of the canvas width.
Earlier versions favored multi-color illustrated environments; rerun ideas and
images to adopt version 6. Two-stage reads remain optional. Dimensions and aspect ratio belong to image
settings, not idea compositions. Version 1 used fixed palette roles and separate
visual-device fields; rerun ideas to replace it with version 2.

Deliberate transparent gaps and gutters between objects remain valid for separation,
rhythm and breathing room. They may interrupt colored fields. Evaluate whitespace
by compositional purpose rather than maximizing coverage; preserve designed gaps
while removing large leftover blank areas.

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
used solely for underlying paper. Image prompt version 4 asks for the same
single-field, single-subject system, smooth contours, and a transparent channel
around any accent element.
Reject colors outside that palette. Deterministic
post-processing with Sharp:

1. Decode a single PNG with actual alpha, bounded to 16,777,216 pixels, into sRGB
   RGBA. Require at least one fully transparent source pixel; never infer or erase
   an opaque matte or drawn checkerboard.
2. Set alpha below the threshold to zero and remaining alpha to 255. Clear RGB in
   skipped pixels and reject a result with no opaque artwork.
3. Map each opaque pixel to the nearest selected artwork palette color using
   squared sRGB distance; ties use palette order. No dithering or resampling.
4. Remove thresholding artifacts (processing version 2). The minimum feature is a
   square of `max(1, round(source width * 0.01))` pixels per side. A 4-connected
   transparent region that does not touch the image edge is filled with its most
   common bordering artwork color when it is smaller than the minimum feature or
   when fewer than half of its pixels had native alpha at or below 16; such haze
   is what soft model shading leaves after thresholding. Crisp cutouts are kept.
   Opaque regions smaller than the minimum feature are cleared. Record haze
   regions filled, small holes filled, specks removed, and pixels changed.
5. Add a transparent margin on each side equal to `ceil(source width * 0.02)`
   pixels (at least one). Preserve remaining artwork geometry. Encode RGBA PNG.

`bookgen images <book-id> --reclean` reapplies the current cleanup to the native
images saved in the latest images trace, without invoking Codex. It requires the
current `ideas.yaml` to match the published manifest, every idea to have a record,
and each traced native PNG to match its recorded `generated_sha256`. It republishes
the full `raw/` set atomically under the same lock, carries over prompts, attempts,
review notes, and usage, updates processing metadata and hashes, and records
`recleaned_at`. Otherwise the previous set is preserved. Rerender afterwards.

Cleanup enforces alpha and colors, not literary accuracy, text absence, shape
widths, silhouette quality or removal of an almost-opaque background. Codex records visual self-review concerns in `review_notes`, without judging the
uncleaned original as a final artifact; a human must still inspect full size and thumbnail before
choosing a master. Quantization may change color boundaries; original PNGs remain
in traces for diagnosis and future improvements.

Source thumbnails do not establish final conversion quality. Before approval,
review a rendered character preview at the target grid and font size for recognizable
empty forms and sufficient visual weight in the text-bearing field. Only an
unintended matte is a background failure.

## Fetch

`bookgen fetch <book-id>` is independent of ideas/images and requires no upstream
artifact. It downloads the pinned English edition from
`https://www.gutenberg.org/cache/epub/<id>/pg<id>.txt` directly, without scraping
catalog/search pages. No alternative ID, format, provider, or translation is
silently selected. Missing/unavailable text fails with the URL and HTTP status.
See Gutenberg's [download guidance](https://www.gutenberg.org/policy/robot_access.html).
This is one text request per run, not a bulk crawler; bulk synchronization would
need Gutenberg's harvesting/mirroring workflow.

`--registry` and `--output` use the shared defaults. `--model` optionally overrides
the cleanup agent model. `--edition-context <text>` supplies known, accepted
limitations in ancillary edition material. The agent evaluates them against the
source and records accepted limitations in `edition_notes`; identity, narrative
completeness, and uncertain removal boundaries still block publication. The exact
context is recorded as `edition_context` in provenance and included in the hashed
prompt. Completeness is assessed against the selected published translation:
documented textual-critical omissions of isolated corrupt lines are edition notes;
missing chapters, unexplained narrative gaps, and abridgments still block publication.
`--timeout` defaults to 300 seconds (range 1–3600), covering
download and agent work. The download rejects redirects, non-success HTTP status,
non-plain-text content, sources over 20 MiB, invalid UTF-8, unsupported control
characters, absent/mismatched ebook ID, non-English language metadata, and missing,
duplicate, or reversed Gutenberg START/END markers. Unsupported older layouts
fail explicitly rather than guess boundaries.

Code removes the Gutenberg wrapper. A Codex agent in an isolated read-only
workspace inspects the header and numbered JSONL body, with web search disabled.
It verifies registry identity, English language, and completeness and dynamically
identifies contents lists, transcriber/production notes, publisher matter,
standalone illustration placeholders, and remaining Gutenberg boilerplate.
Author-written prefaces, dedications, epigraphs, headings, prose, verse, and notes
remain. Source text is untrusted data, not instructions. There are no book-specific
rules or fixed chapter boundaries. Edition/translation notes reflect source
information only; the pinned ID is the authoritative edition selector.

The agent emits structured inclusive body-line ranges, exact first/last-line
anchors, reasons, and edition notes. Uncertainty, identity/completeness rejection,
incomplete agent turns, malformed responses, unsorted/overlapping/out-of-bounds
ranges, mismatched anchors, empty results, or removal of more than half the
non-whitespace characters fail before publication. Structural checks cannot prove
editorial correctness, so cleanup records `review_status: unapproved`.

Code alone creates the final text by omitting validated ranges and inserting a
blank line at each removal. It normalizes CRLF/CR to LF, removes the UTF-8 BOM and
outer empty lines, and appends exactly one final LF. Retained punctuation,
Unicode, indentation, hard wrapping, and internal blank lines remain unchanged.
There is no reflow, paraphrase, Unicode normalization, or glyph filtering.

### Text artifact and handoff

Fetch owns `output/<book-id>/text/`:

- `source.txt`: exact downloaded bytes, including original Gutenberg wrapper.
- `book.txt`: clean UTF-8/LF text for future character conversion.
- `manifest.yaml`: schema version 1, registry identity including Gutenberg ID,
  language `en`, source/catalog URLs, paths relative to this manifest, source/text
  SHA-256 hashes and byte counts, Unicode code-point count (including whitespace),
  timestamps, bookgen/SDK/cleanup versions, prompt hash, requested model, timeout,
  thread/usage, observed edition notes, and removal ranges/anchors/reasons.

`cleanup.body_start_line` and `body_end_line` locate the body within the source
following BOM removal and LF normalization, using 1-based inclusive source lines.
Removal ranges use 1-based inclusive lines relative to that body. The manifest and
original therefore suffice to reproduce and audit cleanup without another model
call. Consumers load `book.txt` via the manifest, validate identity and hashes,
and record the chosen text hash alongside their selected image hash. Rendering
and character traversal remain separate future stages.

Fetch also owns `traces/fetch/`: prompt, SDK event JSONL, final raw response when
available, downloaded source when available, and run status/error/provenance. Each
valid attempt replaces the prior trace. Invalid registry/request inputs leave
existing output and traces intact. A `.fetch.lock` prevents concurrent runs.
Stage into `.text.staging`, move the old text set to `.text.previous`, and publish
only after complete validation. Restore the previous set on publication failure;
the next run recovers a backup if a forced kill left `text/` missing. Successful
reruns remove obsolete files only within `text/`. Failures preserve prior text,
ideas, images, and downstream artifacts. Readers must wait for CLI completion;
the two directory renames are recoverable but not a continuously atomic view.

## Render

`bookgen render <book-id> --idea <idea-id>` combines a selected source master and
fetched text for all registered output targets. `--target <target-id>` selects one;
there is no implicit idea selection or `--all-targets` flag. `--targets <path>`
defaults to `output-targets.yaml`; `--registry` and `--output` retain their shared
meanings. `--background '#RRGGBB'` defaults to white. No Codex call, network access,
font download, or upstream mutation occurs at render time.

### Input and conversion contract

Read snapshots of ideas, image/text manifests, selected PNG, book text, and target
registry. Require matching book title/author/ID and pinned Gutenberg edition,
current ideas hash, selected image/text hashes, and recorded source dimensions.
Reject duplicate upstream IDs, unknown selections, nonregular or oversized inputs
(over 50 MiB), non-PNG or multi-image masters, nonbinary alpha, and empty artwork.
Only canonical `raw/<idea-id>.png` and `text/book.txt` manifest references are accepted.
All target entries are validated, even for a single-target run. An empty target
selection fails. Recheck every input snapshot immediately before publication.

Conversion is independent of rasterization (`src/render/convert.ts`). Decode the
master as RGBA in sRGB and validate binary alpha. For each target, nearest-neighbor
sample a render-only copy to the target's character grid, selecting source pixel
centers with `floor((coordinate + 0.5) * sourceSize / gridSize)`. This preserves
sampled RGB values and binary alpha without altering the master; downsampling may
lose small features. Grid dimensions compensate for rectangular character cells.
Reject a grid that loses all opaque artwork.

Assign one Unicode code point per visible, non-background grid pixel, traversing
left-to-right and then top-to-bottom. Transparent pixels, opaque white (`#FFFFFF`),
and pixels exactly matching the configured background receive no character and do
not advance the stream. Other pale colors remain eligible. Reject a grid with no
visible artwork after exclusion. A word space consumes an eligible cell and leaves
it blank; it is never replaced with a fallback glyph. Use the leading text that fits; there is no requirement to fit the
entire book. If text is exhausted, repeat from the beginning to fill the artwork.
Record text used, omitted characters, and complete/partial cycles per target.

Before assigning characters, separate differently colored ink regions with whole
empty cells (`--separation <cells>`, default 1, range 0–4; 0 disables). A cell is
left empty when an ink cell of another color within that Chebyshev radius sorts
before it by RGB value, so only one side of each boundary yields and radius 1
leaves exactly one empty cell. Separated cells do not consume text. Glyphs are
never clipped: every printed character is whole. Record the radius and the number
of separated cells in the manifest.

For render only, parse Markdown to textual content with Marked, retaining link
labels, image alt text, code contents, and table cell text. Discard markup, HTML
comments, script/style contents, and tags; decode HTML entities, normalize NFC,
collapse Unicode whitespace to one ordinary space, trim surrounding whitespace,
and remove controls, format characters, and residual `*`, `_`, backticks, and `~`.
Keep separators between Markdown blocks, table cells, and explicit line breaks.
Preserve word spacing, other punctuation, and letters. Reject an empty result.
This intentionally favors dense art over source typography and readability.
Fetch artifacts remain unchanged. The pinned Noto Sans Mono Latin Black 900 font is
loaded as outlines through OpenType.js; unsupported or empty glyphs other than word spaces become `?`,
with unique replacements recorded. No platform font substitution is allowed.

### Raster layout and output

Subtract bleed and gutter from the full canvas to obtain the content rectangle.
The minimum/default font size is **6.5 points**, converted to pixels using target
PPI (`6.5 * PPI / 72`, about 27.083 px at 300 PPI). The minimum applies to the actual font em
size, not the grid cell. It does not shrink when the full book does not fit.

Use rectangular cells: width is `ceil(fontSizePixels * 0.60)`; height is
`ceil(max(fontSizePixels, glyphBoundsHeight))`. Bounds cover all unique supported
text glyphs at that font size. Center the natural, unstretched font outlines within
each cell using a shared baseline and monospaced advance. The bundled Black face
is weight 900; at 300 PPI the 6.5 pt text uses 17×28 px cells for Dracula.
Render version 3 recorded this font and spacing change, and version 4 adds
color separation; the font hash identifies
the pinned outlines. No synthetic bolding or platform font substitution is used.

Fit the full source aspect ratio inside the content rectangle, divide fitted
width/height by cell width/height, and floor to integer grid dimensions. Resample
the working copy to that grid. Its aspect ratio differs from the master to
compensate for the rectangular cells; the physical artwork preserves the source
proportions within one cell of rounding. Center the resulting grid, with an odd
extra pixel placed on the bottom/right. Reject targets too small for a single cell
or larger than 100 megapixels. Surrounding space stays background-only.

Sharp rasterizes font outlines once per glyph and target. Composite each glyph
mask in the sampled source pixel's sRGB color on the configured background;
antialiasing blends edge pixels. Blank glyph space, transparent pixels, gutters,
and bleed retain the background. Output is full-color; ink colors are preserved
but apparent color is lighter because glyphs occupy only part of each cell.
Print proofs still need human review.

Derive horizontal/vertical PPI from the trimmed pixel size and finished inches.
Require agreement within 0.1 PPI and density within 1–100,000 PPI; record the rounded
integer density in the manifest and PNG metadata. Encode an opaque RGB PNG with
sRGB profile at the exact full-canvas dimensions. Font binaries and dependencies
are pinned; manifests include font hash, dependency versions, source hashes,
cleaned and substituted text hashes, character/cycle counts, skipped background
and transparent pixel counts, target snapshot,
background, layout, output hash, and `review_status: unapproved`.

### Publication

Render owns `print/<idea-id>/<target-id>/poster.png` and `manifest.yaml`. One
`.render.lock` per book serializes renders. Stage a copy of the selected idea's
existing print directory in `print/.<idea-id>.staging`, replacing only selected
target subdirectories. This preserves unselected targets, including targets no
longer in the registry. It may temporarily require another copy of existing prints.

After all selected targets finish and snapshot checks pass, rename the old idea
directory to `print/.<idea-id>.previous` and publish staging. Roll back a failed
publication rename. On the next valid run, restore a backup if final output is
missing, otherwise discard the old backup. Failed generation, changed inputs, and
cancellation before publication preserve existing output. Clean staging and release
the lock on handled failures; a forced kill may require manually removing a stale
lock after confirming no render remains active. Readers must await successful CLI
completion because the two directory renames are recoverable, not continuously
atomic. Success prints one absolute poster path per selected target.

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
rendering reproducible. Poster rendering uses target-specific working grids and fills surrounding space
without regenerating or modifying the source master.

## Acceptance criteria

- Render preserves sampled pixel/character mapping, validates upstream hashes,
  defaults to all targets, keeps type at 6.5 pt, respects bleed/gutters, and publishes selected targets
  together while preserving previous output on failure and unrelated targets.

- Fetch requires a pinned Gutenberg ID, English text, complete agent cleanup,
  and validated removal anchors; it preserves verbatim retained text and source.
- Fetch manifests replay cleanup and identify both input and output hashes;
  failures, cancellation, timeout, and concurrent runs preserve the prior set.

- Fresh frozen dependency install and `bun run check` pass.
- Help/input errors do not invoke Codex. Unknown book IDs and malformed registries
  fail before generation; all stages resolve the same registered identity.
- Ideas produces exactly the requested number of validated concepts and preserves
  YAML on failure.
- Images produces one PNG per idea with binary alpha, selected palette colors,
  transparent perimeter, manifest and latest-attempt traces.
- Successful reruns remove obsolete image IDs. Partial failures, interruptions
  and timeouts preserve the previous complete set and release the image lock.
- Mismatched book identities, duplicate ideas, invalid PNGs, opaque backgrounds,
  empty artwork and changed upstream input are rejected without publication.
- Live Codex execution verifies native image generation with existing login;
  deterministic tests verify complete batches and failure/retry boundaries.
