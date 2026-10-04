# Changelog

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
