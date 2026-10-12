# Literary ASCII Art v2

## Map

- [README](README.md): project purpose, current state, and development commands.
- [Architecture](ARCHITECTURE.md): pipeline boundaries and dependency rules.
- [Documentation](docs/index.md): decisions, designs, and execution plans.
- [Bootstrap](docs/BOOTSTRAP.md): remaining work to establish the first working pipeline.
- [Generate book art](.agents/skills/generate-book-art/SKILL.md): source-art workflow.
- [Grab](.agents/skills/grab/SKILL.md): pick up one actionable Linear ticket.

## Project tracking

- Linear project: [Literary ASCII Art v2](https://linear.app/codekips/project/literary-ascii-art-v2-6cfd6b18fd52).
- Linear team: Codekips (`COD`).
- [Tracking conventions and work queue](docs/project-tracking.md). Linear owns
  current issue status and dependencies; keep durable designs and plans here.

## Product

Modernize the working legacy generator through small, visible tracer bullets:

1. Generate, convert, and display one Odyssey poster from Project Gutenberg text.
2. Build a local web app to review, promote, scrap, and iterate on candidates.
3. Integrate one promoted poster with Printful; explore mugs afterward.

Each opaque pixel in the prepared character grid becomes one monospaced book
character; transparent pixels are skipped and source colors are preserved.
Storefronts and sales are outside the current scope.

Use Go for the first pipeline, with Go modules, the standard library, and
`golang.org/x/image` for resizing and font rendering. Favor the smallest working
path and tune from a displayed result; measure before optimizing.

Keep retained masters, text, converted data, posters, review records, and Printful
outputs distinct. Simple local files and small run metadata are enough to start.

## Working conventions

- Keep durable knowledge in the repository. Record decisions where a future
  agent can find them, and update affected docs with the code.
- For substantial work, keep an execution plan using the convention in the
  [documentation map](docs/index.md). Small changes need no extra paperwork.
- Make behavior observable and verify the requested outcome using the project's
  tools. Include the evidence and any remaining gaps in the handoff.
- When a recurring failure reveals a missing capability, improve the relevant
  tool, check, or documentation so the next attempt has better feedback.
- Enforce important boundaries with checks; leave implementation choices open
  within those boundaries. Keep changes small enough to review and correct.
- Keep this file short. Add guidance when it captures a project-specific decision
  or prevents a demonstrated mistake; remove instructions that no longer help.
