# Fetch readability

Apply the newly added coding conventions to the fetch implementation, validation
script, and tests from this change. Preserve the user's AGENTS.md edits and all
existing artifact formats, prompts, failure behavior, and parser rules.

- Separate download, cleanup inspection, artifact assembly, and publication.
- Name intermediate values and give result/state collections specific types.
- Use braces and clear logical spacing; prefer explicit branches and early exits.
- Document the reasons for source-coordinate conversion and backup recovery.
- Enforce braces on this change's code through lint.
- Verify with the existing suite, cached ten-book corpus, and saved cleanup replay.

No new provider calls or agent generation are needed for this refactor.

## Outcome

Completed the refactor. `runFetch` now coordinates the named phases; artifact
assembly and publication/recovery have their own focused modules. Agent event
collection retains failure provenance through explicitly typed progress. Parser
indices, retained text, streamed byte counts, and validation results have clearer
names. The validation script follows the supplied example with typed success and
failure results, phase spacing, and explicit source-loading branches.

Added scoped brace enforcement to ESLint for fetch code, its CLI/registry entry
points, scripts, and fetch tests. Added only explanatory comments for recovery,
stream limits, and line-coordinate constraints. Formatted the user's AGENTS.md
addition without changing its conventions or removing its example.

Verification: `bun run check` passed all 95 tests (321 assertions), TypeScript,
lint, and formatting. The ten cached full books passed again. Replaying the saved
Dracula response through the refactored run produced byte-identical source and
clean text and an identical parsed manifest except for run timestamps, including
an unchanged prompt hash. `git diff --check` passed. No live agent calls were made.
