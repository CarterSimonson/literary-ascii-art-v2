# The Odyssey pipeline run

## Outcome and scope

Run the implemented pipeline for The Odyssey: ten ideas, ten cleaned source
masters, fetched English text, and character-art posters at both registered sizes.
Outputs remain candidates for review; product preparation and store publication
are not implemented.

## Inputs and decisions

- Book ID: `odyssey`; Homer, The Odyssey.
- Edition: Project Gutenberg 1727, Samuel Butler's English prose translation,
  verified at https://www.gutenberg.org/ebooks/1727.
- Ideas and image agents: `gpt-6.1-sol`, high reasoning effort.
- Follow the CLI's established ten-idea workflow and generate every idea.
- Render all ten candidates at 18 × 24 and 24 × 36 inches for comparison.

## Steps and validation

1. Register the book and run ideas and fetch independently.
2. Inspect ideas, then run images with native generation and deterministic cleanup.
3. Inspect source candidates and render each explicit idea at both target sizes.
4. Verify manifests, output counts, dimensions, text provenance, and visual previews.
5. Record results, limitations, and useful output paths; move this plan to completed.

## Progress

- Registered the verified Gutenberg edition.
- Generated all ten concepts successfully with the pinned model and effort.
- Native images are running sequentially; first two masters passed cleanup.
- Initial fetch identified all 24 books but blocked on an absent appendix and
  placeholder Greek quotations in ancillary commentary. The user explicitly
  accepted those edition limitations.
- Added `fetch --edition-context` so accepted ancillary limitations are evaluated
  by the agent and captured in provenance, without bypassing identity, narrative
  completeness, or removal-boundary checks. Bumped cleanup version to 2.
- Preserved the initial fetch trace under `output/odyssey/review/` and restarted
  fetch with the user's context. `bun run check`: 130 passing tests.
- All ten native masters generated on their first execution attempt and passed
  deterministic cleanup. Images remain visually unapproved.
- Fetch completed successfully after translation-aware review; all 24 books and
  187 endnotes retained. The accepted edition limitations are in the text manifest.
- All 20 posters completed and passed independent dimension, density, output-hash,
  input-hash, and source-master-hash checks.
- Inspected source and character-art contact sheets, a larger ram preview, and a
  full-resolution character crop. Execution is complete; artistic approval is not.

## Findings during execution

- Source transparency artifacts recur across the native PNGs. Soft alpha patches
  inside intended solid fields become hard holes at the existing 128 threshold.
  For example, the bed master has 86,344 partial-alpha pixels below 128; the bow
  master has 93,562. These exist before palette mapping and are not render defects.
- Current checks enforce binary alpha and palette validity, not semantic placement
  of transparency. The bow candidate also places its arrow below the axeheads.
  Record these as visual failures; do not treat successful conversion as approval.
- A second fetch review treated Butler's documented omission of one corrupt Greek
  line as an incomplete download. Clarified that completeness concerns the selected
  published translation, retaining strict checks for missing chapters, unexplained
  narrative gaps, and abridgments. Prior trace preserved in the review directory.
- Added a regression proving edition context is recorded and cannot bypass
  unresolved cleanup uncertainty. Full checks: 131 tests passed.

## Results and handoff

- Outputs: `output/odyssey/ideas.yaml`, `raw/manifest.yaml` and ten cleaned masters,
  `text/book.txt` and `text/manifest.yaml`, and twenty print PNG/manifest pairs.
- All images were generated with `gpt-6.1-sol`, high reasoning effort, on attempt 1.
- Native masters: 1024 × 1536; cleaned masters: 1066 × 1578 including padding.
- Print targets: 5400 × 7200 and 7200 × 10800, both 300 PPI and 6.5-point text.
- Each poster uses 40,139–123,526 leading text characters from 674,557 normalized
  characters. These are partial-book posters, as specified by the font/grid contract.
- Greek characters in later commentary are unsupported by the bundled Latin font,
  but none occur in the text prefixes actually used by these twenty posters.
- Independent audit: `output/odyssey/review/verification.json`; rerun with
  `bun output/odyssey/review/build.ts` after the complete pipeline is available.
- Review sheets: `output/odyssey/review/source-contact-sheet.png` and
  `output/odyssey/review/poster-contact-sheet.png`.
- Full-size crop: `output/odyssey/review/character-detail.png`; larger preview:
  `output/odyssey/review/beneath-the-ram-preview.png`.
- Recommended for further review: Beneath the Ram, Bound to Listen, and The Embrace
  That Fails. The ram silhouette survives character conversion especially clearly.
- Reject for production pending correction: Passage Between Hungers (stray sky
  opening), The Unmoving Bed (large stray wall opening), The Bow's Answer (stray
  opening and arrow/axe misalignment), Hours on the Loom (stray wall/floor openings),
  and Recognition by Touch (large stray wall opening).
- All outputs retain unapproved status. No listing, dropshipping, store publication,
  or physical print proof was performed; those production stages remain unimplemented.

## Reproduction

Run `bun run bookgen ideas odyssey --timeout 900`, then
`bun run bookgen images odyssey --timeout 900`. Fetch uses
`bun run bookgen fetch odyssey --timeout 900 --edition-context '<accepted edition context>'`;
copy the exact context from `text/manifest.yaml` to reproduce this review. For each
ID in `ideas.yaml`, run `bun run bookgen render odyssey --idea <idea-id>` to produce
both registered targets. These commands replace their stage-owned artifacts.

## Remaining quality gap

The source generator does not reliably obey flat-opacity requirements. The binary
alpha validator cannot distinguish a designed opening from an accidental interior
fade. A future improvement should evaluate cleaned candidates against their
compositions and support targeted correction/replacement with traceable provenance.
Blind hole filling or lowering the alpha cutoff would also affect deliberate
negative-space subjects. Do not present that as a general fix.
