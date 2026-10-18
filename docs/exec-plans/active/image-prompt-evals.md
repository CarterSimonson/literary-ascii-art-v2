# Image-prompt evals

## Goal

Make the generated source images much better, by comparing prompt variants
side by side instead of changing the prompt once and eyeballing one image.

## Loop

1. Write about 3 prompt variants. One is always the current default prompt, as
   the control.
2. Each variant generates 3 images for each of the 3 Gatsby ideas (27 images,
   in parallel; roughly 10–15 minutes).
3. Render every image as a 24 × 36 poster.
4. The user reviews them on a local web page: tags, notes, retry.
5. Write the next variants from that feedback and rerun. When a variant clearly
   beats the control, port it into `src/images/prompt.ts` and bump
   `IMAGE_PROMPT_VERSION`.

## Decisions

- Suite: the three Great Gatsby ideas, frozen in `evals/image-prompt/`.
- Variants can be uncommitted prompt files; record each one's text and hash
  with its images.
- Generation runs in parallel and is not retried automatically. Retries are
  explicit.
- Only `poster-24x36` is rendered.
- The user's feedback is the judge. Two scores show beside each image as hints:
  native haze and accent contact.
- Round outputs and feedback stay in ignored `output/evals/<round-id>/`.
- Nothing about the external reference posters is committed.

## Steps

- [x] Frozen suite and loader (`src/evals/suite.ts`).
- [x] Two scores (`src/evals/metrics.ts`).
- [ ] `bookgen eval generate <round>`: run every variant × idea × sample in
      parallel, reusing `src/images/candidate.ts` with an injected prompt. Each
      image lands in its own folder; reruns fill in missing images and retry one
      image on request.
- [ ] Render each image at 24 × 36. This needs render to accept an explicit
      master and text path.
- [ ] `bookgen eval serve`: a local page with ideas as rows and variants as
      columns. It shows each image's poster, master, and native image, with
      tags, notes, and retry, and saves feedback to `feedback.jsonl`.
- [ ] Round 1.

## Findings

On the v4 Gatsby images, native haze was 0.01 for `the-weight-of-shirts`, 0.30
for `the-distance-of-desire`, and 0.43 for `the-machine-of-carelessness`. The
green light in `the-distance-of-desire` touches the field along its whole
outline (accent contact 1.0). Both scores match what review found. Scores on the
cleaned master did not separate the images as well, so haze must be read from
the native PNG.
