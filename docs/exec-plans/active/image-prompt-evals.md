# Image-prompt evals

## Goal

Make the generated source images much better. An agent writes prompt variants,
the user rates the results, and the agent revises the prompts from that feedback
until the ratings converge on something good.

## Loop

1. The agent writes about 3 prompt templates for a round, with a hypothesis for
   each in `notes.md`. One is always the current best prompt, as the control.
2. `bookgen eval run <round> --prompts <dir>` generates one image per prompt ×
   suite idea (27 images, 3 at a time), cleans it, renders a 24 × 36 preview,
   and scores it.
3. `bookgen eval serve` opens the rating page. The user gives each image 1–5
   stars, good/bad tags, and a note.
4. The agent reads the round's feedback and images, writes the next round, and
   runs it. Repeat.
5. When a prompt clearly wins, check it on fresh ideas, then copy it into
   `IMAGE_PROMPT_TEMPLATE` in `src/images/prompt.ts` and bump
   `IMAGE_PROMPT_VERSION`.

## Decisions

- Suite: three ideas each from The Great Gatsby, The Odyssey, and The War of the
  Worlds, frozen in `evals/image-prompt/`. Ideas stay fixed during tuning; swap
  one only when the user flags it as weak, and bump `suite_version`.
- One image per prompt × idea. Judge a prompt by its average over all nine ideas.
- Prompt templates are uncommitted files using `{{title}}`, `{{author}}`,
  `{{size}}`, `{{name}}`, `{{composition}}`, `{{literary_basis}}`,
  `{{conversion_resilience}}`, and `{{palette}}`. Unknown placeholders fail
  before generation. Each round records every template's text and hash.
- Generation runs in parallel and is not retried automatically. Rerunning
  `eval run <round>` retries failed images; `--retry <prompt>/<book>/<idea>`
  regenerates a finished one as a new attempt.
- Only `poster-24x36` is rendered, as a one-third-scale preview.
- The user's ratings are the judge. Native haze and accent contact show beside
  each image as hints.
- Prompt labels are shown as letters on the rating page to keep review blind.
- Nothing about the external reference posters is committed.

## Where everything is recorded

Rounds live under the main checkout's ignored `output/evals/rounds/<round-id>/`:

```text
round.yaml                 suite hash, prompt IDs and hashes, cases, settings
prompts/*.prompt.md        exact templates; prompts/notes.md holds hypotheses
images/<prompt>/<book>/<idea>/
  result.yaml              latest status, files, scores, cleanup stats, usage,
                           Codex review notes, error on failure
  attempt-<n>/             prompt.txt, events.jsonl, response.json,
                           generated.png (native), master.png, preview.png
feedback.jsonl             append-only ratings: stars, tags, note, time, and
                           the attempt and master hash they judged
```

The latest feedback record per image is the current rating; earlier records
stay as history. Future agents should read `round.yaml`, `prompts/`, every
`result.yaml`, and `feedback.jsonl` before writing the next round.

## Steps

- [x] Frozen nine-idea suite and loader (`src/evals/suite.ts`).
- [x] Two scores (`src/evals/metrics.ts`).
- [x] Image prompt as a fillable template (`src/images/prompt.ts`; v4 output
      unchanged).
- [x] `bookgen eval run` (`src/evals/round.ts`, `src/evals/render.ts`).
- [x] `bookgen eval serve` and the rating page (`src/evals/serve.ts`,
      `src/evals/portal.html`, `src/evals/feedback.ts`).
- [ ] Round 1: control, flat-print, and stencil (in progress).
- [ ] An in-app agent that writes the next round from feedback, so the loop runs
      without a coding session.

## Findings

- On the v4 Gatsby images, native haze was 0.01 for `the-weight-of-shirts`, 0.30
  for `the-distance-of-desire`, and 0.43 for `the-machine-of-carelessness`. The
  green light in `the-distance-of-desire` touches the field along its whole
  outline (accent contact 1.0). Both scores match what review found.
- All six new Odyssey and War of the Worlds ideas use a single ink, so
  `the-distance-of-desire` is the only accent case.
- The War of the Worlds fetch needed `--edition-context` for a stray `/` line
  after the Gutenberg start marker.
