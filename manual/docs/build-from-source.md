# Build from source

You do not need any of this to use Community Lab IDE: the installers carry everything. Build from source to change
the engine, to run it on a platform without an installer, or to work on the app itself.

## Prerequisites

- [Bun](https://bun.sh) 1.1 or later.
- Git.
- To package installers: the usual
  [electron-builder prerequisites](https://www.electron.build/multi-platform-build) for your platform.

## The development pair

```bash
git clone https://github.com/intelligentactuaries/community-lab.git
cd community-lab
bun install

bun run dev          # the engine on http://127.0.0.1:3040 and the UI on http://localhost:5195
```

Open <http://localhost:5195> in a browser. This is the same app as the desktop one, without the desktop shell: the
workbench opens folders by path instead of a system dialog, and moves deleted files to its own trash folder in its
data folder instead of the system's.

## Checks

```bash
bun test             # the engine's tests: determinism, the bases, the books, workspace safety, the sample
bun run typecheck    # TypeScript, strict
```

## The desktop app

```bash
bun run desktop:install      # the desktop app's own dependencies (Electron, electron-builder)
bun run build                # the client, which the engine serves to the desktop app in development
bun run desktop:dev          # the desktop app, its engine run from the source with Bun
bun run desktop:dist:linux   # desktop/build/: the AppImage, the .deb and latest-linux.yml
```

`desktop:dist:win` and `desktop:dist:mac` build the other platforms. Bun cross-compiles the engine for any target,
but electron-builder is happiest on the target system, which is why releases are built by the workflows in
`.github/workflows/`, one per platform. `docs/RELEASING.md` is the release checklist.

## Command-line tools

The engine runs without the app, from a terminal:

```bash
bun scripts/batch.ts --seeds 20 --years 30 --out data/batch.csv   # Monte Carlo
bun scripts/smoke.ts 5                                            # five simulated years, printed summary
bun scripts/calibrate.ts --fit                                    # re-derive the mortality presets from their targets
bun scripts/build-embed.ts                                        # the engine for web pages (dist-embed/)
```

## Where things are

```text
src/sim/          the engine: pure TypeScript, no DOM
src/sim/layout/   the province's geography
src/sim/finance/  the books, tax, the bank, macro and micro
src/shared/       the exchange format, exports, templates, the workbench's file formats, the sample workspace
src/server/       the engine's server: AI providers, dialogue, the worker pool's jobs, the workspace
src/client/       the app: the province, its analytics, the 3D close-up, and the workbench
src/embed/        the engine for web pages: a live province in a worker
desktop/          the Electron app: main process, menus, the engine's supervisor, packaging
manual/           this manual (MkDocs Material)
docs/             the model description (ODD), the assumptions, the workbench reference, install and release notes
tests/            the test suite
```

## This manual

The manual's source is `manual/` in the repository. Its reference pages are generated from the engine, and the
model description, the assumptions, the changelog and the license are included from the repository at build time,
so they cannot drift from the code:

```bash
bun manual/scripts/reference.ts                                   # regenerate the reference pages
cd manual && uvx --with mkdocs-material mkdocs build --strict     # build it into manual/site/
```
