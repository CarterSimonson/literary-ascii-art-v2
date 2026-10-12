# Go artifact job contract, version 1

The TypeScript coordinator invokes the Go binary with an explicit argument array:
`[command, jobPath]`. Each command accepts one JSON file and emits one JSON result
on stdout. Paths are local; relative paths resolve against the process directory.
Use absolute paths at the process boundary. Diagnostics go to stderr; invalid jobs
or processing failures exit nonzero. Existing outputs are never overwritten.

## Prepare

```json
{
  "version": "1",
  "input": "/absolute/raw.png",
  "output": "/absolute/prepared.png",
  "palette": ["#164B63", "#C58B32"],
  "alphaThreshold": 128
}
```

Require one/two RGB colors. Alpha below the threshold becomes zero; other pixels
become fully opaque and snap to the closest palette RGB by squared Euclidean
channel distance. Equal distances select the first palette entry. Raw inputs stay
unchanged. Empty masks and fully opaque mattes are rejected. The coordinator also
requires native generation to produce a 2:3 master; no silent stretching/cropping.

## Map

```json
{
  "version": "1",
  "input": "/absolute/prepared.png",
  "output": "/absolute/mapping.json",
  "text": "/absolute/body.txt",
  "font": "/absolute/Go-Mono.ttf",
  "width": 3600,
  "height": 5400,
  "margin": 225,
  "columns": 420
}
```

Fit the full source canvas inside the margin box using measured monospaced advance
and line height. Sample source pixel centers with nearest-neighbor geometry;
transparent cells consume no text. Normalize whitespace, retain punctuation, and
consume Unicode characters from the story opening in row order. Spaces occupy
cells despite drawing no ink. Truncate at capacity; after text exhaustion leave
remaining cells empty. RGB is preserved from the prepared source.

The mapping stores geometry, font bytes hash, source/text hashes, text length,
characters/words used, visible-cell count, exhaustion flag, and each assigned
cell's coordinates, character, and RGB hex color. Its font path may be overridden
at rendering for a relocated checkout; font bytes must still match.

## Render

```json
{
  "version": "1",
  "input": "/absolute/mapping.json",
  "output": "/absolute/poster.png",
  "background": "#F4EFE4",
  "font": "/absolute/Go-Mono.ttf"
}
```

Draw exactly the stored assignments on the poster background. The optional font
path override enables relocation without changing font identity. Rendering does
not remap text or call a model.

## Inspect and results

`inspect` takes `version`, `input`, and reports a
PNG's dimensions, pixel hash, and transparent/opaque/partial alpha counts without
writing an output. All PNG commands bound input/output pixel counts before allocation.

Results include contract version, command, absolute artifact path, SHA-256, byte
size, duration in milliseconds, and relevant dimensions/coverage/text counts.
PNG results also include a decoded NRGBA pixel hash. Mapping/PNG replay comparisons
exclude duration; two renders under the same pinned font/toolchain/settings must
match their hashes. Raw/body text and original masters remain separate inputs.
