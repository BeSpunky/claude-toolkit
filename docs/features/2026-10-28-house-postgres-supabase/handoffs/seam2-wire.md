# seam2-wire: the postgres layer's verification wiring (on feat/house-postgres-supabase)

Commits 9f26add7..5840ed64 (mine: 9f26add7, 31140b81, c0ec3e11, 1b944eda, 5840ed64).

## FOR THE ORCHESTRATOR: a real defect, left red on purpose

`dogfood-consumer --only=new-postgres` FAILS, and that is the tool telling the truth. Five rows, one cause.

**On the wrapper host, `dev stop` leaves a seeded app running.** `generators/dev/fragments/nx.ts` seeds `cmd: ["./nx", "run", ...]`, from `nxInvocation().bin` in `_utils/nx-host.ts`. `./nx` is Nx's own bash script, and its last line is `node .nx/nxw.js "$@"`, with no `exec`. The engine signals only the process it spawned (`lib/stack.mjs`), so bash dies on SIGTERM and node survives with its dev-server. Observed: the stop exits 1 ("stopped, but still listening: app=…"), the stack shows `orphaned`, the port stays held, and `./nx serve` hangs on the pipe the survivor holds.

Not specific to Postgres: any served app on a wrapper host. Postgres is stopped correctly; its own process is `node tools/postgres/postgres.mjs serve`. No preset reaches this today, because the house creates apps only with a node host, which is why nothing saw it.

**Tried by hand:** the same project with the seeded `cmd` changed to `["node", ".nx/nxw.js", "run", ...]`: stop exits 0, ports free, serve exits 0, data kept.

**Why it isn't fixed here:** outside my boundary (`generators/dev`, `_utils/nx-host`). Two calls are yours: the shape of the fix (a process-spawn form on the invocation, beside `bin`), and whether a rung is owed for `./nx` in an existing `.bespunky/dev.json`, which seeding never rewrites. A hand-written `./nx` in any declaration has the same trap, and only the engine signalling a group would cover that.

**A second, smaller one, also outside my boundary.** `executors/serve/executor.ts` `silentUnderNx` resolves `nx/package.json` from the workspace root. On a wrapper host Nx lives in `.nx/installation`, so the resolve throws, the function returns false, and the agent guard never fires. `./nx serve` under an agent would block silently, which is what the guard exists to refuse. The node host refuses correctly.

**A limit of the sweep rule, and a sharper neighbour.** The `~/.local` volume is `${localWorkspaceFolderBasename}-local` (`layers/agent.ts`), so it is keyed by the folder's BASENAME: two clones both called `shop` share it, and both mount at the same path. "Parent exists, tree does not" proves removal only when the containers do not share that parent. Here they do: clone A's worktree under `.claude/worktrees/x` is absent from clone B, whose `.claude/worktrees` exists, so B still sweeps A's data. Removing a worktree in one container remains the ordinary, safe case.

The neighbour, from reading only, NOT reproduced: the same two clones hash to the same tree, so to the same cluster. `start` asks `serverOf(data)`, which reads `/proc` and cannot see another container's server, then removes `postmaster.pid` and boots. Two running containers could then have two postmasters on one data directory, and Postgres's own pid-file lock is the guard being removed. That is corruption, not a lost sweep. It needs a decision: a volume key that is not the basename, or a marker of which container owns the cluster.

The reverse: a worktree whose parent is also gone (`.claude/worktrees` removed whole) is kept forever and named on every start. Safe, slightly noisy.

## What was done

1. **Sweep.** `treeState` in `server.mjs.tpl`: `gone` only when the parent is a directory and the tree answers ENOENT. No parent, an unreadable parent, a path under a file, an empty or relative record: `unknown`, kept and named with the directory to remove. Fakes: `postgres-launcher.checks.mjs`. Real binaries: a new scenario staging a tree invisible by moving its parent away; it keeps its data, and its rows are there when it comes back. The removed-worktree scenario still passes.
2. **Tripwire.** `.github/workflows/postgres-tripwire.yml`: weekly, plus pushes to main/development and PRs touching the generator, layer, closures, installer template, dev engine templates and driver. Runs in a `typescript-node:24` job container, because ubuntu-latest has no closure and initdb refuses root: GitHub's steps as root, the driver via `runuser -u node`. `POSTGRES_TOOLS_CACHE` through `actions/cache`. Not in pre-push or any per-push suite.
   - **Departure:** `generators/dev/files/**` is on the path list, beyond the brief. The launcher's contract with the engine (`dev ps --json`, the stop roads) is half of what the driver tests.
3. **Pins.** Every closure pin was already HEADed by `project.mjs --check`, so that stays. dbmate added there, which reaches `upstream-tables.yml` and `publish.sh` with no new wiring: each file fetched whole against its sha256, since a HEAD cannot see a replaced asset. `pinnedDownloads` in `closure.mjs`, tested offline in `tools/test-layers`. Run for real, green; the red path run for real with a bad sha and a bad URL, exit 1, both named.
4. **Dogfood.** New steps `new-postgres`, `new-postgres-node`, `add-layer-postgres`; alias `postgres`. The new roads create the project, add a dev-server app, upgrade so the generators seed `dev.json`, make a migration with the project's own verb, add a seed, and run real `nx serve` on the pinned tools. Data stays under the workdir. Tools come from `tools/test-postgres/tools.mjs`, so `ensureTools` now throws `NoClosureHere` rather than exiting under a caller; a host the closures do not cover is a SKIP that says why.
   - `nx serve` runs with `NX_DEFAULT_OUTPUT_STYLE=stream`, as the executor's refusal says, because this tool is often an agent's.
   - `add-layer-postgres` boots `postgres:start`, not a full serve: that consumer's `web` also needs emulators and Angular. So the generated dependency in that project's `dev.json` was read, not served.
5. **Image.** `tools/check-runner-image/postgres-image.sh` and `.inside.sh`, new job `postgres-images` in `devcontainer-image-e2e.yml`. Cases: 18 on trixie (agent, `base:debian`), 17 on trixie (`typescript-node:24`), 18 and 17 on bookworm (`typescript-node:18`, which is how a project reaches bookworm).
   - **Departure:** the job's matrix also runs `ubuntu-24.04-arm`, beyond the brief. The repo is public and the closures hold arm64.
   - `runner-image-e2e.yml` excludes both scripts from its paths.

## How far each was run

| What | Result |
|---|---|
| `tools/test-layers` | 112 passed, 0 failed |
| `tools/test-generators` | 387 passed, 0 failed, 35 skipped |
| `CI=true tools/test-scaffold/run.sh` | all passed, 29 files |
| `tools/test-postgres/run.mjs` | all ok |
| `tools/check-runner-image/test.sh` | PASS, the new branches included |
| dogfood `--released=main --only=add-layer-postgres` | PASS, 63 passed. Main and this branch are both nx-tools 0.52.2 |
| dogfood `--released=main --only=new-postgres,new-postgres-node` | FAIL, 41 passed, 5 failed: all five are the wrapper-host defect above. `new-postgres-node` is green |
| `postgres-image.inside.sh` on the real cached tools (Postgres 18, trixie, amd64) | every fact as asserted |
| `postgres-image.sh`, real generators, fake docker, all four cases | FROM, major and closure right for each; only the fake's invented closure versions mismatched |
| `tools/check-release-invariants` | red, as expected: the version bumps are the gate's |

## Not proven, and only a real run can

- **The image job has never met a real image.** Real `apt-get satisfy`, root install, major 17 and bookworm by real binaries, arm64: all written, none observed. This devcontainer has no Docker.
- **The tripwire workflow has never run.** `runuser` in the image, `actions/cache` inside a job container, `chown` of the workspace: reasoned, and the YAML parses, no more.
- A rebuild: data and `PSQL_HISTORY` on the real volume. A hosted database. Unchanged.
- The bookworm cases need `typescript-node:18` to stay published.

Closed on amd64 trixie: "generator-seeded served app", on the node host. On the wrapper host it is closed up to the stop.

## Migrations and persistence

Nothing to migrate from this unit: the launcher is an owned template, the rest is repo tooling. No new tool enters a container.

## Docs owed (not written; outside my boundary)

- `CLAUDE.md` commands table: a row for `postgres-image.sh`, and the dogfood row's new steps and the `postgres` alias. The docs unit committed a tripwire CI line (8b026ecc) and may have covered part of this.
- Any doc saying the sweep drops whatever is not visible: the rule is now "removal proven, or kept and named".
- `seam2-core.md`'s last "not proven" line is answered above.

## Second pass: the orchestrator's decisions on the findings above (7fe6e36c, fae801a2)

This supersedes the red dogfood row and "for the orchestrator" above, which stay as the record of what was found.

1. **Wrapper host.** `NxInvocation.spawn` (`['node', '.nx/nxw.js']` / `['node_modules/.bin/nx']`). **Departure from "beside `bin`":** `bin` is removed, not kept: its only two readers (the Nx fragment and the Firebase fragment) moved to `spawn`, so nothing could still use it. HOUSE.md's wrapper part names the trap of a hand-written `./nx`. `silentUnderNx` also resolves from `.nx/installation`; `tools/test-generators/cases/serve-executor.mjs` covers each host.
   - **No rung, by decision:** no preset creates an app on a wrapper host, so no preset-made project holds `./nx`.
   - **Stated against that:** the frozen rung `0.35.0/declare-dev-processes` writes `./nx` for a wrapper host, and an earlier toolkit's seeding did too, so a project that hand-added a dev-server on a wrapper host could hold it. The HOUSE.md line is what such a project gets.
2. **Shared volume.** `<cluster>/owner`: the hostname, its mtime the heartbeat, every 10 s, fresh under 30 s. A fresh one from another host refuses before anything of the cluster is touched, `postmaster.pid` included. A stale one is taken over. The sweep keeps a dir with a fresh one. A clean stop lets go.
   - **Beyond the brief:** a running server whose owner file another host has taken stops and exits 1, since that is the state the file exists to prevent.
   - Fakes in `postgres-launcher.checks.mjs`, one real-binary scenario in `tools/test-postgres`.
3. **Deploy.** Refused first under `CLAUDECODE=1`, whatever `CI` says; HOUSE.md, README and the `new` skill say so. Tested with CI set and unset. It keys on Claude Code's variable only: another agent is held only by the no-terminal refusal.
4. **HUMAN_STEP.** `humanStep` on the provider: `! gh secret set POSTGRES_DEPLOY_URL --env <environment>`, prompting for the value. Printed when the environment first appears or its branches change, once. Flags checked with `gh secret set --help` and `gh api --help`. Never run against a real repository, including the `gh api --method PUT` line it offers for a missing environment.
5. **Docs.** CLAUDE.md rows (image check, dogfood steps, tripwire), sweep and heartbeat wording in HOUSE.md, README and the `new` skill.

### What the heartbeat does not cover

- **An orphan.** A launcher killed outright leaves a server nobody beats for. Another container takes the data over 30 s later, and two postmasters are possible. Needs a same-named checkout, a kill -9 of the launcher and a start elsewhere.
- **Two containers with one hostname** (a fixed `--hostname` in `runArgs`) read as one host.
- **A check-then-write window** between two starts in the same milliseconds. Not atomic.
- **Fresh after a very fast rebuild:** refused until the 30 s pass, and the message says so.
- **Two containers really sharing are observed only by staging:** the other host is a written file, in one container. No test has two real containers.
- The sweep's own limit above stands where no heartbeat runs: a stopped stack in a same-named clone's worktree can still be swept by the other clone.

### Final results

| What | Result |
|---|---|
| `tools/test-layers` | 112 passed, 0 failed |
| `tools/test-generators` | 393 passed, 0 failed, 35 skipped |
| `CI=true tools/test-scaffold/run.sh` | all passed, 29 files |
| `tools/test-postgres/run.mjs` | all ok |
| `tools/check-runner-image/test.sh` | PASS |
| dogfood `--released=main --only=new-postgres,new-postgres-node,add-layer-postgres` | PASS, 107 passed, 0 failed, 0 skipped |

Generator-seeded served app: now closed on both hosts, amd64 trixie. Everything under "Not proven, and only a real run can" still stands.
