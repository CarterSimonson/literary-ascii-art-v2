# Project tracking

Track work in [Literary ASCII Art v2](https://linear.app/codekips/project/literary-ascii-art-v2-6cfd6b18fd52)
under the Codekips team (`COD`). The project links this repository, its architecture,
and its bootstrap guide.

## Working precedent

The setup follows the Cooktabs and Mapgen projects: focused issues explain the
outcome and motivation, include concrete acceptance criteria, link the repository,
and record real blocking relationships. Linear is the source of truth for current
status, ownership, and dependencies. Keep durable specs, decisions, and execution
plans in this repository using the [documentation conventions](index.md).

Use Backlog, In Progress, In Review, and Done according to actual progress. Record
the tested revision, commands or operations, observed results, and remaining
limitations before moving implementation work to In Review. Mark it Done after
the change is merged and its acceptance criteria are satisfied. Follow the user's
authorization for merging, publishing, and other external actions.

Use `ready-for-agent` only for unblocked work with enough context to implement
independently. Resolve material product decisions and refine acceptance criteria
before applying that label. Provider and store tickets remain later-stage planning
until their commercial and operational inputs are resolved.

## Initial queue

These links describe the initial breakdown; consult Linear for live status and
dependencies. The first planning task is COD-67. The starter alignment is already
published in [9e3e043](https://github.com/CarterSimonson/literary-ascii-art-v2/commit/9e3e043)
and recorded in COD-66.

| Issue                                              | Outcome                                          | Initial prerequisites             |
| -------------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| [COD-66](https://linear.app/codekips/issue/COD-66) | Adopt starter repository standards               | Completed before project creation |
| [COD-67](https://linear.app/codekips/issue/COD-67) | Define artwork-to-poster acceptance criteria     | None                              |
| [COD-68](https://linear.app/codekips/issue/COD-68) | Bootstrap reproducible local development         | COD-67                            |
| [COD-69](https://linear.app/codekips/issue/COD-69) | Validate artwork and book inputs with provenance | COD-67, COD-68                    |
| [COD-70](https://linear.app/codekips/issue/COD-70) | Convert pixels into inspectable character art    | COD-69                            |
| [COD-71](https://linear.app/codekips/issue/COD-71) | Enforce verification in CI                       | COD-68                            |
| [COD-72](https://linear.app/codekips/issue/COD-72) | Render and validate print-ready posters          | COD-70                            |
| [COD-73](https://linear.app/codekips/issue/COD-73) | Verify the complete artwork-to-poster journey    | COD-71, COD-72                    |
| [COD-74](https://linear.app/codekips/issue/COD-74) | Prepare products, mockups, and listing drafts    | COD-73                            |
| [COD-75](https://linear.app/codekips/issue/COD-75) | Publish products and reconcile store state       | COD-74                            |

Bun/TypeScript and the local output layout are now established by the
[bookgen CLI contract](product-specs/bookgen-cli.md). Grid/text behavior, font
metrics, print settings, and durable production storage remain open decisions.
The initial queue predates the ideas tracer; consult Linear for live scope and
status. No provider or storefront has been selected.
