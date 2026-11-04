# Sanity review: Landing 1, neutral seams (2026-11-04)

Mode: fix. Scope: `development...HEAD`, code, tests and docs; research spikes skipped.

## Frame

Landing 1 of three for Postgres and Supabase as house layers: neutral seams with no new layer. Dev engine (`dependency`, `ready`, exports to siblings, `dev run`), platform (`webOnlyImports`, `ensurePlatformFirewall`, drivers, deploy contract), CI (`CiDeployProvider` fields, a blocked unbound line, stage order), installer (`format:'deb'` closures, `tools/postgres-debs`), migrations at 0.52.0, the `firebase:reset` fix, docs.

Decisions not under review: two layers; one server per stack; data under `~/.local/share`; versioned extraction; Supabase on the native runtime; `cli.ts:142` deferred. Decisions under challenge: blocked line for existing Firebase projects; `id-token` removal; `dev run` wrapper; exit 0 after ready fails the stack; stop order; duplicated installer shell; `node:1`; a running stack across an upgrade.

## Lenses

| Id | Lens | Status |
|---|---|---|
| R1 | Engine: correctness, stop and orphan paths, fit for launchers 6a and 6b, tests | returned |
| R2 | Migrations and completeness: rungs against real shapes, lock form, sweep, docs | returned |
| R3 | CI and platform: correctness, architecture, how a blocked line is reported | returned |
| R4 | Installer and generated scripts: container assumptions, security, duplication, `node:1` | returned |

## Findings

Verifiers: V1 (F1-F18) and V2 (E1-E10) ran. A verified lock-file fact: the CLI's lock key is the id as declared with its tag; sort is `localeCompare` on id; `JSON.stringify(t,null,2)+"\n"`; `version` is the manifest's; both digests read from ghcr.io.

### Fixed

| Id | What | Where |
|---|---|---|
| F1 | A bare `{}` key with no adoption record now moves too; options on an unrecorded key are reported | `_utils/devcontainer-feature.ts` `pinHouseFeature` |
| R2.7, R2.8 | A floating tag of the project's is reported; a lock with no pin gets one, in both branches | same |
| F13 | `node:1` to `node:1.7.1`, a rung, the layer test requires an exact tag | `versions.ts`, `0.52.0/pin-node-feature`, `tools/test-layers` |
| R2.6, R2.9 | Comments claiming "installs twice"; the `github-cli` "is exact" line, which misdescribed `gh` | `versions.ts`, rung header, `migrations.json`, `generator.ts:645` |
| F2 | Blocked message names the file, the key, "beside what it names", and the way out | `ci/generator.ts` |
| Item 2 | Losing `id-token` is said once, with the way out; HOUSE.md matches | `ci/generator.ts`, `HOUSE.md.tpl` |
| F6 | An ESLint config under another name logs that no firewall exists, with the snippet | `platform/index.ts` |
| F9, F10 | `requires` documented as never another deploy; `authSteps` documented, fake's step fixed | `deploy-contract.ts`, `descriptor.ts`, `ci-providers.mjs` |
| F15 | The signature is held to PGDG's primary fingerprint | `postgres-debs/closure.mjs`, `project.mjs` |
| F16 | The floating-feature test sees function fragments | `tools/test-layers` |
| F17, R4.7 | Reset refusals tested (no engine, `ps` failing); a non-numeric `PORT_OFFSET` refused. The serve branch (`processes[].id === "emulators"`) still has no case | `emulator-data.sh.tpl`, `emulator-reset.test.sh` |
| F18 | Installer duplication gone (`fetch_checked`, `drop_other_releases`); Firebase's script changes, one image-layer rebuild | `house.packages.sh.tpl` |
| R4.5 | Wrappers before `current`, so a failure is retried | same |
| E2 | A `cmd` probe ends with its answer, with its wait, and with `with`'s `--timeout`. Residue: a hung probe outlives an engine killed outright | `ready.mjs.tpl`, `dev.mjs.tpl` |
| E3 | A child's 130 with no SIGINT at the engine is a crash | `stack.mjs.tpl` |
| E7 | A dependency receives its own exports | `declaration.mjs.tpl` |
| E9 | An old record is refused at once, with the stop command | `dev.mjs.tpl` |
| Lower | Same export name on a non-dependency refused; exit-0 message says what to do | `declaration.mjs.tpl`, `stack.mjs.tpl` |
| E5 | Fd 3 requirement added to 6a | `research/ARCHITECTURE.md` |

### Needs decision

F3 (red line, opt-out); E1 (stop order); E4 (SIGINT to the wrapper alone); F12 (`gh` floats); F4 (two providers, targetless provider); E6 (addressing a `dev run` stack); F14 (image codename), F7 (firewall gains a later stack), F8 (text match deletes the owned workflow), F5 (bare directory watch): owed by Landing 2 at the latest. The report carries the options.

### Corrections to the record

`handoffs/seam-engine.md` says `dev claim` stayed, and that an old `emulators.sh` still works. `536f3a66` removed it. `emulators.sh` is regenerated, so "nothing to migrate" holds. `handoffs/seam-platform.md` says `requires` can state schema-before-code: it cannot (F9). `handoffs/seam-installer.md`'s "not one changed byte" no longer holds for a Firebase project (F18).

### Rejected or left

- F11: no report rung for `dev claim`. Never in the usage or HOUSE.md; a leftover caller fails loudly.
- E8: a keeper needing an owner env var. The Firebase keeper polls its forking script; Landing 3 defines "owner" (`ps --json` or `${DEV_STACK_DIR}.json` are there). No consumer yet.
- E10: 0600 records. `exports` predates this branch, and values come from the committed `dev.json`; a uid sharing the workspace would lose FOREIGN detection.
- R4.6: `.partial` residue, removed by the next install.
- R4.10: a table nothing imports can block a publish: the stated policy.
- `postgres/*` ban colliding with a project of that name: Nx resolves to a graph node first (`externals.ts`, not quoted from Nx source); Landing 2 should avoid a package literally named `postgres`.
- EEXIST from `claimStack`, seen once, not reproduced: unverified, recorded only.

## Not covered

Lenses merged for budget: scalability, clean code and reuse beyond what the four lenses met. No second-round reviewer over the fix diff (budget spent). No real GitHub runner, real `docker build`, or real launcher.

## Verification

After the fixes: `tools/test-migrations` 417, `tools/test-generators` 318 (35 skipped), `tools/test-layers` 107, `tools/test-scaffold` 28 files, `check-descriptions`, `check-script-modes`, `postgres-debs --check` against the real archive, `run-closure` all ok. `check-release-invariants`: bumps owed, as expected. Owed again, since the fixes postdate them: `house.sh upgrade --local .` and `tools/dogfood-consumer`.
