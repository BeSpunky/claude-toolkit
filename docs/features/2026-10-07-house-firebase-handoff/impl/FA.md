# FA — serve as its own stack; one stack identity; the R3 findings

Fixer FA, branch `feat/house-firebase-handoff--fa`, worktree `hfh-fa`. Findings: `review/R3.md` (all), `review/R9.md`
R9-1. Decision (orchestrator, binding): adopt R3's D1 — `serve` IS the dev engine as a NON-continuous task; `dev-stack`
stays continuous only for e2e; retire serve-preflight, follow-stack, exit records, the follower registry and the /proc
postscript. Written as it happens. Scratch: `scratchpad/fa/`.

## Plan (written before any code)

Units, and who does them:

| id | unit | owner | re-runnable |
| --- | --- | --- | --- |
| A | Nx shape: retire the two executors + `_utils/invoker`/`run-records`; simplify `serve` executor (engine exit = task exit); generator + `_utils/dev-server` (serve = engine non-continuous, dev-stack = continuous mirror); explicit `continuous: false` on the leaf and emulator targets; reshape the two 0.50.0 rungs + their fixtures (inputs from git, `historicalShapes`); test-generators / test-layers expectations | fork (same tree, path boundary below) | yes |
| B | Dev engine: atomic claim (R3-1), `auto` skips claimed blocks, boot id (R3-7), blocking waits (R3-8), `--all-mine` scope (R3-9), `stop --abandon` (R3-3), one identity (D4) | FA | yes |
| C | emulators.sh / reaper: short hashed TMPDIR (R3-2), keeper deadline (R3-3), postscript removed (D2), direct run claims through the engine's record (D4), reaper decides by records (D4) | FA | yes |
| D | Real Nx 23 verification (concurrent serves, exit codes 0/1/130, e2e via dev-stack, agent-mode output); R3-2 two-function proof on a long path | FA, after A–C | yes |
| E | Docs: serve-related text in HOUSE.md.tpl, HOUSE.rules.md.tpl, local-server-isolation | FA | yes |

Path boundary for A: `src/executors/**`, `executors.json`, `src/generators/_utils/dev-server.ts`, `src/generators/serve/**`,
`src/adapters/**` (leaf `continuous`), the target-writing in `src/generators/firebase-emulators/generator.ts` (no `.tpl`),
`src/migrations/0.50.0/{split-serve-follower,stack-owned-dev-processes}*`, `migrations.json`, `tools/test-migrations/cases/0.50.0-{split-serve-follower,stack-owned-dev-processes,recompose-*,lint-house-apps}*`,
`tools/test-generators/**`, `tools/test-layers/**`. FA keeps `src/generators/dev/**`, every `.tpl`, `tools/test-scaffold/**`, docs.

## Ledger

- A: dispatched (fork).
