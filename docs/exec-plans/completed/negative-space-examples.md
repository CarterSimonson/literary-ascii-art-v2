# Negative-space source art and Dracula examples

## Outcome

Correct the isolated-object bias in source-art directions, regenerate Dracula's
ten ideas and image candidates, and render all ten at both existing poster sizes.
Keep candidates unapproved and preserve stage ownership.

## Decisions

- Distinguish opaque illustrated environments from the underlying paper matte.
- Describe text-bearing fields and empty forms explicitly. Include negative-space-led
  concepts without forcing every idea into the same device or a coverage quota.
- Keep transparency and the existing converter; no automatic image inversion.
- Bump prompt provenance and align the skill, CLI prompts, and documentation.
- Existing examples comprise Dracula's ten masters and one concept rendered at
  both registered targets. Regenerate ideas before images; reuse fetched text.

## Progress

- Updated prompts, skill, and affected documentation; all 129 tests, typecheck,
  lint, formatting, and skill validation passed for the first revision.
- Generated ten ideas with ideas v3. Interrupted images v2 during image 6 after
  user review: the Demeter dog cutout worked, but excessive transparent sky still
  surrounded the ship. Previous published masters were preserved.
- Strengthened ideas v4 and images v3: require a continuous illustrated environment
  across the interior art area, including space behind and around subjects.
  Transparency is intentional subject/opening/channel geometry, not unused canvas.
- User clarified that designed gaps and gutters between objects remain desirable.
  Preserve separation and breathing room; do not maximize coverage or fill every gap.
- Regenerated all ten ideas with v4 and all ten images with v3; no replacement
  attempts needed. Verified hashes, identities, dimensions, binary alpha, selected
  palette membership, and opaque pixel counts for all ten. First pass retained
  separately under `output/dracula/reviews/negative-space-first-pass/`.
- Castle and Demeter rendered and inspected at both sizes. Empty forms survive;
  fine details soften. All 129 tests, typecheck, lint, formatting, and skill
  validation pass after the final prompt wording.
- Rendered all ten designs at both targets: twenty PNGs with manifests. Verified
  hashes, all upstream input snapshots, exact canvas dimensions, 300 PPI, and 6.5 pt
  minimum type. Inspected rendered contact sheets for both sizes; saved them and
  verification reports under `output/dracula/reviews/`.
- User requested a typography and margin iteration on `before-the-last-light`.
  Roboto Mono Bold currently covers approximately 19% of a representative text
  cell, so rendered fields appear pale. Source padding plus aspect fitting makes
  visible margins much larger than the configured half-inch gutters.
- Completed diagnostic font and placement comparisons under
  `output/dracula/reviews/last-light-typography/`. Existing masters and published
  prints remain unchanged. The diagnostic baseline reproduces the published
  24×36 PNG byte-for-byte.

## Typography and margin findings

- At 6.5 pt with 18×28 px cells, measured ink coverage across the assigned text
  is 18.7% for Roboto Mono Bold 700, 17.2% for Courier Prime Bold 700, and 24.0%
  for Noto Sans Mono Black 900. Courier's serif texture does not make it heavier.
- Courier at 17×27 px reaches 18.9%; Noto at 17×28 px reaches 25.4%. Glyph height
  checks prevent clipping accents/descenders. Current Roboto has little spare
  vertical room, so aggressive line tightening is inappropriate.
- The 1066×1578 master has an opaque bounding rectangle of 966×1475 starting at
  (50, 51). Its padding combines with poster gutters and aspect fitting: current
  visible 24×36 margins are about 1.59 inches sideways and 2.12 inches vertically.
- Cropping only exterior transparency in a working copy, retaining all artwork
  and internal gaps, gives approximately 0.50–0.55 inch margins on 24×36.
  On 18×24, aspect preservation still requires 1.47-inch side margins and
  0.52-inch top/bottom margins. Equal borders there need art extension or cropping.
- Recommendation for review: Noto Black with modest horizontal tightening and
  fitting to opaque bounds. Courier is an aesthetic alternative, not a density
  fix. No renderer defaults, dependencies, or source palette changed in this
  diagnostic iteration. Fontsource 5.3.0 font archives were integrity-verified
  and retained with proofs; font hashes and layout metadata are recorded.

## Remaining visual limits

Some source candidates still have irregular unintended openings (notably the
transfusion and Renfield scenes), and the earth-box scene lacks its intended
colored sky. Rendered color fields are substantially paler than solid source
fills; even the heavier-font proof needs color evaluation at physical print size.
All outputs retain their unapproved status. Selecting a new font/default layout
and extending artwork for alternate aspect ratios are subsequent design choices.

## Completion

Updated generation guidance, regenerated all ten concepts/masters, rendered and
verified all twenty posters, and delivered controlled typography and placement
proofs in response to review feedback. Repository checks pass (129 tests,
TypeScript, lint, formatting), and the source-art skill validator passes.
