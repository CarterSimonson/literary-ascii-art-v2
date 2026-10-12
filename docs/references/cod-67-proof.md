# COD-67 proof — October 11, 2026

Implemented the TypeScript Codex SDK/Bun workflow and separate Go artifact CLI.
All artwork remains unpromoted drafts; the implementation is ready for review.

## Reproduce

```sh
bun install --frozen-lockfile
bun run build:go
bun run art replay --proof assets/proofs/odyssey/proof.json --out .artifacts/replay
```

Replay needs no Codex login or model/image generation. The command verifies each
raw master, prepared master, font/text identities, and final poster pixel hashes.
Use a new output directory on every replay. Retained inputs are under
`assets/proofs/odyssey/`, with the font/license under `assets/fonts/`.

## Live workflow evidence

Commands used under the existing ChatGPT subscription:

```sh
bun run art add-book "The Odyssey" --author Homer --gutenberg-id 1727
bun run art resume --run .artifacts/books/the-odyssey-f0fbb910cd33
bun run art add-book Dracula --author "Bram Stoker" --gutenberg-id 345 --ideate-only
bun run art resume --run .artifacts/books/dracula-e0b304c69f94 --ideate-only
```

Bun 1.3.14, Codex SDK/CLI 0.162.1, Go 1.26.9, x/image v0.47.0.
The source adapter fetched real Gutendex records and Gutenberg text. Odyssey body
boundaries start at “Tell me, O Muse” and end with Minerva's covenant of peace,
excluding prefaces, contents, notices, and footnotes. The normalized body contains
609,658 characters. Three research sections covered all 1,073 story paragraphs.

The SDK generated three concepts from source evidence and one native transparent
PNG per concept, without a paid API key or manually invented composition. Native
PNG artifact paths came through schema-constrained final responses; the SDK's
TypeScript event union does not expose a typed image item. PNG signatures/aspect
and canonical generated-image paths are checked before retention.

| Draft | Characters used | Words used | Poster bytes | Original render time |
| --- | ---: | ---: | ---: | ---: |
| The Hidden Passenger | 50,028 | 9,607 | 2,011,199 | 717 ms |
| The Bed That Cannot Leave | 41,189 | 7,944 | 1,887,253 | 704 ms |
| The Horse Inside the Mantle | 73,088 | 13,931 | 2,872,201 | 2493 ms |

All posters are 3600 × 5400 with 225-pixel margins and 420 character columns.
Mappings are exact prefixes of the normalized body: no skipped assigned text,
restarts, or repetition. The prepared masters preserve true transparency and use
only the recipe palette, with binary alpha. Their raw generations remain intact.

Dracula used the same source/research/ideation path, with four sections covering
its whole story, and produced these concepts without book-specific code:
- The Descending Host
- The Faithful Helm
- The Held and Enclosed

Its concepts/research/source identity are retained under `assets/proofs/dracula/`.
No Dracula images were generated in this smoke check.

## Verification

- TypeScript checking and formatting pass.
- Fifteen offline TypeScript tests pass, covering cache reuse, partial failures,
  image budgets, credential exclusion, literal subprocess arguments, source
  evidence, aliases, changed inputs, and retained earlier batches.
- Five Go tests pass, covering transparent skipping, Unicode/order/RGB, exhausted
  text, deterministic rendering, alpha/palette cleanup, opaque/invalid inputs,
  and missing font glyphs. `go vet ./...` passes.
- A fresh staged checkout under `/private/tmp/literary-cod67-fresh` installed from
  the frozen lockfile, built the Go CLI, and replayed every retained Odyssey draft.
  All three byte hashes and decoded pixel hashes matched the original posters.
- Cached live-workflow rerun completed with no new agent/image calls.
- Inspected prepared masters, all three poster previews, the browser contact sheet,
  and native-size glyph rendering. Primary silhouettes and secondary motifs remain
  visible. The local contact sheet was opened for user review.
- `git diff --check` and staged diff checks pass. Raw Gutenberg source bytes retain
  their original CRLF/whitespace through path-specific Git attributes.

## Limits and useful discoveries

Native generation did not reliably obey the requested flat opaque alpha: raw
images contained substantial edge haze and semitransparency. The explicit Go
threshold/palette stage produced usable flat masters while keeping originals.
The bed's fine root tips weaken after character conversion, and its optional
crimson accent was not present in the generated mask. These are review/refinement
concerns; no candidate has been promoted or described as final approved art.

Model quotations were textually correct but one Dracula quote had the wrong
paragraph ID. A deterministic exact-quote resolver now corrects only unique
matches within the supplied source section and records corrections separately,
keeping the raw response intact. Invented/ambiguous quotations still fail. An
undocumented minimum quote length also incorrectly rejected short exact quotes;
that validation bug was removed and regression-tested. Cached responses resumed
without repeating those research calls.

Research currently favors completeness over speed: each large section can return
many motifs, and the real runs took minutes per section. Model turns have timeouts
and the workflow bounds sections/image attempts. Measure/tune concise research
outputs as the catalog grows. Image attempts are limited at the SDK-turn boundary;
the native tool's internal work is not exposed as typed SDK image events.

For an interrupted generation with unknown outcome, inspect its saved attempt,
thread events, and native artifact before explicitly retrying. A completed image
is not silently regenerated. There is no API-key/provider fallback or credit
purchase. Human review, refinement, merge, and later COD-68/Printful work remain.
