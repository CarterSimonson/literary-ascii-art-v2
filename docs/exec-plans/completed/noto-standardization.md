# Standardize on Noto Sans Mono Black

The user selected Noto from the typography proofs. Adopt the actual Black 900
face with the proof's tighter horizontal spacing: 0.60 em rounded up, giving
17×28 px cells at 6.5 pt and 300 PPI for Dracula. Preserve current placement;
the exterior-padding trim was a separate diagnostic experiment.

## Progress

- Replaced the pinned font dependency, updated font metadata, cell width, render
  provenance version, current documentation, and layout expectations.
- Added verification that representative glyphs fit the tighter cells and that
  the selected face preserves the proof's increased ink coverage.
- Repository checks pass: 130 tests, TypeScript, lint, and formatting.
- Rerendered all ten current examples at both targets (twenty posters), verified
  every input snapshot and output hash, dimensions, 300 PPI, font hash/name,
  render version 3, and 17×28 px cells at 6.5 pt.
- The standard 24×36 `before-the-last-light` output matches the selected
  `e-noto-tight` diagnostic proof byte-for-byte. All masters remain unchanged.
- Refreshed and inspected rendered contact sheets; evidence is in
  `output/dracula/reviews/render-verification.json`, `noto-verification.json`,
  and `rendered-poster-<size>-contact-sheet.png`.

## Outcome

Noto Sans Mono Latin Black 900 from Fontsource 5.3.0 is the default bundled font,
with the selected tighter horizontal spacing. The previous Roboto dependency was
removed. Existing placement remains; cropping exterior transparency is a separate
layout choice. No physical print proof or production artwork approval is implied.
