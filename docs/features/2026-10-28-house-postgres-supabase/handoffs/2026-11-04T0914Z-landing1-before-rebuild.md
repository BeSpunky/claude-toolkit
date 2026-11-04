# Handoff — Landing 1, before the container rebuild
As-of: 2026-11-04T0914Z · branch feat/house-postgres-supabase · HEAD d45be2c1 · .claude/worktrees/house-postgres-supabase
Working tree: this baton and the ledger line.

## Goal
Land Landing 1 of PLAN.md (neutral seams for the Postgres and Supabase layers) on development.

## Current state
- Done (verified): seams, rungs, review and its fixes, rebase, suites, upgrade --local, dogfood-consumer.
- In progress: rebuild from chore/hps-gate (worktree .claude/worktrees/hps-gate): its .devcontainer is the upgraded one; package.json and the lockfile deliberately stay at the released toolkit, since 0.52.0 is unpublished and an install would fail.
- Not started: plugin bumps, payload bump last, the landing.

## Next actions
1. After the rebuild observe: `gh --version` and `which -a gh`; `.devcontainer/house.packages.sh` ran clean; `claude` first on PATH; logins survived.
2. Back to development in the checkout; delete chore/hps-gate and its worktree.
3. Ask the user about F3 (red line on existing Firebase projects; DECISION.md) at the landing gate.
4. nx release version for bespunky-house and bespunky-workflow; payload version stays 0.52.0, keep its bump commit last so check-release-invariants passes; `plan land`; signal.

## Decisions & roads not taken
In DECISION.md and research/ARCHITECTURE.md. Landing 2's owed items are in PLAN.md.

## Corrections the user made this session
| Kind | What was corrected | Why | Corrected behavior | Scope |
| process | Stopped the resume before implementing | Wanted research first | Research Postgres, Supabase and the Firebase history before building | task-local |

## Verification state
- Proven: as above. Closure root install is NOT proven by this rebuild: no layer wears a closure until Landing 2, so that rebuild still owes it.
- Assumed: real GitHub Actions behaviour of the blocked line and stages.

## Open questions
F3 at the landing gate.

## Anchors
reviews/2026-11-04-landing1-sanity-review.md · handoffs/2026-11-04T0708Z-fanout-landing1.md · PLAN.md
