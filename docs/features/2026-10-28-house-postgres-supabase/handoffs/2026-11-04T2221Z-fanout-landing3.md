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
| core | feat/hps3-core | yes, its own branch | dispatched |
| wire | tripwire, dogfood, image job | yes | pending |
| docs | with wire | yes | pending |
| review | sanity review | yes | pending |
| gate | push + PR green, upgrade --local, dogfood, rebuild, real hosted project | yes | pending |

## Results
