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
| seam-ci | feat/hps-ci | dispatched |
| seam-installer | feat/hps-installer | dispatched |
| docs | on the integration branch, by the orchestrator | pending |

## Results
