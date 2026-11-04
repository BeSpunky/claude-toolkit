# Fan-out ledger — Landing 2, `postgres`
As-of: 2026-11-04T1648Z · integrating on feat/house-postgres-supabase (fresh off development at 7a633964)

## Goal
Implement PLAN.md Landing 2 per research/ARCHITECTURE.md and the decisions below. The user approved starting: "yes" to fixing the npm false alarm, then starting on `postgres`.

## Shape and budget
Debts and core touch disjoint files but each must build and test, so a worktree and branch each, off this branch; the orchestrator rebases them in. Then wire (needs core), docs, review, gate.
Budget 12 (default): debts-ci 1, debts-engine 1, core 1+2, wire 1, reviewer 1+5 = 12. No reserve beyond unspent shares; the review shrinks first.

## Decisions for this landing, by the orchestrator (owed items from the Landing 1 review)
- **E6, addressing a `dev run` stack: the launcher owns it.** It reads the engine's public `dev ps --json`, filtered to this tree. No new `dev run --export` flag: one reader, no new engine contract. None running: say which target starts it. More than one in this tree: require --offset and list them.
- **F4, provider shape:** target optional on a provider; one layer can declare it supersedes a required layer's provider (for `supabase` in Landing 3); a line may name only some providers. Each active provider's args reach the deploy, whatever the target's name.
- **F14, image codename: a tripwire and a refusal, no tag migration.** Adopted images pick their own codename anyway, so tags could not settle it. The installer refuses an unknown codename by name; the weekly check fails when an image the house composes moves to a codename with no closure.
- **F7, a firewall gaining a later stack:** `ensurePlatformFirewall` adds missing bans additively for stacks now worn. A rung is still owed when a stack's own list changes.
- **F8:** foreign-pipeline detection reads commands in `run` steps, not any text in the file; the owned workflow is recognised by what the generator wrote.
- **F5:** a bare-directory `watches` is refused with the fix.
- **E1:** a dependent's failed shutdown is reported; "stopped cleanly" only when it was.
- **Major declaration:** `.bespunky/postgres.json` `{ "major": 18 }`, class C, seeded once.

## Units
| id | branch | re-runnable | status |
|---|---|---|---|
| debts-ci | feat/hps2-ci | yes, its own branch | returned |
| debts-engine | feat/hps2-engine | yes, its own branch | dispatched |
| core | feat/hps2-core | yes, its own branch | dispatched |
| wire | tripwire, dogfood boot, image e2e; after core | yes | pending |
| docs | new skill, README, CLAUDE.md, tips; after core | yes | pending |
| review | sanity review | yes | pending |
| gate | upgrade --local, dogfood-consumer, rebuild | yes | pending |

## Results

### debts-ci (returned; feat/hps2-ci ee959331..b037f9f2; spent 0 of 0)
Note on branch: handoffs/seam2-ci.md. F4, F8, F7, F14 done with cases. Nothing to migrate. New payload dep `yaml` (needs proof in a real consumer install: gate). F7 adds a stack-record comment to firewalls so removed bans stay removed. `typescript-node:14` is bullseye, a printed exemption. Not verified: a real GitHub run.
ORCHESTRATOR DECISION: a targeted provider a line does not name stays blocked, consistent with the user's "yes, fail CI"; "name only some" covers targetless and superseded providers only.
Owed: CLAUDE.md commands row.
