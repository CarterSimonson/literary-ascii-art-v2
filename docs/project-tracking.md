# Project tracking

Use [Literary ASCII Art v2](https://linear.app/codekips/project/literary-ascii-art-v2-6cfd6b18fd52)
in Codekips (`COD`). Linear owns current status and dependencies; durable plans
and decisions live here.

## Current path

| Ticket | Deliverable | Prerequisite |
| --- | --- | --- |
| [COD-66](https://linear.app/codekips/issue/COD-66) | Starter standards, already published | Done |
| [COD-67](https://linear.app/codekips/issue/COD-67) | Generate, convert, and display one Odyssey poster using Go | None |
| [COD-68](https://linear.app/codekips/issue/COD-68) | Local web app to review, promote, scrap, and iterate on posters | COD-67 |
| [COD-74](https://linear.app/codekips/issue/COD-74) | One promoted poster prepared in Printful with a mockup/template | COD-68 |
| [COD-75](https://linear.app/codekips/issue/COD-75) | Optional mug layout and Printful proof | COD-74 |

COD-69 through COD-73 are canceled as separate work items. Their necessary setup,
input checks, conversion, rendering, and proof work is folded into COD-67. Add
small verification tooling as useful; it must not become a gate before the first
working image. The former store-publishing scope is removed.

The [active Odyssey plan](exec-plans/active/odyssey-tracer-bullet.md) records source
inspection, defaults, and the next implementation action.

## Working conventions

Keep issues focused on visible outcomes, with practical acceptance criteria and
real dependencies. Record the tested revision, commands, proof, and remaining
limitations before review. Mark implementation work Done after it is merged and
its acceptance criteria are met. `ready-for-agent` means unblocked work with enough
context to start; normal source-art concept approval still applies.
