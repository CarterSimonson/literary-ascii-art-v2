# Repeatable book onboarding, proven with one Odyssey poster

Ticket: [COD-67](https://linear.app/codekips/issue/COD-67).
Status: implementation and proof complete; PR review and merge remain.

## Outcome and confirmed constraints

Build a repeatable `add-book` command: resolve the book, acquire its text,
research literary imagery, propose compositions, generate source art, and render
character-poster drafts. Prove the entire path with The Odyssey. Adding the next
book must not require new code or a person inventing its composition.

User decisions from October 11, 2026:

- Automate composition ideation as well as image generation. A saved manually
  invented recipe alone does not satisfy the product.
- Generate concepts and draft posters automatically; review before promotion.
  This explicitly waives the source-art skill's concept-approval gate for this
  automated draft workflow. Keep its literary and technical art constraints.
- Use the existing Codex subscription. No purchased API key or usage-billed
  Responses/Images API dependency. Do not fall back to paid API calls.
- Print text from the story's beginning in order; truncate when the grid fills.
  Full-book fitting is unnecessary. Never wrap or repeat the text. If text ends
  first, leave remaining cells empty and report it.
- TypeScript with the Codex SDK owns the agent-generation workflow and public
  `add-book` entry point. Go owns deterministic preparation, mapping, rendering,
  and a separate CLI invoked by the TypeScript coordinator.

This plan supersedes the earlier manual-concept and direct-image-API defaults.
Implementation follows this plan; final proof evidence is recorded below as it becomes available.

## Legacy and visual evidence

Read `src/index.js`, `src/imageGenerator.js`, `src/constants/posterSizes.js`, and
`package.json` at legacy commit `2feebc79a376ee63fc3757aebe8bc74dd61f1e41`.
[Source](https://github.com/CarterSimonson/literary-ascii-art/tree/2feebc79a376ee63fc3757aebe8bc74dd61f1e41/src).
The Node script normalizes text, crops/resizes imagery, assigns word-aware text
lines, renders RGB glyphs, and saves poster PNGs with margins. Reuse the important
behavior, starting with a sequential character stream and actual font metrics.

Visually inspected these files at that revision:

- [Odyssey master and posters](https://github.com/CarterSimonson/literary-ascii-art/tree/2feebc79a376ee63fc3757aebe8bc74dd61f1e41/assets/odyssey):
  broad blue sea, layered waves, brown hull, and a white sail. The 12x18 conversion
  preserves the vessel through a sail cutout surrounded by text.
- [Dracula master](https://github.com/CarterSimonson/literary-ascii-art/blob/2feebc79a376ee63fc3757aebe8bc74dd61f1e41/assets/dracula/dracula.png):
  sparse red drips establish a subject with very little geometry but less text area.
- [Alice master](https://github.com/CarterSimonson/literary-ascii-art/blob/2feebc79a376ee63fc3757aebe8bc74dd61f1e41/assets/aliceinwonderland/aliceinwonderland.png):
  a rabbit cutout in a broad dark field. The surrounding field can carry the text.

These masters are 3600 x 5666, not exactly 2:3; treat them as references and do not
stretch them into the new contract. Disposable references are cached under
`.artifacts/references/legacy/`.

Inspected [Litographs' Odyssey](https://www.litographs.com/products/odyssey): a
pale blue text field around a white trident, with wave bands. Carry forward the
general principles of large recognizable contours, limited colors, substantial
text-bearing masses, and strong negative space. Create original compositions;
do not send competitor images to the image model. The page reports different text
capacities by size; full-book fitting is a separate layout concern.

The earlier homeward-sea, bow/passage, and Penelope/weaving concepts were illustrative
ideas. They are not required production inputs. The toolchain must derive its own
Odyssey concepts from saved research using the same prompts used for other books.

## Runtime: TypeScript Codex SDK and Go artifact pipeline

The user selected a TypeScript coordinator using the
[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk). It starts/resumes Codex
threads using the supported local runtime and ChatGPT login. Versioned stage
prompts and structured outputs control research, art direction, and native image
generation. Go handles deterministic artifact work through a separate CLI.
The OpenAI Agents SDK with direct API calls is not the selected path under the
user's billing constraint.

Use Bun for dependency/script tooling if useful. The SDK documentation specifies
Node.js support; Bun runtime compatibility must pass the first smoke proof before
being treated as supported. Otherwise use a pinned supported Node runtime.
Retain the TypeScript package manifest/lockfile and Go module/toolchain files.

Official [authentication documentation](https://learn.chatgpt.com/docs/auth)
distinguishes ChatGPT subscription access from API-key usage. The
[image-generation guide](https://learn.chatgpt.com/docs/image-generation) describes
the built-in image tool and its general Codex usage allowance. This is an automated
Codex runtime behind the command; no interactive Codex operator is required per
book. It is not a promise of unlimited subscription capacity.

Read-only local evidence from CLI 0.162.1:

- `codex login status`: logged in using ChatGPT.
- `codex exec --help`: JSON events, output schema, output-last-message, and resume
  interfaces are present.
- `codex features list`: stable `image_generation` feature is enabled.
- Generated app-server schemas include `imageGeneration` items with `savedPath`,
  `result`, `revisedPrompt`, `transparentBackground`, `status`, and failure data.

These establish the local capability surface, not successful headless generation.
First implementation action: a small Codex SDK smoke run under subscription auth
producing structured concepts and one actual transparent PNG saved locally.
Confirm SDK event/output types, artifact retrieval, PNG alpha, and failure behavior.
Use supported SDK/runtime events or narrow App Server integration if the chosen
SDK version cannot expose image artifacts directly. If the runtime/account cannot support
scripted generation, report that specific gap; do not silently change providers,
require a paid key, or automate the consumer website as a substitute.

Preflight checks ChatGPT authentication and image capability. Never extract or
reuse cached OAuth tokens as credentials for direct API endpoints. Use the
supported Codex runtime to handle authentication. Do not select API-key auth,
purchase credits, or automatically fall back on quota failure. Save progress and
return a resumable limit/auth/capability error. Pin the tested CLI version and
record actual available model/settings; record tool prompt revisions when exposed.
Do not assume the built-in tool exposes the direct Images API's full setting set.

## Repeatable add-book stages

The normal input is a title. Accept author, source, language, and edition overrides
when needed. Resolve a stable work ID and a separate edition/text ID; a title or
slug alone is insufficient. First support discoverable Gutenberg English text and
explicit local text plus metadata. Resolve title/author against retrieved source
metadata; never let a model invent a Gutenberg ID or download URL. Material
ambiguity or unavailable text returns `needs-input` with a concrete source/edition
choice. Resume after that choice without losing completed work.

| Stage | Work | Retained output |
| --- | --- | --- |
| Resolve/acquire | Match work and edition, cache text, locate story body | Book/edition record, source metadata, raw/body text, boundaries and hashes |
| Research | Extract themes, setting, recurring objects, relationships | Literary brief with passage references, coverage, and uncertainties |
| Ideate | Propose three distinct original compositions under shared style rules | Concepts, palettes/backgrounds, literary and conversion rationales, recommendation |
| Build recipes | Expand concepts through a fixed image prompt template | Exact prompts, tool settings, style/template versions, parent concept IDs |
| Generate | Request one image per concept through built-in Codex image generation | Three raw masters, events, revised prompts and artifact identities |
| Prepare/render | Clean alpha/palette, sample cells, consume book text, draw letters | Prepared masters, mappings, poster drafts, thumbnails, technical reports |
| Await review | Display all drafts and rationale | Contact sheet and explicit `awaiting-review` record |

TypeScript application code owns this order, caches, budgets, and state transitions.
Use bounded research and art-direction Codex SDK turns with narrow instructions
and schema-constrained final output. Scope each stage's workspace to its inputs
and outputs; keep durable artifact writes under application control. A fixed pipeline
is enough; no open-ended supervisor or automatic aesthetic-refinement loop is
required for the first proof.

Keep the process boundary small and explicit:

- TypeScript owns book/source metadata, research, concepts, recipes, Codex threads
  and events, image attempts, candidate lineage, workflow state, and review records.
- Go accepts local input paths and versioned JSON job manifests for `prepare`,
  `map`, and `render`; it returns JSON result manifests with artifact paths/hashes,
  dimensions, text offsets, and validation results. These commands make no model
  calls and do not require Codex login or subscription credentials.
- Invoke the Go binary with fixed argument arrays using a subprocess API, avoiding
  shell interpolation of titles/prompts/paths. Use machine-readable stdout for
  results, stderr for diagnostics, and meaningful exit codes for failures.
- Share only the focused manifest contracts, with fixtures checking both sides.
  TypeScript owns workflow decisions; Go owns pixel/character behavior. Avoid
  duplicating palette cleanup or mapping logic in TypeScript.

Start with the two local packages and ordinary subprocesses; an HTTP service or
MCP wrapper is unnecessary for the first proof. The Go CLI remains independently
usable for offline rerendering, while later curation reuses the same artifact jobs.

Research must cover the acquired story, including its ending, even when the poster
prints only an opening portion. Use full text within the configured context budget,
otherwise deterministic chunks with chapter/offset IDs, notes per chunk, and a
synthesis step. Save coverage; missing chapters cannot count as a complete brief.
Retain supporting passage IDs/offsets and validate them against cached body text.
If a model assigns the wrong ID to an exact quote that occurs in only one supplied
paragraph, resolve that ID deterministically and save a correction audit beside the
unaltered model response. Reject invented or ambiguously located quotations.
Additional authoritative context may be retrieved when needed; retain source URLs
and snapshots and distinguish evidence from interpretation. Treat text as data,
never as runtime instructions. Schema validity does not prove literary accuracy.

Each concept records: dominant visual mass; primary subject and its silhouette or
negative-space mechanism; integrated secondary motif; literary rationale and
passage references; dominant/accent/background hex colors; conversion rationale.
Require three different visual mechanisms or thematic emphases, not three wordings
of one emblem. Recommend one under a fixed rubric for literary specificity,
recognition, negative-space clarity, and conversion resilience. Save all three and
the rubric/rationale. A recommendation cannot promote a candidate.

Move the art skill's shared rules into versioned runtime prompts/style data:
transparent 2:3 masters, flat fills, one dominant color carrying at least 80% of
visible art, optional accent, deliberate perimeter, broad strokes/gaps, no lettering,
and thumbnail legibility. Book-specific subjects, motifs, and colors are generated
from research. The 65–85% composition extent target and opaque pixel coverage are
separate measurements; the latter determines text capacity. Maintain skill/runtime
alignment during implementation so editorial instructions do not drift.

Generate one draft per concept initially: three image requests, then three actual
character previews. Keep every result as a draft. Promotion requires a separate
human action recorded locally in COD-67; COD-68 provides the review UI. Refinement
uses candidate/concept ID plus feedback and creates linked revisions, reusing
research and earlier concepts unless re-ideation is explicitly requested.

## Caching, preparation, and replay

Research, ideation, and fresh images are stochastic. Versioned prompts and recorded
model/settings constrain direction; saved outputs provide repeatable downstream
inputs. Do not promise that re-running a model produces the same concepts or pixels.

Identify each stage by input hashes plus workflow/prompt/style/tool versions. Reuse
completed artifacts by default. Explicit re-ideation creates a new concept revision;
a new image batch creates new images for an existing recipe. Never overwrite
previous candidates. Track candidates separately and serialize a given book/run so
partial resumes do not duplicate completed generation. Incomplete outputs are not
cache hits. Surface unknown-outcome timeouts instead of blindly repeating a request.

Proposed deterministic preparation: keep the raw PNG unchanged, threshold alpha
(initial value 128) to 0/255, and map visible RGB to the recipe's one/two colors using
a fixed documented distance rule and tie-break. Save a separate prepared master
with settings/version. Alpha thresholding can alter fine edges; compare raw and
prepared thumbnails. Reject opaque mattes, broken silhouettes, and missing subjects;
cleanup cannot repair those failures. Never guess which solid color is background.

Go uses modules, the standard library, and `golang.org/x/image` for nearest-neighbor
sampling and font rendering. Pin the supported Go toolchain and retain module files.
Use actual monospaced cell metrics to preserve proportions. Start with 12 x 18
inches at 300 DPI (3600 x 5400), a 0.75-inch margin, a retained redistributable font
and license, and configurable grid density tuned from the visible result.

Odyssey proof: [Gutenberg #1727](https://www.gutenberg.org/ebooks/1727), Samuel
Butler's prose translation; retain [raw UTF-8 text](https://www.gutenberg.org/cache/epub/1727/pg1727.txt)
and select the story body excluding notices, contents, and prefatory material.
Traverse cells left to right/top to bottom, skip alpha-zero cells without consuming
text, preserve prepared sampled RGB, collapse whitespace to spaces, and retain
punctuation. Spaces consume cells despite drawing no ink. Stop at grid capacity or
text exhaustion; record ending offset and characters/words used. Rendering consumes
the mapping and cannot change assignments or call a model.

Keep book/edition metadata, raw/body text, research, concepts, recipes, raw/prepared
masters, mappings, posters, previews, review records, and Codex events distinct.
A small run record links their hashes, lineage, CLI/model/settings, prompt versions,
font/hash/license, grid/layout, renderer revision, duration, usage, and text range.
Choose a durable binary location and documented retrieval for the first retained
proof; ignored `.artifacts/` alone cannot support fresh-checkout replay.

Proposed interfaces, not existing commands:

```sh
literary-art add-book "The Odyssey" --author Homer --gutenberg-id 1727
literary-art add-book "Dracula" --author "Bram Stoker"
literary-art resume --book-id <saved-book-id>
literary-art re-ideate --book-id <saved-book-id>
literary-art generate --recipe <saved-recipe.json> --new-batch
literary-art render --candidate <saved-candidate-id>
```

Repeating `add-book` returns/resumes existing drafts for the same resolved edition
and workflow version. `render` uses saved files offline and needs no Codex login.
Bound model turns, research context, and image attempts per run. Start with three
image attempts total, one per concept; report failures and preserve partial work.
Further replacement/edit attempts require an explicit new run budget. Subscription
limit failures pause the command's work; no paid API fallback or credit purchase.

## Implementation and acceptance

1. Verify a TypeScript Codex SDK run returns structured output and one saved
   transparent PNG using ChatGPT auth. Document tested SDK/runtime versions and
   event/artifact shape; validate Bun execution if it is the chosen runtime.
2. Add the Go module, cached story-body preparation, tiny mapping fixture, and an
   early visible legacy-image conversion as a behavioral reference.
3. Add the TypeScript coordinator, source resolution, reusable research/ideation
   prompts/output contracts, and Go job/result manifests.
   Generate Odyssey concepts with the toolchain, not hand-authored book-specific input.
4. Build recipes, generate/retain one master per concept, deterministically prepare
   and render all drafts, save the contact sheet, and return `awaiting-review`.
5. Record the user's choice; retain the selected proof inputs and verify fresh-checkout
   offline replay. Record actual commands, runtime, output size, and adjusted settings.
6. Run a second sourced book through research/ideation/recipe construction without
   code changes or manually supplied concepts. Full second-book posters are optional.

Evidence required before implementation review:

- A documented TypeScript Codex SDK title-to-drafts command operates under ChatGPT login without API
  keys or an interactive Codex operator. No per-book composition code is required.
- Research covers the story and references real passages; a second book produces
  three distinct grounded concepts through the same path. Ambiguity is resumable.
- All drafts remain unpromoted until a human decision; model recommendations and
  human review records remain separate.
- Fixture checks cover stage-output validation, source references, completed-cache
  reuse, partial resumes, quota/auth errors, and no paid fallback. Mock the Codex
  SDK and Go process boundaries; automated tests consume no subscription generation allowance.
- A cleanup fixture verifies alpha/palette handling and unchanged raw masters.
- Mapping fixtures verify transparent skipping, order, RGB, whitespace/punctuation,
  and exhaustion. The real mapped stream is exactly a prefix of the story body.
- Two offline renders under pinned inputs/settings reproduce mapping and poster
  pixel hashes. Exclude timestamps from equality checks.
- Inspect source thumbnails, prepared thumbnails, poster-size previews, and glyph
  zoom. Literary meaning and attractive composition require visual review.
- Record source/model/CLI identities, actual image dimensions, settings/usage, time,
  output sizes, visible-cell count, text range, and limitations.

## Outcome and handoff

Implemented and verified the TypeScript Codex SDK/Bun coordinator and separate
Go CLI. The real Odyssey workflow produced three drafts; Dracula reached three
concepts using the same code. Retained inputs support exact fresh-checkout offline
replay. Fifteen TypeScript and five Go tests, type/format checks, Go vet, and staged
whitespace checks pass.

[Proof and actual commands](../../references/cod-67-proof.md) record source
boundaries, counts, timings, hashes, visual inspection, and limitations. Native
alpha/style adherence needed the planned deterministic cleanup; one citation-ID
mistake led to an exact-quote resolver with an audit. No artwork was promoted.
The implementation is ready for PR review; mark COD-67 Done only after merge and
acceptance. COD-68 adds the review UI; Printful and mugs follow afterward.
