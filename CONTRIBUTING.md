# Contributing to Community Lab IDE

Thanks for taking the time. This covers reporting bugs and concerns, proposing changes, and the terms your
contribution lands under.

## Reporting a bug, a concern, or an issue

| Channel | When to use it |
|---|---|
| [GitHub Issues](https://github.com/intelligentactuaries/community-lab/issues) | Reproducible bugs, feature requests, papercuts. |
| **bugs@scelo.ai** | A report you would rather not have indexed. Same triage, no public trace until we agree. |
| **scelo@intelligentactuaries.com** | General concerns, ethical worries, feedback that isn't a clean bug report. |

What helps a bug get fixed quickly: the version (*Help › About*), your operating system, the smallest set of steps
that triggers it, expected against actual behaviour, a screenshot when it is visual, and the logs (*Help › Show
Logs*) when something crashed. For a result you believe is wrong, say which seed and basis (the basis hash is on
every export) and what you expected and why: the engine is deterministic, so a seed and a basis reproduce it.

Security vulnerabilities go through [SECURITY.md](SECURITY.md), not the tracker.

## Proposing a change

Open an issue first for anything non-trivial, so we can agree on the direction before you write code; send a
typo or a one-line fix straight as a pull request.

```bash
git clone https://github.com/intelligentactuaries/community-lab.git
cd community-lab
bun install
bun run dev            # API :3040, UI :5195
bun run desktop:install && bun run build && bun run desktop:dev
```

Before sending a pull request, `bun run typecheck` and `bun test` must pass. A change to the engine that moves an
outcome should say why, and should leave the calibration where it is unless that is the point: the pooled A/E under
the default basis stays close to 1 and flat by age (`tests/calibration.test.ts`, `docs/ASSUMPTIONS.md`). Anything
that pays or receives money goes through the books (`src/sim/finance/posting.ts`) and survives
`bun scripts/longrun-diag.ts`.

House rules: the theme's tokens, never colours in components; one chart wrapper (`src/client/charts/EChart.tsx`);
no em-dashes in prose the user reads; a number on screen is the engine's or is labelled as an illustration.

## Commit style

Say what changed and why in plain words, as the history does; a subject under 72 characters, the reasons in the
body when the diff does not make them obvious.

## Licensing of contributions

By submitting a contribution (a pull request, a patch, an attachment to an issue) you agree that it is licensed
under the [Scelo IDE Source-Available License v1.1](LICENSE) ("inbound = outbound", Section 9 of the License),
and you grant the Licensor a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to reproduce,
prepare derivative works of, sublicense (including under a Commercial License), publicly display, publicly perform
and distribute it. You represent that you have the right to make the contribution on these terms. There is no
separate CLA: Section 9 of the License is the contract.

## Conduct

Be kind, be specific, and assume the other person is acting in good faith. If a situation needs more than that,
write to **scelo@intelligentactuaries.com**.
