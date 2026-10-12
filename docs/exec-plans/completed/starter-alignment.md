# Align repository standards with starter

## Outcome and context

Adopt the lightweight standards from `CarterSimonson/starter` at commit
`fc2b1f7334b6f2d09b08d3fe88babf0b065d6645` while retaining the literary-art product
rules and existing source-art skill. The repository initially contained only
AGENTS.md and the skill; this task establishes its development and knowledge
baseline without implementing the application.

## Changes and decisions

- Added the starter's editor defaults and ignore rules.
- Added project-specific README, architecture, documentation map, and bootstrap
  guide; distinguish implemented behavior from planned stages.
- Added the starter's navigation and working conventions to AGENTS.md.
- Retained the source-art skill unchanged.
- Deferred runtime, CI, and pipeline tooling until the first implementation
  selects a stack and defines executable behavior.

## Validation

- Confirmed the starter's remote `main` matches the reference commit.
- Validated UTF-8, LF endings, final newlines, and absence of trailing whitespace
  across all eight changed files; all 27 local documentation links resolve.
- Confirmed `.editorconfig` and `.gitignore` match the starter exactly, scratch
  and environment paths are ignored, and `.env.example` remains trackable.
- Reviewed the diff and ran Git whitespace checks. The source-art skill is
  unchanged. No application tests exist or are applicable to this change.

## Follow-up

Follow [BOOTSTRAP.md](../../BOOTSTRAP.md) to define conversion and print acceptance
criteria, choose the stack and storage conventions, and implement the first
reproducible artwork-to-poster journey.
