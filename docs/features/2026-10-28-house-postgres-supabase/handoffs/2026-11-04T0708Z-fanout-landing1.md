# Fan-out ledger — Landing 1 neutral seams
As-of: 2026-11-04T0708Z · integrating on feat/house-postgres-supabase

## Goal
Implement PLAN.md Landing 1. Firebase behaviour unchanged.

## Shape and budget
Units are independent; each must build and test, so one worktree and branch each, off feat/house-postgres-supabase. The orchestrator rebases them in. Then a sanity review and the gate. Budget 12 (default): 4 implementers with a share of 1 each, 3 reserved. Commits on own branch; re-running means re-dispatch from the branch tip.

## Units
| id | branch | status |
|---|---|---|
| seam-engine | feat/hps-engine | dispatched |
| seam-platform | feat/hps-platform | dispatched |
| seam-ci | feat/hps-ci | returned |
| seam-installer | feat/hps-installer | dispatched |
| docs | on the integration branch, by the orchestrator | pending |

## Results

### seam-ci (returned; feat/hps-ci 99cf06b6, aa177e77; spent 0 of 1)
Note on branch: handoffs/seam-ci.md. CiDeployProvider: targetLabel, deploySignals (required), deployStage, deployEnv, oidc. Unbound line stays wired and blocked: resolve fails every push, HUMAN_STEP each upgrade. Order by one workflow step per stage, not dependsOn (deviates from PLAN: dependsOn would write into a project's own targets). Tests: generators 297/0/35 skipped, layers 103/0, scaffold pass, migrations 392/0. Firebase deploy.yml, setup-gcp.sh, project.json byte-identical; ci.json differs only in about. Nothing to migrate.
TO SURFACE: a Firebase project whose binding names no firebase target goes from a note to a red line; a project with no OIDC provider loses id-token: write. Bump owed: HOUSE.md.tpl and commands/upgrade.md edited. Not observed on real GitHub Actions; no actionlint.
