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
| debts-engine | feat/hps2-engine | yes, its own branch | returned |
| core | feat/hps2-core | yes, its own branch | returned |
| wire | tripwire, dogfood boot, image e2e, sweep rule; on this branch | yes | returned, fixes dispatched |
| docs | new skill, README, CLAUDE.md, tips; on this branch | yes | returned |
| review | sanity review | yes | pending |
| gate | upgrade --local, dogfood-consumer, rebuild | yes | pending |

## Results

### debts-ci (returned; feat/hps2-ci ee959331..b037f9f2; spent 0 of 0)
Note on branch: handoffs/seam2-ci.md. F4, F8, F7, F14 done with cases. Nothing to migrate. New payload dep `yaml` (needs proof in a real consumer install: gate). F7 adds a stack-record comment to firewalls so removed bans stay removed. `typescript-node:14` is bullseye, a printed exemption. Not verified: a real GitHub run.
ORCHESTRATOR DECISION: a targeted provider a line does not name stays blocked, consistent with the user's "yes, fail CI"; "name only some" covers targetless and superseded providers only.
Owed: CLAUDE.md commands row.

### debts-engine (returned; feat/hps2-engine 0f224934..317b8721; spent 0 of 0)
Note on branch: handoffs/seam2-engine.md. E1 fixed (serve and `dev stop` name a failed shutdown, exit 1). F5 refused with the glob; `deployTarget(tree, root, spec)`. E6: `dev run` lacked exports, added; `ps --json` documented and tested. 6a bound and fd 3 hold, engine unchanged. Nothing to migrate.
Limit: an orphaned stop cannot report an exit status. Owed docs: the new `dev stop` exit and public `ps --json` in HOUSE.md and CLAUDE.md. Relayed the shape and the signature to core.

### core (returned; feat/hps2-core 0f224934..5b0eb0c9; merges engine and ci; spent 0 of 2)
Note: handoffs/seam2-core.md. Layer, generator, launcher, CI provider, house-doc, tests. Real binaries: cold 810 ms, warm 200 ms; migrate, seed, reset, stop with a client open; kill -9 orphan cleared; foreign identifier refused; hostile .env contained; under dev serve the app starts after the seed, and a failed migration starts nothing. Departures in the note: `binary` archive format, deploy URL by env as POSTGRES_DEPLOY_URL, transaction poolers refused, reset without template clone, seeded mark as COMMENT ON DATABASE, server in its own session, project.json island.
Unproven: rebuild, real apt-get satisfy, major 17 or a major move, arm64, bookworm, real CI, hosted database, generator-seeded served app.
ORCHESTRATOR DECISIONS: (1) keep the human TTY prompt on deploy: an agent cannot walk through it. (2) The sweep must not treat a tree invisible to this container as gone: a deletion must be proven. Drop only when the tree's parent directory exists and the tree does not; otherwise keep and report. Goes to wire. (3) keep dbmate --strict locally: a late-landing older migration fails until re-stamped.

### docs (returned; 76115a8b..8b026ecc interleaved; spent 0)
Note: handoffs/seam2-docs.md. No new skill: HOUSE.md holds the truth. Fixed two wrong claims. Open in code: CI=1 skips the deploy prompt; no HUMAN_STEP for the secret.

### wire (returned; 9f26add7..5aa7a897 interleaved; spent 0)
Note: handoffs/seam2-wire.md. Sweep rule, tripwire workflow (never run), dbmate check, dogfood roads, image job (fake docker only). `new-postgres` dogfood FAILS, 5 rows: on a wrapper host `dev stop` leaves a seeded app running, since `./nx` is bash without `exec`.
ORCHESTRATOR DECISIONS, resumed to wire:
- Wrapper host: seed a spawn form (`node .nx/nxw.js`) beside `bin`. No rung: no preset creates an app on a wrapper host, so no project holds the shape; a hand-written `./nx` is named in HOUSE.md. Fix `silentUnderNx` for the wrapper host in the same change.
- Shared volume: same-named clones share `~/.local`, so one cluster can meet two containers. A heartbeat owner file (host + mtime) beside the data: a fresh one from another host refuses to start and is never swept, and postmaster.pid is left alone. Stale means take over, so a rebuild still recovers.
- Deploy refuses under CLAUDECODE=1, CI=1 or not: a human runs it, or CI.
- HUMAN_STEP names the deploy secret.
- Local verbs do not check the stack's owner: same tree, same data. Left, deliberately.
