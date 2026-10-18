# Image-prompt evaluation loop

## Outcome

A fast, repeatable loop for improving the image-generation prompt. Each round
generates a few prompt variants against three frozen Great Gatsby ideas, renders
every result at 24 × 36 inches, and shows them in a simple local web interface
where the user reviews, tags, and comments on each image and retries any of them.
The agent reads that feedback, writes the next round's variants, and reruns. When
a variant is clearly better, it becomes the committed default prompt.

The target is the external reference standard the user holds in mind for
literary character-art posters. We are currently well short of it, so each round
records an absolute verdict per image (how close to the standard it is) as well as
which variant was preferred. Relative wins alone could hide that we are still far
from the bar.

Nothing that names or reproduces that external reference is committed: no
reference images, links, or names in code, fixtures, docs, or committed results.
Reference material, if used in review, stays in ignored local files.

This plan covers design and sequencing only. Nothing here is implemented yet.

## Context

- Pipeline today: `ideas` (prompt v6) → `images` (prompt v4, processing v2,
  `--reclean`) → `fetch` → `render` (v4, whole-cell color separation). See the
  [CLI contract](../../product-specs/bookgen-cli.md).
- The user judges image generation, not ideation, to be the main bottleneck.
  Changes so far were ad hoc: one sample per idea, judged by eye. Generation is
  stochastic, so one sample cannot separate a better prompt from a lucky draw.
- Known defects from the Gatsby v4 run: cloudy or mottled native shading that
  thresholding turns into torn islands, stray scenery islands, and accents that
  touch the primary field. Processing v2 hides some of this after the fact; the
  prompt should prevent it.
- Native alpha is far from binary. In the Gatsby v4 manifest,
  `normalized_alpha_pixels` (pixels whose alpha changed during thresholding) is
  about the same as `opaque_pixels`: nearly every artwork pixel had partial alpha.
  Scoring only the cleaned master hides this, so metrics must read the native PNG.
- Cost reference (Gatsby v4, three images): about 2 min 50 s for the sequential
  batch, roughly 1 minute per image. Each image used 80–150k input tokens (about
  75% cached) and 1.2–1.5k output tokens of Codex usage.
- The default request size `1024x1536` is exactly 2:3, the aspect of the 24 × 36
  poster. Its content area inside the ½-inch gutters is 6900 × 10500 px (about
  0.657), so 2:3 masters fill it with little extra field.
- Existing Gatsby traces keep native PNGs, prompts, review notes, and usage, so
  metrics can be checked on them before any new generation.

## Target qualities

The qualities the user's feedback is measured against. Tags in the review
interface map to them, and the metrics below estimate them where possible. This
list is a working draft; the user's feedback refines it.

1. **One calm field.** A single rectangular text field in one ink, edge to edge
   inside the margins, with no stray islands, haze, or texture.
2. **Instantly readable subject.** One iconic silhouette cut out of the field,
   recognizable at thumbnail size and from across a room.
3. **Designed interior detail.** Features, folds, and architecture drawn as
   confident transparent channels that survive the 24 × 36 character grid.
4. **Clean contours.** Smooth curves and straight lines, like a paper cut or
   screen print; no torn, ragged, or wobbly edges.
5. **Disciplined color.** At most one accent, used for one named element, ringed
   by a gap; never touching the primary field.
6. **Literary aptness.** The subject is an obvious, apt symbol of the book.

## Design

### 1. Frozen suite

The suite is the three existing Great Gatsby ideas, committed as fixtures so the
image prompt is the only variable:

| Case                          | Why it is in the suite                                                     |
| ----------------------------- | -------------------------------------------------------------------------- |
| `the-weight-of-shirts`        | Closest to the target today; the control that must not regress.            |
| `the-distance-of-desire`      | Has an accent (the green light); tests accent separation.                  |
| `the-machine-of-carelessness` | Produced the most haze and pinholes; tests calm fields and clean contours. |

```text
evals/image-prompt/
  suite.yaml            # suite version, book ID, case IDs
  cases/<case-id>.yaml  # frozen idea (ideas schema v2) and purpose notes
```

Each case freezes the complete idea (composition, literary basis, palette,
conversion resilience) copied from the current `output/the-great-gatsby/ideas.yaml`
and is validated with the existing ideas schema and book registry. Changing a case
bumps the suite version. A hand-written idea can be added later to probe one
failure mode, or the image prompt can be frozen to test ideation instead; both are
out of scope for now.

### 2. Rounds, variants, and samples

A **round** is one comparison: about 3 prompt variants × 3 ideas × 3 images = 27
images. One variant in every round is the current default prompt, as the control,
so each round contains its own baseline and rounds never need to be compared
across time.

- **Variants are uncommitted prompt files.** Each is a template under the round's
  ignored directory, filled with the same idea fields as `buildImagePrompt`. The
  control variant is generated from the committed `src/images/prompt.ts`. Every
  variant's exact text and SHA-256 are recorded with its results.
- **Parallel generation.** Images generate concurrently (default 3 at a time,
  `--concurrency` to change). At about a minute per image, a round takes roughly
  10–15 minutes and about 2–4M input tokens (mostly cached) and ~40k output
  tokens of Codex usage.
- **No automatic replacement attempt.** Unlike `images`, a failed generation is
  recorded rather than silently retried, so the failure rate is a visible
  property of the variant. The user or agent can retry any image explicitly.
- **Rendering** is local and renders only `poster-24x36`.

### 3. Deterministic metrics

Metrics support the user's judgement; they do not replace it. A pure, versioned
metrics module (`METRICS_VERSION`) reads the traced native PNG, the cleaned
master, the case palette, and the selected artwork colors. Metrics are
recomputable offline, so earlier rounds can be rescored when metrics improve.

| Metric                  | Source          | Definition (draft)                                                                                                                        | Quality |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Native haze fraction    | native          | Share of art-bounding-box pixels with alpha in (16, 239): neither crisp cut nor solid ink. Scored before cleanup.                         | 1, 4    |
| Cleanup change fraction | processing v2   | `island_pixels_changed` / area, with recorded haze regions, small holes, and specks. High values mean cleanup is repairing the output.    | 1       |
| Palette compliance      | native          | Share of opaque native pixels farther than a fixed sRGB distance from every selected color; distinct mapped colors versus allowed.        | 5       |
| Field rectangularity    | master          | (Opaque + enclosed transparent area) / bounding-rectangle area; count of significant opaque components (target: one field, ≤ one accent). | 1       |
| Subject cutout clarity  | master          | Largest enclosed transparent region's share of the field and of all enclosed transparent area; number of significant cutouts.             | 2, 3    |
| Grid survival           | master + target | Share of cutout and channel area, and of cutout components, still present after nearest-neighbor downsampling to the 24 × 36 grid.        | 3       |
| Thin-feature fraction   | master          | Share of field and channel pixels removed by a morphological opening at the 1%-of-width minimum feature.                                  | 3       |
| Edge raggedness         | master          | Boundary length relative to the boundary after a small morphological open/close; near zero for smooth contours.                           | 4       |
| Accent contact          | master          | Accent boundary pixels 4-adjacent to primary-ink pixels, as a share of accent boundary; the render's separated-cell count.                | 5       |
| Generation outcome      | run             | Success or failure reason, wall time, token usage.                                                                                        | —       |

No composite score. Thresholds and morphology radii are first calibrated on the
existing Gatsby v4 traces; metrics that do not track the user's feedback after a
few rounds are dropped.

### 4. Review interface

`bookgen eval serve` runs a simple local web interface with Bun's server on
`localhost`. It reads and writes only `output/evals/`, needs no build step or
external service, and is the main working surface for the loop.

- **Round grid.** Rows are ideas, columns are variants, and each cell shows its
  three images as 24 × 36 render previews. Toggles switch to native or master.
  Variant labels can be hidden and columns shuffled for blind review. Metrics and
  failure state show under each image.
- **Detail.** Full-size zoom on poster and master for edge and channel
  inspection, native-versus-master overlay, the variant's prompt text, Codex
  review notes, and metrics.
- **Local reference.** An optional reference image the user drops into an ignored
  local folder can be shown beside any result at the same scale. It is never
  committed or exposed beyond `localhost`.

Feedback controls:

- **Verdict** per image: `at target`, `close`, or `far`. The share of `at target`
  and `close` images is the headline number for each variant.
- **Tags** per image from a fixed vocabulary tied to the target qualities:
  `haze`, `stray-islands`, `ragged-edges`, `accent-touches`, `subject-unclear`,
  `detail-lost-at-grid`, `busy-field`, `off-concept`, `contains-text`, `good`.
- **Notes** per image and per variant, in free text. These are the main input for
  writing the next round.
- **Best of row:** optionally mark the preferred variant for each idea.
- **Retry** an image (a new attempt; the old one stays in its trace), and
  **rerender** or **reclean** without generating.
- **Star** an image as a possible production master for later selection.

Feedback is appended to JSON Lines with timestamps and the image hashes it judged,
so a retried image never inherits a stale verdict.

An AI judge is a later option, adopted only if its verdicts agree with the user's
stored feedback well enough to save review time.

### 5. Iteration workflow

1. The agent writes the round's variants, each from one stated hypothesis drawn
   from the previous round's tags and notes (for example "describe the field as a
   solid screen-print block to remove haze"). One variant is the control.
2. `bookgen eval generate`, then `metrics` and `render`, produce the round.
3. The user reviews it in `eval serve`.
4. `bookgen eval summary` writes a per-variant summary (verdict counts, tag
   counts, notes, preferences, metric medians, failures, cost and time) that the
   agent reads to plan the next round.
5. **Promotion:** when the user prefers a variant over the control and it adds no
   new failure tags on `the-weight-of-shirts`, port it into `src/images/prompt.ts`,
   bump `IMAGE_PROMPT_VERSION`, and record the change in a prompt log
   (`docs/design-docs/image-prompt-log.md`: hypothesis, change, round, result).
   That variant becomes the next round's control.
6. If several rounds show that prompting alone plateaus, a variant may change the
   generation method instead of only the wording (for example generating the
   silhouette, then composing the field in code). The agent proposes such a
   variant to the user before building it.

### 6. Run artifacts

Rounds are archives, unlike stage outputs, and live in ignored `output/evals/`:

```text
output/evals/
  <round-id>/
    round.yaml                    # suite version and hash, model, effort, size,
                                  # processing and metrics versions, concurrency,
                                  # bookgen version, git commit and dirty flag, status
    variants/<variant-id>/
      prompt.md                   # template; control is generated from prompt.ts
      variant.yaml                # hypothesis, prompt SHA-256, source
      cases/<case-id>/<sample>/
        attempt-<n>/              # prompt.txt, events.jsonl, native.png,
                                  # response.json, failure.json on failure
        master.png                # cleaned output of the latest successful attempt
        processing.yaml
        metrics.yaml
        render/poster-24x36/      # poster.png, preview.png, manifest.yaml
    feedback.jsonl                # verdicts, tags, notes, preferences, stars
    summary.md
    summary.json
  reference/                      # optional local reference images; never committed
```

Round IDs are dated labels such as `2026-10-20-r1`. Feedback stays local; the
durable knowledge from each round goes into the committed prompt log, worded
without naming the external reference.

### 7. CLI shape

A `bookgen eval` group whose subcommands are independently executable, own only
their paths, regenerate outputs at stable paths, and preserve the last valid
artifact on failure:

| Command                                                                  | Reads                          | Writes                                                         |
| ------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------- |
| `bookgen eval generate <round> [--variants] [--samples] [--concurrency]` | suite, variants, registry      | `round.yaml`, sample attempts, `master.png`, `processing.yaml` |
| `bookgen eval metrics <round>`                                           | natives, masters, suite        | sample `metrics.yaml`                                          |
| `bookgen eval render <round>`                                            | masters, `output/<book>/text/` | sample `render/poster-24x36/`                                  |
| `bookgen eval serve [--port]`                                            | all rounds                     | `feedback.jsonl`; triggers retry, rerender, and reclean        |
| `bookgen eval summary <round>`                                           | metrics, feedback              | `summary.md`, `summary.json`                                   |

- `generate` is resumable: a rerun fills missing or failed images and leaves
  completed ones alone; `--retry <variant>/<case>/<sample>` regenerates one image
  as a new attempt. Each image publishes atomically; a failure records
  `failure.json` without touching other images or rounds.
- A per-round lock covers writers, including retries from the web interface.
  Parallel workers write only to their own image directories.
- `render` reads fetched text from `output/the-great-gatsby/text/` (validated by
  hash and recorded) and fails with a `bookgen fetch` hint if it is missing. This
  needs the render core to accept an explicit master and text instead of the
  book-grouped `raw/manifest.yaml`.
- Generation reuses `src/images/candidate.ts` with an injectable prompt builder
  and never writes to `output/<book-id>/`.
- Tests use the fake generator and small PNG fixtures, as existing stages do.
  Metrics get synthetic fixtures with known values (a perfect rectangle, a
  ragged edge, a hazy hole, a touching accent).

### 8. 24 × 36 as the primary target

Evals generate at 2:3, render only `poster-24x36`, compute grid survival on its
working grid, and show everything at its proportions. `bookgen render` keeps
rendering all registered targets by default, because production still needs both
sizes; evals simply never spend time on 18 × 24.

## Steps

1. Suite fixtures for the three Gatsby ideas, with a check that every case loads.
2. Metrics module with synthetic-fixture tests; check it on the Gatsby v4 traces
   (it should rank `the-weight-of-shirts` cleanest and
   `the-machine-of-carelessness` haziest).
3. `eval generate` with prompt templates, parallel workers, per-image
   publication, resume, and retry.
4. Render-core refactor for explicit inputs; `eval render` at 24 × 36 with
   previews.
5. `eval serve`: round grid, detail, verdicts, tags, notes, retry, and rerender.
6. `eval summary`.
7. Round 1: the v4 control plus two variants aimed at the largest known defects
   (haze and accent contact). User review, then iterate.
8. Update README, ARCHITECTURE, and the CLI contract with each implemented
   command; move this plan to `completed/` with results.

## Validation

- `bun run check` after each implementation step.
- Metrics: synthetic fixtures with exact expected values, and the Gatsby v4
  ranking above.
- Eval commands: fake-generator tests for concurrency, resume, retry, failure
  preservation, locking, and stable paths.
- Round 1 end to end: 27 images generated, rendered, reviewable, and summarized,
  with recorded time and usage.

## Decisions

Made with the user on 2026-10-18:

- Suite: The Great Gatsby only, its three existing ideas.
- Rounds stay slim: about 3 ideas × 3 variants × 3 images, with user feedback on
  each round before the next.
- Uncommitted prompt variants may be tested; they are recorded by text and hash.
- Generation runs in parallel.
- Nothing about the external reference is committed.

Decided by the agent, as delegated by the user:

- Target qualities: the six-item list above, refined by feedback.
- No automatic replacement attempt in evals; retries are explicit.
- Feedback stays in ignored `output/evals/`; conclusions go to the committed
  prompt log.
- Promotion: the user prefers the variant over the control and it adds no new
  failure tags on the control case.
- `bookgen render` keeps all targets by default; evals use 24 × 36 only.
- Changing the generation method beyond prompt wording is in scope once prompting
  plateaus, proposed to the user before it is built.

## Progress

- [x] Plan drafted and revised with the user's decisions (2026-10-18).
- [x] Step 1: `evals/image-prompt/` freezes the three Gatsby ideas (copied from
      the ideas v6 run); `src/evals/suite.ts` loads and validates them and hashes
      the suite.
- [x] Step 2: `src/evals/metrics.ts` (metrics version 1) and `src/evals/masks.ts`,
      with synthetic-fixture specs in `tests/evals.test.ts`.
      `src/evals/grid.ts` computes the 24 × 36 character grid exactly as render
      does. `bun scripts/eval-trace-metrics.ts <book-id> [--output <dir>]` scores a
      book's published masters against their traced natives.
- [ ] Steps 3–6.
- [ ] Round 1 and iteration.

## Discoveries

Gatsby v4 traces scored with metrics version 1 (24 × 36 grid 405 × 364 cells):

| Metric                  | weight-of-shirts | distance-of-desire | machine-of-carelessness |
| ----------------------- | ---------------- | ------------------ | ----------------------- |
| Native haze fraction    | 0.014            | 0.303              | 0.428                   |
| Cleanup change fraction | 0                | 0.188              | 0.032                   |
| Off-palette fraction    | 0                | 0.059              | 0.054                   |
| Field rectangularity    | 1.000            | 0.857              | 1.000                   |
| Opaque components       | 3                | 4                  | 3                       |
| Cutouts (largest share) | 1 (1.00)         | 2 (0.97)           | 5 (0.42)                |
| Grid cutout survival    | 1                | 1                  | 1                       |
| Edge raggedness         | 0.040            | 0.039              | 0.007                   |
| Accent contact          | —                | 1.000              | —                       |

- The ranking matches the known results: shirts is cleanest; machine has the
  haziest native image and a fragmented subject; desire's green light touches the
  primary field along its whole outline, and cleanup rebuilt 19% of its area.
- Native haze separates the images far more than any cleaned-master metric, which
  confirms that metrics must read the native PNG.
- Edge raggedness does not yet match perception: shirts scores rougher than
  machine, probably because narrow designed folds count as protrusions at a
  3 px smoothing radius. Calibrate it against the user's tags in round 1 before
  relying on it.
- Thin-feature fractions are all below 1%, and every significant cutout survives
  the 24 × 36 grid, so these metrics may matter only for more detailed variants.
- Shirts has three opaque components although it looks like one field; inspect
  what the two extra islands are when building the review interface.

## Next action

Step 3: `bookgen eval generate` with prompt templates, parallel workers,
per-image publication, resume, and retry, reusing `src/images/candidate.ts`.
