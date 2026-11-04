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
| seam-platform | feat/hps-platform | returned |
| seam-ci | feat/hps-ci | returned |
| seam-installer | feat/hps-installer | dispatched |
| docs | on the integration branch, by the orchestrator | pending |

## Results

### seam-ci (returned; feat/hps-ci 99cf06b6, aa177e77; spent 0 of 1)
Note on branch: handoffs/seam-ci.md. CiDeployProvider: targetLabel, deploySignals (required), deployStage, deployEnv, oidc. Unbound line stays wired and blocked: resolve fails every push, HUMAN_STEP each upgrade. Order by one workflow step per stage, not dependsOn (deviates from PLAN: dependsOn would write into a project's own targets). Tests: generators 297/0/35 skipped, layers 103/0, scaffold pass, migrations 392/0. Firebase deploy.yml, setup-gcp.sh, project.json byte-identical; ci.json differs only in about. Nothing to migrate.
TO SURFACE: a Firebase project whose binding names no firebase target goes from a note to a red line; a project with no OIDC provider loses id-token: write. Bump owed: HOUSE.md.tpl and commands/upgrade.md edited. Not observed on real GitHub Actions; no actionlint.

### seam-platform (returned; feat/hps-platform 4e8cf02a..7b5ac25c; spent 0 of 1)
Note on branch: handoffs/seam-platform.md. StackAdapter.webOnlyImports, workspaceStacks(tree), ensurePlatformFirewall(tree, who), _utils/deploy-contract.ts deployTarget(root,{command,inputs,watches,requires?,gates?}). Banned: pg, pg-native, pg-pool, pg-cursor, pg-query-stream, pg-promise, postgres, slonik. Tests: generators 293/0/35 skipped, layers 103, scaffold pass, migrations 392. Firebase fixtures 157/161 identical; 4 eslint configs differ by 1 neutral comment and 16 ban lines. Real eslint and nx affected checked; a bare directory input is silently missed, so the contract requires a file or glob. 0 files change re-running over old output.
Departures: firewall.ts:76-84 left (LEGACY_COMMENTS, matched for deletion); runtime watchedFiles not extracted (no second caller).
ORCHESTRATOR DECISION: existing firewalls never gain the driver bans, so a rung ships with the Landing 1 release: adds the bans additively, log says a lint failure it causes is a real leak. Not deferred to Landing 2 (no-deferred-gaps).
Owed: HOUSE.md.tpl:29,249 describes the firewall only under {{#firebase}}. ensurePlatformFirewall no-ops without a root ESLint config: Landing 2 must say so. Not run: upgrade --local, dogfood, publish dry-run, 35 skipped cases.
