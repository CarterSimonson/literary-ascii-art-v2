# Bookgen images

## Outcome

Run `bookgen ideas <book-id>` and `bookgen images <book-id>` against a shared
root `books.yaml` registry. Images generates one reusable transparent PNG per
idea through the authenticated Codex CLI, then deterministically normalizes
alpha and artwork colors for later conversion. No character conversion yet.

## Decisions

- The user explicitly requests Codex CLI authentication, one image per idea,
  deterministic post-processing, and complete replacement on successful reruns.
- The image command consumes all ten ideas without another selection gate.
- Keep title-based ideas invocation for compatibility; registered IDs provide the
  common identity for pipeline commands. Images requires a registered ID.
- Generate into staging; replace the stage-owned raw directory as a set only
  after all images pass. Preserve prior valid images on failure. Own metadata
  inside that directory so publication has one boundary. Traces are latest attempt.
- Capture upstream YAML and per-image hashes, prompts, settings, Codex usage,
  and post-processing statistics. Reject identity mismatch and changed inputs.

## Steps and evidence

1. Inspect existing contracts and verify native image generation through Codex.
2. Add registry resolution, prompt, Codex adapter, cleanup, transactional runner.
3. Cover registry, cleanup, retries, failure, interruption, locking, CLI wiring.
4. Run project checks, exercise a live generation, and update documentation.

## Outcome and validation

Completed shared `books.yaml` resolution for both CLI steps and the images stage.
Native Codex generation/file handoff works with the existing login. Each idea has
an isolated workspace and up to two attempts; native originals, events, failures,
review notes and processed image provenance remain observable.

- `bun install --frozen-lockfile` passes; Sharp is pinned to 0.35.5.
- `bun run check` passes: 60 tests, strict TypeScript, lint and formatting.
- A real `bun run bookgen images dracula` completed all ten ideas with no
  replacement needed after the review-boundary fix. Published ten distinct PNGs
  and `output/dracula/raw/manifest.yaml`; original ideas and their trace preserved.
- Independent decoding verified all ten are 1066 × 1578 RGBA PNGs (1024 × 1536
  native sources plus 21 pixels of padding per side), with binary alpha, nonempty
  artwork, transparent edges and only their selected artwork palette colors.
- Verified unique image hashes, all idea IDs, current input hash, and manifest
  image hashes, dimensions and opaque pixel counts. No lock, staging or backup
  remains. Local diagnostic proof is in `traces/images/verification.json`, with
  `traces/images/contact-sheet.png` as a thumbnail review sheet.
- Deterministic tests cover full-set replacement/removal of obsolete IDs,
  preservation on partial failure, replacement attempts, original retention,
  cancellation, timeout, concurrency locks and interrupted-publication recovery.

## Discoveries and remaining limits

Native generated PNGs may have partial alpha throughout the artwork, and the
model repeatedly rejected original glow before cleanup. Inspection confirmed
binary-alpha thresholding removes that glow. The final generation brief records
visual concerns as notes on unapproved candidates; execution and deterministic
input/cleanup validation failures block publication. Human selection evaluates
the cleaned master before downstream conversion.

Native dimensions are requested through the prompt and actual dimensions are
recorded. The SDK does not expose the native image backend model. Validation cannot
establish literary fidelity, absence of text, minimum feature widths or composition
quality. Some real candidates have narrow details and silhouette concerns, captured
in their review notes. No character conversion, poster rendering, artwork selection
or production approval was performed. Future work starts by reviewing/selecting a
master and defining book-text and character-grid rules.
