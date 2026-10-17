# Changelog

## 1.0.0 (2026-10-17)

Community Lab 1.0, as it ships inside Scelo 1.0.1, in the IDE: build your own community, and keep it as a `.sce`.
The mark is C₁.₀.

- **The Community Builder.** The **Build** button opens it on a blank canvas, on **Masakhane** (a small town of
  about forty households to build on), on the built-in province (every building as drawn, to customise), on a
  world you saved, or on a `.sce` file. A library of everything the province is made of (homes, churches,
  schools, clinics, police, courts, councils, shops, banks, workshops, farms, parks, stops, Hyperline stations,
  the airfield); roads, streets lined with plots, settlement and city zones and the Hyperline's guideway; undo
  and redo; a settlement's wealth tier and its own *People here* sliders; live checks that stop a world that
  cannot run and say what a missing place will mean. **Run this world** starts the simulation on it, and the
  analytics, the books, the actuarial workbench, Monte Carlo, the lab and the exports all work on it as on the
  province.
- **Worlds are `.sce` files**, the project file of the Scelo family: **Save** keeps one in the `worlds` folder of
  the lab's data, **Download .sce** and **Open .sce** carry them between machines, and Scelo opens the same file
  as a table of the world's buildings.
- **The engine runs any world.** The province is one atlas among others, and stays bit-identical: deriving its
  own plan gives back the built-in atlas, and a run through that path is the built-in run
  (`tests/plan.test.ts`). An experiment or a pooled export takes the world on screen, and the world's hash goes
  into the assumptions hash, so runs pool only within one world.
- **People** wear their clothes over one another rather than through them, and stand, sit and hold their hands
  as people do.
- **The dashboards cover the stage** while they are open, and with the daylight theme the colours hold steady
  until the drawer closes, so no chart swings with the sim's day and night.
- **A crash** says what happened and offers a reload, instead of a blank window.
- **Security.** The engine answers on this machine's loopback names only, for the page as well as the API, and
  a POST or PUT must be JSON by its media type (a `text/plain` body that mentions JSON no longer passes);
  Gemini's key travels in a header, not the URL.
- Hosted providers default to `claude-haiku-5-5` and `gemini-3.8-flash` when no model is named.

## 0.1.0 (2026-10-04)

The first release of Community Lab as an application of its own: Community Lab IDE, independent of Scelo IDE and
its agent swarm.

- **A desktop app** for Linux (AppImage, .deb), Windows (NSIS) and macOS (Apple Silicon), with the engine bundled:
  Community Lab's server compiled into one executable with its worker pool, started with the app on a loopback
  port of its own (3040; Scelo's bundled copy keeps 3020) and stopped with it.
- **The workbench**, the IDE's second view: a workspace folder, Monaco with JSON schemas for province and
  experiment files generated from the engine, and a run for each kind of file. Province files rebuild the
  province on a seed, a basis, a mortality table and shocks; experiment files run paired experiments on the
  worker pool and keep their results in the workspace; scripts run beside the editor with the engine, the pool
  and the workspace at hand. A Console, a Problems list and a sample workspace.
- **Exports** to CSV, JSON or a folder of the workspace, each with its provenance; a mortality table imported from
  CSV to live the province on. The format stays `scelo.exchange/1`, so Scelo IDE can still read every export.
- The policy and stress lab keeps its results in the workspace; the council of the swarm, which needed Scelo, is
  not part of this app.
- The engine's server refuses requests addressed to any host but this machine's (DNS rebinding) and accepts
  loopback origins only.
