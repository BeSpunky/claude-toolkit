# Fan-out ledger — Landing 1 neutral seams
As-of: 2026-11-04T0708Z · integrating on feat/house-postgres-supabase

## Goal
Implement PLAN.md Landing 1. Firebase behaviour unchanged.

## Shape and budget
Units are independent; each must build and test, so one worktree and branch each, off feat/house-postgres-supabase. The orchestrator rebases them in. Then a sanity review and the gate. Budget 12 (default): 4 implementers with a share of 1 each, 3 reserved. Commits on own branch; re-running means re-dispatch from the branch tip.

## Units
| id | branch | status |
|---|---|---|
| seam-engine | feat/hps-engine | returned |
| seam-platform | feat/hps-platform | returned |
| seam-ci | feat/hps-ci | returned |
| seam-installer | feat/hps-installer | returned |
| finish | docs, firewall rung, leftovers, on the integration branch | returned |
| review | sanity review of the whole landing | returned |
| gate | upgrade --local + dogfood-consumer | dispatched |

## Results

### seam-ci (returned; feat/hps-ci 99cf06b6, aa177e77; spent 0 of 1)
Note on branch: handoffs/seam-ci.md. CiDeployProvider: targetLabel, deploySignals (required), deployStage, deployEnv, oidc. Unbound line stays wired and blocked: resolve fails every push, HUMAN_STEP each upgrade. Order by one workflow step per stage, not dependsOn (deviates from PLAN: dependsOn would write into a project's own targets). Tests: generators 297/0/35 skipped, layers 103/0, scaffold pass, migrations 392/0. Firebase deploy.yml, setup-gcp.sh, project.json byte-identical; ci.json differs only in about. Nothing to migrate.
TO SURFACE: a Firebase project whose binding names no firebase target goes from a note to a red line; a project with no OIDC provider loses id-token: write. Bump owed: HOUSE.md.tpl and commands/upgrade.md edited. Not observed on real GitHub Actions; no actionlint.

### seam-platform (returned; feat/hps-platform 4e8cf02a..7b5ac25c; spent 0 of 1)
Note on branch: handoffs/seam-platform.md. StackAdapter.webOnlyImports, workspaceStacks(tree), ensurePlatformFirewall(tree, who), _utils/deploy-contract.ts deployTarget(root,{command,inputs,watches,requires?,gates?}). Banned: pg, pg-native, pg-pool, pg-cursor, pg-query-stream, pg-promise, postgres, slonik. Tests: generators 293/0/35 skipped, layers 103, scaffold pass, migrations 392. Firebase fixtures 157/161 identical; 4 eslint configs differ by 1 neutral comment and 16 ban lines. Real eslint and nx affected checked; a bare directory input is silently missed, so the contract requires a file or glob. 0 files change re-running over old output.
Departures: firewall.ts:76-84 left (LEGACY_COMMENTS, matched for deletion); runtime watchedFiles not extracted (no second caller).
ORCHESTRATOR DECISION: existing firewalls never gain the driver bans, so a rung ships with the Landing 1 release: adds the bans additively, log says a lint failure it causes is a real leak. Not deferred to Landing 2 (no-deferred-gaps).
Owed: HOUSE.md.tpl:29,249 describes the firewall only under {{#firebase}}. ensurePlatformFirewall no-ops without a root ESLint config: Landing 2 must say so. Not run: upgrade --local, dogfood, publish dry-run, 35 skipped cases.

### seam-installer (returned; feat/hps-installer 0eba0ba3, 5c5c906e; spent 0 of 1)
Note on branch: handoffs/seam-installer.md. ArchiveTool = TarballTool | DebClosureTool (format deb, id, bin, libraryPaths, prune?, closures by codename: version, systemDepends, packages by arch). generators/_utils/postgres-closures.ts, 32 pins as of 2026-11-04, --check OK; weekly + pre-publish. tools/postgres-debs/{project,run-closure}.mjs. Tests: layers 106/0, generators 282/0/35 skipped, scaffold pass. Rendered devcontainer files byte-identical for agent, web, firebase, firebase+web. Real run unprivileged with apt-get and sudo stubbed: 26 ok; trixie 17 and 18 ran, bookworm extracted only. Nothing to migrate.
Unproven until a user rebuild: root dpkg-deb -x then running as remote user; real apt-get satisfy on both base images; real bookworm; arm64; post-create on an adopted image through real sudo.
For Landing 2: prune usr/lib/postgresql/<major>/bin/pg_config. For docs: name tools/postgres-debs in CLAUDE.md. About 10 lines of shell shared by the two installers, kept for byte-identity: reconsider at review.

### seam-engine (returned; feat/hps-engine 795f6ac1..5cb4d52a; spent 0 of 1)
Note on branch: handoffs/seam-engine.md. `dependency: true`; ready {http | tcp:<port name> | cmd, timeout}; exports reach siblings and dev with; a process's own env wins. `dev run <app> --ports=… [--label] -- <cmd>`. lib/ready.mjs. Gate asks LAYERS who lists the dev step. Tests: scaffold 27 files 755 ok, generators 287/0/35 skipped, layers 103, real firebase-tools through emulators.sh by hand. Nothing to migrate; a stack left running across an upgrade makes `dev with` wait out its timeout.
To check: dev claim has no generated caller; dependency exit 0 after ready fails the stack; stop signals dependents and dependencies together. Bump owed: bespunky-workflow too. Not verified: real nx serve above the wrapper, dogfood, upgrade --local, a real launcher.

Integrated: all four rebased clean onto feat/house-postgres-supabase and fast-forwarded; unit worktrees removed.

### Interruption
VS Code died during `finish`. On resume: rung and dev claim removal committed; firebase:reset work uncommitted in the tree; no processes left. `finish` resumed from its transcript. Outstanding: items 3-5 of finish, then review, then gate.

### finish (returned; 99204721, 536f3a66, 59d58e6a, 71940bcd, 8c24de51, c2f05b1c; spent 0 of 1)
Two rungs at 0.52.0: ban-postgres-drivers-from-web; pin-github-cli-feature (a migration was owed, so the plan's expected "nothing to migrate" was wrong for this landing). dev claim removed. firebase:reset real, three faults, fixed; test uses a fake firebase; export-over-reset reproduced only after the fix. Whole tree: migrations 412, generators 315/35 skipped, layers 107, scaffold 28 files, no interplay failure. Invariants owe bespunky-house, bespunky-workflow; keep the payload bump last at release. Open: node:1 still floats within v1; lock key form and order for the rung from memory; 35 skipped cases.

### review (returned; ledger reviews/2026-11-04-landing1-sanity-review.md)
Fixes committed. Tests after fixes: migrations 417, generators 318/35 skipped, layers 107, scaffold 28 files. Three batons now out of date, noted in the review ledger. Not covered: scalability, clean code, reuse in depth; no second reviewer over fixes; real GitHub runner, docker build, real launcher, bookworm run.
