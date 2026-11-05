# Fan-out ledger — Landing 3, `supabase`
As-of: 2026-11-04T2221Z · integrating on feat/house-postgres-supabase (fresh off development at 6fa83bb3)

## Goal
Implement PLAN.md Landing 3 per research/ARCHITECTURE.md (6b, decision 9) and research/supabase.md. Asked whether to start, and whether a real Supabase project exists to test against or will be created, the user answered: "yes". So: start. Which project is still open, and is asked at the gate.

## Shape and budget
Budget 12 (default): core 1+2, wire 1, reviewer 1+5, correctness pass 1 = 11, reserve 1. Worktree per unit off this branch. Core first; wire needs it.

## Decisions by the orchestrator
- Keeper owner (E8, left open by Landing 1): the keeper holds the dev engine's lock and polls the owner, by `dev ps --json`, the public shape.
- `supersedes` is how supabase replaces postgres's CI provider. Deploy secret per environment with static literal references, as postgres does.
- Reuse the launcher's addressing, identity, URL and deploy rules; a provider port, not a second launcher. Lessons from Landing 2 are binding: real CI runs before landing, real binaries before claims.
- A failing test stops the commit: never chain a commit past one.

## Units
| id | branch | re-runnable | status |
|---|---|---|---|
| core | feat/hps3-core | yes, its own branch | returned |
| wire | tripwire, dogfood, image job, docs; feat/hps3-wire | yes | returned |
| docs | with wire | yes | returned |
| review | sanity review | yes | dispatched |
| gate | push + PR green, upgrade --local, dogfood, rebuild, real hosted project | yes | pending |

## Results

### core (returned; feat/hps3-core 72bb7ce1..58ceb272, trace handoffs/seam3-core.md; spent 0 of 2)
Layer, provider port, keeper with lock, detached reset, config.toml line edits, folder move, preflight, CI provider, house docs, `avoidPorts` in the engine. CLI 3.0.0, still latest. Real runs: every 6b rule, kill -9 and adoption, real serve, worktree, new and add-layer. test-supabase 79; layers 113; generators 451, 35 skipped; migrations 417.
Departures: blocks avoid 10000-32767 (the runtime refuses 10000-19999); identity is data_directory + port, since system_identifier changes on reset; reset only with migrations, no ledger, no public tables; one stack per tree; dead trees' data named, not removed; keeper polls owner.json; Debian postgresql-client stays; no .mcp.json, official plugin not enabled, start prints a local `claude mcp add`; types, secrets, functions unbuilt.
ORCHESTRATOR DECISIONS: accept blocks in the ephemeral range, clashes are loud. Secret stays POSTGRES_DEPLOY_URL_<ENV>. Amend ARCHITECTURE with departures 1-3, additively. Item 9 is not left out: ARCHITECTURE's shape names types, secrets and functions, and the mission is "correctly and officially". Resumed to core.

### core, item 9 (returned; 58ceb272..c03873a3)
Targets `postgres:gen-types`, `new-function`, `secrets-set`. Types real, class C `.bespunky/supabase.json`. Functions class C, served by the stack, proven by real calls; deploy follows schema, refused under an agent. Secrets through a verb, value by stdin; real CLI against a fake local API. Limits: under /tmp 404, under node_modules BOOT_ERROR, a value with all three quote kinds or a line break refused. Needs an account: real upload, a secret reaching a function, token scopes.
Wire must rebase on c03873a3.

### wire and docs (returned; c03873a3..00099713, trace handoffs/seam3-wire.md)
Tripwire workflow; a non-reaping parent showed a real bug, a zombie holding the stack lock forever, fixed. Image job against fake docker, with the real probes run here. Upstream check tools/supabase-cli/check.mjs. Dogfood roads green, with gen-types and a real function: 146 passed. Docs and tips. Never run: CI workflows, real images, bookworm, arm64; real account flows. Limit: SUPABASE_HOME is always XDG_DATA_HOME/supabase; a project setting XDG_DATA_HOME gets a hand-run CLI on another home. Stated in HOUSE.md by the review if not already.
