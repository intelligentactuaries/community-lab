# Community Lab IDE: the manual

The user manual for Community Lab IDE, built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/)
in the same theme as the other manuals on **https://docs.intelligentactuaries.com/**, where it is published at
`/community-lab/`.

## What is generated, and what is written

| | |
|---|---|
| `docs/reference/basis.md`, `indicators.md`, `templates.md` | **Generated** from the engine by `scripts/reference.ts`: every parameter's meaning (its doc comment in `src/sim/params.ts`), default and range; the mortality presets with the life expectancies they imply; the indicators; the lab's templates. |
| `generated/sample/` | **Generated**: the sample workspace's files, which `docs/workbench/sample.md` and other pages include. |
| `docs/model/odd.md`, `docs/model/assumptions.md`, `docs/whats-new.md`, `docs/license.md` | **Included at build time** from the repository's `docs/ODD.md`, `docs/ASSUMPTIONS.md`, `CHANGELOG.md` and `LICENSE` (pymdownx.snippets, `base_path: ..`). |
| `docs/assets/img/*.webp` | **Taken from the running app** by `scripts/screenshots.ts`. |
| Everything else in `docs/` | Written by hand, against the code. |

## Rebuild

From the repository root:

```bash
bun manual/scripts/reference.ts      # after any change to the engine's parameters, indicators, templates or sample
```

It fails if a parameter has no description or no group, so a new parameter cannot reach the engine without
reaching the manual.

The screenshots, after a change to the interface (an engine of its own, so the shots do not touch your workspace):

```bash
bun run build
PORT=3047 COMMUNITY_DATA_DIR=/tmp/cl-shots COMMUNITY_STATIC_DIR=dist bun src/server/index.ts &
bun manual/scripts/screenshots.ts http://127.0.0.1:3047 /tmp/cl-shots
```

`SHOTS=3d-street,lab bun manual/scripts/screenshots.ts …` retakes only those.

## Build and preview

No MkDocs needs installing; `uvx` runs it in a throwaway environment:

```bash
cd manual
uvx --with mkdocs-material mkdocs serve               # live preview at http://127.0.0.1:8000
uvx --with mkdocs-material mkdocs build --strict      # site/ (git-ignored); --strict fails on a broken link
```

## Publish

The site is a build artefact of the website repository (`intelligentactuaries/website`), in
`docs-site/community-lab/`. From a checkout of the website beside this repository:

```bash
bun run docs:community-lab     # ≡ cd ../community-lab/manual && uvx --with mkdocs-material mkdocs build --strict -d ../../website/docs-site/community-lab
bun run deploy:docs            # or deploy:all
```

## Conventions

- Prose follows the lab's house style: plain words, no em-dashes, British spelling, the app's own labels in bold.
- Every statement about the app is checked against the code; figures that a run produces carry the version and
  the date they were measured on.
- Screenshots are WebP, taken in the light theme at 1440 × 900, embedded as
  `<figure class="cl-shot" markdown>` with a caption.
