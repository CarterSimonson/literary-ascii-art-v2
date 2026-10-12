# Architecture

## Implemented today

The only domain workflow is the
[generate-book-art skill](.agents/skills/generate-book-art/SKILL.md), with agent UI
metadata in `.agents/skills/generate-book-art/agents/openai.yaml`. It guides an
agent through concepts, image generation, review, and refinement. It does not
implement character conversion, poster rendering, or store operations.

There is no application stack or source layout yet. The boundaries below describe
the intended pipeline, not existing modules or enforced interfaces. Update this
map with actual code locations and checks as stages are implemented.

## Intended stage boundaries

| Stage | Inputs | Outputs | Validation needed |
| --- | --- | --- | --- |
| Source artwork | Book identity, approved concept, palette | Transparent PNG master and generation metadata | Composition, transparency, palette, and visual legibility |
| Character conversion | Approved master, identified book text, conversion settings | Character placement and source-color data with provenance | Pixel coverage, transparent-pixel skipping, character order, and color preservation |
| Poster rendering | Converted art, font, layout, poster background, print settings | Print file and render metadata | Dimensions, resolution, font behavior, margins, and visual proof |
| Product preparation | Validated print file, provider settings, editorial metadata | Mockups, product records, and listing drafts | Asset references and provider-specific requirements |
| Store operations | Approved product records and external service responses | Published listings and separately recorded store state | External response validation and reconciliation |

## Dependency rules

- Conversion consumes approved artwork and book text without invoking image
  generation or depending on a store or dropshipping service.
- Rendering consumes converted data without changing the master or character
  mapping. The poster background is a render input; it is not painted into the
  transparent master.
- Product preparation consumes validated print files. Publishing and store
  reconciliation belong at the external-service boundary.
- A downstream stage must not silently modify an upstream artifact. Changed
  inputs produce a new result with its own provenance.
- Keep generated masters, converted art, print files, mockups, product records,
  and store state distinct. Select their actual storage layout during bootstrap.

## Reproducibility and external boundaries

Record the book and text source, master identity, stage settings, tool versions,
and input/output identities with each result. Image generation also needs its
prompt and approval context; retaining the selected master makes downstream work
reproducible even when generation itself cannot be replayed exactly.

Validate imported images, text, fonts, provider responses, and store responses
where they enter the system. Keep credentials in ignored local configuration or
the execution environment. Define schemas, versioning, and retry behavior when
the corresponding integration exists.

## Checks and open decisions

No executable pipeline checks exist yet. The
[bootstrap guide](docs/BOOTSTRAP.md) defines the first feedback loop and the
behavior that its checks should cover. Runtime, character-grid rules, text
normalization, font metrics, print format, asset storage, and external providers
remain undecided. Record decisions and their rationale through the
[documentation map](docs/index.md).
