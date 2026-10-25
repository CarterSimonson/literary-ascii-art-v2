# Image-prompt evals

## Goal

Make the generated source images much better. An agent writes prompt variants,
the user rates the results, and the agent revises the prompts from that feedback
until the ratings converge on something good. The same loop also tunes the
ideas prompt.

## Loop

Run `bookgen eval serve` and work entirely on the page:

1. Rate each card: 1–5 stars, any of five problem tags (haze, ragged, busy,
   unclear, off-idea), and a short note. Each card shows the source image beside
   the poster. Click a card, then press 1–5; arrow keys move between cards.
2. Click **Next round…**, choose **Improve the image prompt** or **Improve the
   ideas prompt**, pick how many new prompts to try, optionally type a
   direction, and start it.
3. The prompt agent (`src/evals/improve.ts`, Codex) reads every round's prompts,
   notes, results, and ratings, plus thumbnails of the latest posters, and
   writes new templates with a hypothesis each. The best-rated template of that
   kind so far (pooled by template text, at least three ratings when available)
   carries forward unchanged as the control. Before any idea rounds, the
   control ideas prompt is the committed one.
4. The page generates the round in the background and switches to it.
5. **↻ Regenerate** on a card makes a new image for it; **Replace idea** on a
   row swaps a weak suite idea for a new one from the same book, from the next
   round on (`src/evals/ideas.ts`). Both run in parallel with each other and
   with other regenerations; the task strip shows each one's progress or error.
   A new round waits while ideas are being replaced.
6. When a prompt clearly wins, check it on fresh ideas, then copy it into
   `IMAGE_PROMPT_TEMPLATE` (`src/images/prompt.ts`) or `IDEAS_PROMPT_TEMPLATE`
   (`src/ideas/prompt.ts`) and bump its version.

`bookgen eval run <round> --prompts <dir>` still runs a round from hand-written
templates.

## Round kinds

- **Image rounds** vary the image prompt over the suite's nine fixed ideas.
  Templates are `*.prompt.md`.
- **Idea rounds** vary the ideas prompt. Templates are `*.ideas.md`; each writes
  three ideas per suite book, and every idea is drawn with one fixed image
  prompt (the best so far, a single `*.prompt.md`). Rows are book × idea
  number; each card shows its own idea.

## AI judge

Rating every image is slow, so an AI judge (`src/evals/judge.ts`) predicts the
user's rating. It sees one idea row at a time, in a shuffled order without
prompt labels: each poster (1200 px) and its raw generated image, the rubric in
`evals/judge/rubric.md` (distilled from the user's notes), and up to ten
examples the user rated, spread across the star scale. When checking a round,
examples come only from other rounds. It ranks each row best to worst with no
ties, then gives stars; a round's winner is the prompt with the best mean rank.

`bookgen eval judge-check` judges every rated round and writes
`output/evals/judge/check-<time>/` with `report.md`, `summary.json`,
`comparisons.jsonl`, and each row's brief, images, and response. It reports
exact and within-one-star agreement, correlation, whether the judge orders
images within a row as the user did, and whether it picks the same winning
prompt per round.

The judge now runs in the loop:

- Rounds started from the page are judged once their images exist, and a
  regenerated image's row is judged again. `bookgen eval judge <round>` or
  **Judge round** on the page judges any round's unjudged rows. Judgments are
  appended to the round's `judge.jsonl` (rank, stars, tags, note, confidence,
  and the attempt and master hash judged), with each row's brief and response
  under `judge/`.
- The page shows each card's judge rank, stars, and note, and each prompt's
  mean judge rank. **Judge's top picks only** shows just each row's #1, for the
  user to spot-check and rate; those ratings become examples for later judging.
- The prompt agent's winner for a round is the prompt with the best mean judge
  rank (the user's mean stars for rounds without judgments). Since every round
  carries the best prompt so far as its control, the latest round's winner is
  carried forward. Its brief shows judge ranks and notes beside any user
  ratings, and user ratings outweigh the judge where they disagree.

## Decisions

- Suite: three ideas each from The Great Gatsby, The Odyssey, and The War of the
  Worlds, in `evals/image-prompt/`. Ideas stay fixed during image tuning; swap
  one only when the user flags it as weak. Replacement moves the old case to
  `retired/<book>/` with the reason and bumps `suite_version`. These files are
  written by the page, so Prettier ignores them; commit them like code.
- One image per prompt × idea. Judge a prompt by its average over all ideas.
- Image templates must keep {{title}}, {{author}}, {{name}}, {{composition}},
  {{literary_basis}}, and {{palette}}, and the operational phrases
  `transparent_background=true`, `master.png`, `artwork_colors`, and
  `review_notes`. Ideas templates must keep {{book}} and {{count}}. Unknown
  placeholders fail before generation. Each round records every template's text
  and hash.
- Each round keeps its own copy of its ideas (`cases.yaml` or `ideas/`), so
  regenerating in an old round still works after the suite changes. Rounds from
  before snapshots recover their ideas from the suite or `retired/`.
- Generation runs in parallel and is not retried automatically. Each image has
  its own lock, so different images can regenerate at once.
- Only `poster-24x36` is rendered, as a one-third-scale preview. The page loads
  cached thumbnails and the full image on click.
- The user's ratings are the judge. Native haze and accent contact show beside
  each image as hints. Tags are a short list of common problems; stars carry
  quality and notes carry everything else.
- Prompt labels are shown as letters on the rating page to keep review blind.
- Nothing about the external reference posters is committed.

## Where everything is recorded

Rounds live under the main checkout's ignored `output/evals/rounds/<round-id>/`:

```text
round.yaml                 kind, suite hash, prompt IDs and hashes, settings
cases.yaml                 image rounds: the exact ideas used
ideas/<prompt>/<book>.yaml idea rounds: ideas each ideas template wrote
prompts/                   exact templates; prompts/notes.md holds hypotheses
images/<prompt>/<book>/<idea>/
  result.yaml              latest status, files, scores, cleanup stats, usage,
                           Codex review notes, error on failure
  attempt-<n>/             prompt.txt, events.jsonl, response.json,
                           generated.png (native), master.png, preview.png
feedback.jsonl             append-only ratings: stars, tags, note, time, and
                           the attempt and master hash they judged
judge.jsonl                append-only AI judgments: rank within the row,
                           stars, tags, note, confidence, attempt, master hash
judge/<row>/               the judge's latest brief, images, and response
agent/                     for rounds the page wrote: request.md (the brief),
                           thumbnails/, events.jsonl, response.json, prompts/
```

The latest feedback record per image is the current rating; earlier records
stay as history. Future agents should read `round.yaml`, `prompts/`, every
`result.yaml`, and `feedback.jsonl` before writing the next round.

## Steps

- [x] Frozen nine-idea suite and loader (`src/evals/suite.ts`).
- [x] Two scores (`src/evals/metrics.ts`).
- [x] Image and ideas prompts as fillable templates (output unchanged).
- [x] `bookgen eval run` (`src/evals/round.ts`, `src/evals/render.ts`).
- [x] `bookgen eval serve` and the rating page (`src/evals/serve.ts`,
      `src/evals/portal.html`, `src/evals/feedback.ts`).
- [x] Prompt agent and next rounds from the page (`src/evals/improve.ts`).
- [x] Parallel tasks: regenerate, replace idea, retry (`src/evals/tasks.ts`).
- [x] Idea rounds.
- [x] Round 1 (control, flat-print, stencil) and round 2 (flat-print carried
      forward, chromatic-relief, story-relief), both run and partly rated.
- [x] First idea round from the page (round 3); defining-scene won and is now
      ideas prompt v7.
- [x] AI judge and agreement check.
- [x] Judge v3 with a repeatable stability check (`judge-check --repeat`).
- [x] Judge each new round automatically and show its ranking on the page;
      the user spot-checks top picks; the prompt agent follows judge ranks.

## Findings

- On the v4 Gatsby images, native haze was 0.01 for `the-weight-of-shirts`, 0.30
  for `the-distance-of-desire`, and 0.43 for `the-machine-of-carelessness`. The
  green light in `the-distance-of-desire` touches the field along its whole
  outline (accent contact 1.0). Both scores match what review found.
- Round 1: the stencil wording gave clean native images (haze under 0.05) on 6
  of 9 ideas, against 4 of 9 for the control and flat-print. Haze depended more
  on the subject than the wording: `the-rooted-bed` was hazy under all three.
- The user replaced five suite ideas after round 1, with reasons recorded in
  `retired/`; most asked for more interesting, dynamic subjects.
- Judge v1 check on rounds 1–3 (54 rated images): 28% exact, 83% within one
  star, mean error 0.94, correlation 0.57, same order within a row for 71% of
  33 pairs. It picked the user's winning prompt in rounds 2 and 3 (clear wins)
  and missed round 1, where the user's means were within 0.6 stars. It rates
  about 0.4 stars high, overrates clean but plain or generic images, misses
  some "unclear" and "doesn't say this book" judgments, and once punished
  blotches harder than the user did. Good enough to rank prompts when the gap
  is clear; not yet a substitute for spot checks.
- Judge v2 ranks each row (no ties) before rating, sees the poster at 1200 px
  and the raw generated image at 800 px (transparency on gray), and treats the
  user's examples as illustrations rather than answers. Same order within a row
  73% (v1 71%); within one star 74% (v1 83%), correlation 0.42 (v1 0.57). It
  matched the round 3 winner, the only round with a clear human gap; rounds 1
  and 2 differ by 0.2 mean rank, which is noise for both judge and user. Seeing
  the raw image made it stricter about haze and cutouts that cleanup removes
  (14 of 54 notes), which penalized posters the user rated 5, and it marked
  down posters that departed from the idea text, which the user does not.
- Judge v3 judges only the poster (raw-image haze counts only if it shows in
  the poster) and gives the idea text as context, not a target. Two runs on
  rounds 1–3: 86% of image pairs kept the same order and 68% of 19 rows were
  ranked identically; each round's winner was the same in both runs. Agreement
  with the user's order within rows was 70% and 79% across the two runs, so
  single-run agreement moves about ±5 points and v1–v3 are not distinguishable
  on it. Notes citing haze or gaps fell from 14 (v2) to 5–7, and none cited the
  intended scene. Winners matched the user in rounds 2 and 3; in round 1 the
  judge consistently prefers stencil, where the user's means were within 0.6
  stars. Stable enough to steer rounds, with the user spot-checking.
- The War of the Worlds fetch needed `--edition-context` for a stray `/` line
  after the Gutenberg start marker.
