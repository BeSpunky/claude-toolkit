---
summary: One command, `yarn test`, runs every toolkit check that can run where it is started, names each one it skipped with the reason, and never reports a pass when nothing ran.
status: live
---

# One test command

Package 1 of the initiative: `tools/test-suites/suites.json` is the one declared list of the toolkit's suites (command, owning
Nx project, needs); `tools/test-suites/run.mjs` is the runner behind the root `test` script. Its format and how each need is
judged met are in `tools/test-suites/README.md`. Packages 2 (Nx `test` targets derived from the same list) and 3 (documents)
follow.

## Decisions

- **One list, everything derived.** A suite's command appears only in `suites.json`; the runner, `--list`, `--project` and the test all read it. The runner's test fails when a `tools/test-*` or `tools/check-*` directory with a runnable entry is neither declared nor excluded.
- **Needs are observed, not assumed.** `workspace` = nx and `@bespunky/nx-tools` present in `node_modules`; `network` = registry.npmjs.org answers an HTTPS request now (through `HTTPS_PROXY` when set); `docker` is never met, so Docker-only checks are named and skipped.
- **A skip is never a pass.** A list whose every suite is skipped exits non-zero.
- **Suites run one at a time** (test-voice and test-scaffold are not safe in parallel). Their output is prefixed `  | ` so only the runner prints `failed:` lines.
- **check-runner-image is split:** `test.sh` runs against a fake docker, so it needs nothing and runs; the five scripts that need a real engine are declared as `docker`.

## Known pre-existing failure: check-release-invariants

`check-release-invariants` fails on its own, at the base commit ec7a41ea as well as here: `bespunky-house` and `@bespunky/nx-tools` changed with no version bump. It is a known failure awaiting a release decision (Shy's), not something this effort introduced. The check is not excluded, weakened or skipped. Every other runnable suite passes.

Shy's later answer: "Bump the versions now" (patch: bespunky-house 0.54.2 to 0.54.3, nx-tools 0.56.1 to 0.56.2; no publish, no promotion). That bump is its own small change, made after Ada grants the manifest paths on the contract. When it lands, `yarn test` is re-run on the final commit and recorded here.

## Record

`runs/2026-11-26-yarn-test.txt`: the whole output of `yarn test` on 2026-11-26 against commit d0770ac7: exit 1, only `check-release-invariants` failed, test-firebase-tools, test-postgres, test-supabase and test-angular-ts-solution skipped for the network, the five Docker checks skipped for Docker.

## Package 2: Nx `test` targets

`tools/nx-test-suites/plugin.js` (registered in `nx.json` `plugins`) infers a `test` target for every project that owns a suite in `suites.json`; it runs `node tools/test-suites/run.mjs --project=<name>`. `cache: false`, and the old `targetDefaults.test.cache: true` was removed from nx.json because a target default would override the inferred value. `parallelism: false`, since the suites are not safe side by side. No project.json changed. Its test: `tools/nx-test-suites/test/run.mjs` (declared in suites.json as `test-nx-test-suites`).

Runs on 2026-11-26 against commit 4301209d (the plugin and the list entry; this docs commit follows it):
- `yarn nx test bespunky-house`: exit 1, output in `runs/2026-11-26-nx-test-bespunky-house.txt`. Only check-release-invariants failed, and it also fails on its own (exit 1 from `node tools/check-release-invariants/check.mjs`). The item 4 check command exits 0.
- `node tools/nx-test-suites/test/run.mjs`: exit 0, output in `runs/2026-11-26-nx-test-suites-test.txt`.

Known failure: check-release-invariants, waiting for the version bump Shy approved. It is not excluded, skipped or weakened.
