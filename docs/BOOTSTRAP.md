# Bootstrap the literary-art pipeline

The Bun/TypeScript `bookgen ideas <book-id>` and `bookgen images <book-id>` commands
generate concepts (ten by default) and one cleaned PNG per concept through the Codex SDK/CLI. Its
[CLI contract](product-specs/bookgen-cli.md)
defines book-grouped outputs and independent stage retries; the README documents
setup and checks. Use this guide for the remaining artwork-to-poster journey.

## Local render loop is implemented

`bookgen render <book-id> --idea <idea-id>` now validates upstream artifacts,
normalizes text for art, maps opaque pixels to characters, and renders all registered
print targets by default. Conversion and rasterization are separate modules behind
one CLI command. The [render contract](product-specs/bookgen-cli.md#render) defines
layout, text cycling, font, validation, and retry behavior.

Use a reviewed image candidate and fetched text, inspect the rendered poster at
thumbnail and full size, and check physical proofs before approving it for sale.
Rendering uses a 6.5 pt minimum font and target-specific sampled grids; art
appearance, retained detail, contrast, and printer compatibility still require review.

## Remaining production work

1. Review physical proofs and establish provider-specific print acceptance criteria.
2. Choose durable production storage and retention/versioning for approved assets.
3. Prepare products, mockups, metadata, and listing drafts from validated print files.
4. Integrate a dropshipping provider and store, with separate publication and
   reconciliation boundaries.

Keep generated files, print artifacts, product records, and store state distinct.
Record future stage ownership and retry behavior in the CLI contract, and durable
decisions and verification evidence through the [documentation map](index.md).
