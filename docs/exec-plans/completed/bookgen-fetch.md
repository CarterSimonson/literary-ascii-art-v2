# Bookgen fetch

Implement `bookgen fetch <book-id>` using a required positive `gutenberg_id`
in the registry. English only; the ID pins the edition, with no automatic source
substitution. Preserve the downloaded original alongside clean text and a
versioned manifest for future character conversion.

## Decisions

- Download UTF-8 text directly from Gutenberg's generated text path; no catalog
  scraping or automated search. Record the exact URL and downloaded hash.
- Strip explicit Gutenberg boundaries in code. A read-only Codex agent inspects
  the entire available body and dynamically identifies non-book line ranges.
  Retain author prefaces, dedications, headings, notes, and prose. Remove contents,
  transcriber notes, publisher matter, and non-text illustration placeholders.
- Agent returns ranges with verbatim boundary anchors, never rewritten prose.
  Fail on uncertainty, invalid ranges, wrong identity/language, or incomplete
  agent execution. Code owns UTF-8 validation, extraction, and publication.
- Own only `text/` and `traces/fetch/`; stage and recover directory publication
  just like images. Preserve the last complete artifact on failure.

## Work and verification

- [x] Registry, CLI, network boundary, extraction, and agent adapter.
- [x] Versioned artifact contract, trace, locking and failure recovery.
- [x] Tests for content preservation, malformed inputs, networking, agent failure,
      retries and command behavior; run the project check.
- [x] Live Dracula run and inspect retained dedication/introduction and removed TOC.

The live example is Dracula; all selection instructions and extraction rules
must work across registry books without hardcoded literary content.

## Outcome

`bun run check` passed: TypeScript, zero-warning lint, formatting, and all 80 tests
(262 assertions). `git diff --check` passed.

Implemented the command and documented the artifact contract. The registry requires
`gutenberg_id` while existing idea/image artifact schemas remain unchanged.
Live `bookgen fetch dracula` succeeded using the configured model and login:
890,348 downloaded bytes, 852,032 clean bytes, four dynamic removal ranges.
Inspected the dedication, author introduction, 27 chapter headings, and closing
note; contents, imprint, colophon placeholder, and trailing publisher ads were
removed. Replayed the manifest against the original download and verified exact
text equality and both SHA-256 hashes. No Dracula-specific cleanup logic exists.

Offline tests exercise a different book structure with poetry, author footnotes,
and a chapter called Contents. They also cover registry validation, network and
encoding failures, invalid plans, source preservation, cancellation/timeout,
locking, backup recovery, stage isolation, CLI settings, and help. One initial
assertion assumed directory listing order; fixed it to compare sorted names.

Limitations: supported sources must have explicit Gutenberg markers, ebook ID,
and English metadata. Agent judgments about editorial material/completeness are
recorded but cannot be proven by boundary checks; text remains unapproved for
review. Large/complex books may need a longer timeout. Bulk downloading is outside
this single-book command. Future conversion owns whitespace/glyph traversal.

## Ten-book parser validation

A follow-up live corpus run passed all ten full UTF-8 downloads without changing
the parser. The corpus includes novels, short stories, a play, poetry, translated
fiction, and annotated nonfiction. Each run exercises the production downloader
and parser, verifies source-coordinate reconstruction, and checks that no-removal
cleanup preserves every body line apart from documented outer newline handling.
It does not claim to validate the agent's editorial decisions on these books.

| Gutenberg ID | Book                              | Source bytes | Body lines | Result |
| ------------ | --------------------------------- | -----------: | ---------: | ------ |
| 345          | Dracula                           |      890,348 |     15,475 | Pass   |
| 11           | Alice's Adventures in Wonderland  |      174,311 |      3,384 | Pass   |
| 1342         | Pride and Prejudice               |      772,386 |     14,537 | Pass   |
| 84           | Frankenstein                      |      448,885 |      7,362 | Pass   |
| 2701         | Moby Dick                         |    1,276,315 |     21,953 | Pass   |
| 1661         | The Adventures of Sherlock Holmes |      607,606 |     11,932 | Pass   |
| 2600         | War and Peace                     |    3,359,610 |     65,660 | Pass   |
| 1514         | A Midsummer Night's Dream         |      121,049 |      3,491 | Pass   |
| 132          | The Art of War                    |      342,105 |      6,761 | Pass   |
| 1322         | Leaves of Grass                   |      780,492 |     17,863 | Pass   |

The generated `/cache/epub/<id>/pg<id>.txt` endpoint gave consistent modern
metadata and wrapper markers across this sample, including BOM/CRLF input.
This supports keeping the strict identity/language and unique-boundary checks;
there was no observed valid format requiring a parsing relaxation. This is
evidence for the selected endpoint and sample, not all historical Gutenberg
files. Unsupported formats should still fail explicitly.

`tests/fixtures/gutenberg-headers.json` preserves actual headers, boundary markers,
newline/BOM flags, source URLs and SHA-256 hashes. Offline regression tests use
these wrappers with a synthetic body; full books remain in ignored local storage.
Additional tests cover LF/CRLF/CR, legacy THIS/mixed-case markers, and rejection of
duplicate, missing, or reversed markers.

Reproduce with `bun scripts/validate-gutenberg.ts` (ten sequential requests with
two seconds between downloads), or add `--offline` to replay the saved full books.
`--update-fixtures` refreshes the checked-in header fixtures only when all books
pass. Full downloads and the timestamped report are kept under
`.artifacts/gutenberg-validation/`, separately from production pipeline artifacts.

Validation after adding the corpus checks: `bun run check` passed all 95 tests
(321 assertions), TypeScript, lint, and formatting. Full-book offline replay also
passed 10/10. `git diff --check` passed.
