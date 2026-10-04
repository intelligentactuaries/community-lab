# Security Policy

Thank you for taking the time to disclose responsibly.

## Reporting a vulnerability

**Please do not file security issues on the public GitHub tracker.** Send a private report to one of these; both
reach the maintainers, and one will reply.

| Channel | Use for |
|---|---|
| **security@intelligentactuaries.com** | Recommended for security disclosures. Reviewed within 5 business days. |
| **bugs@scelo.ai** | If the boundary between "bug" and "vulnerability" is unclear. Reviewed within 5 business days. |

A useful report says which version (*Help › About*), which operating system, what an attacker could read, change
or run, the steps to reproduce it, and whether it needs the user to do something (open a workspace, run a file,
visit a page while the IDE is running).

By default we ask for **90 days** between a report and any public discussion, and will agree a shorter or longer
window for serious issues.

## Scope

- The desktop app (`desktop/`): the main process, the preload bridge, the engine's supervisor, the packaging.
- The engine's server (`src/server/`), including the workspace API, which reads and writes files: path handling,
  the loopback and Host checks, CORS.
- The client (`src/client/`), including the workbench's script runtime and the file formats it runs.
- The sample workspace (`src/shared/sample.ts`).

Out of scope: the third-party pieces it ships (Electron, Chromium, Bun, Monaco, three.js, ECharts) and models or
providers you connect it to; please report those upstream.

A note on scripts: a workbench script is code you run on your own machine, as in any IDE. It runs in a browser
worker with the engine and the workspace API, not with Node or the desktop bridge; a way for a script, or a file
in a workspace, to reach beyond that is in scope.

## What we will do

1. Acknowledge receipt within **5 business days**.
2. Triage and assign a severity.
3. Keep you updated at least every **2 weeks**.
4. Credit you in the release notes for the fixing version, unless you ask us not to.
5. Coordinate the public disclosure with you.

There is no paid bug-bounty programme.

## What we ask in return

Don't access data beyond what is needed to show the issue, don't destroy or exfiltrate data, give us a reasonable
window to fix it before disclosing, and tell us about any third-party tools or services involved in your testing.
