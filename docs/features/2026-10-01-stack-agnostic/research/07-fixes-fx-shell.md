# 07 — Fixes: FX-shell (worktree `sa-fix-shell`, branch `fix/sa-shell`)

Scope: scaffold.sh, the dev engine, shared-browser, worktree-domains, port-claim and the Firebase banner. Items come
from research/06-review-{shell,sane,mig,arch}.md. Each was reproduced first, fixed at the cause, and re-verified.
No version was bumped.

## Outcomes

| item | outcome | where / how |
|---|---|---|
| S1 | fixed | **Root cause:** the outer shell wrote before the rendered program, and its preflight, ran. **Fix:** the restore point is now READ, not made. Preflight refuses dirty trees, so the old dirty-tree tag was reachable only as a write *before* a refusal. A clean HEAD is the restore point. The stray-lockfile cleanup is rendered into the program after `PREFLIGHT_VERDICT`. **Verified** by a real `--sync --yes` on a dirty npm repo with a tracked stray yarn.lock: SYNC_REFUSED, no tag, yarn.lock kept. |
| S2 | fixed | A refusal (stage `refused`, set by the verdict) now prints only its own verdict. Stages `preflight` and `probe` print no restore line. Restore advice is `git restore --source=<sha> --staged --worktree -- .` plus `git clean -n`. It never says `reset --hard`. |
| S3 | fixed | `--print-inner` exits before the sync lock. Every write now lives inside the program, so it runs nothing. |
| S9 | fixed | The rendered program never interpolates `SCAFFOLD_WORK_ROOT`, `SCAFFOLD_ASSETS_ROOT` or `SCAFFOLD_GIT_NAME`/`EMAIL`. They are passed in through `env` (native) or `-e` (docker). **Verified:** a real sync under `o'brien/` succeeded. |
| R3 | fixed | `_sync_next` uses `git diff --relative`. **Verified:** a re-sync of a subdirectory project with `--voice` reported `rebuild-container`. |
| R5 | fixed | In sync mode, a layer that cannot be ensured but is already evident (via `house_layers_evident`) gets a NOTE and is refreshed rather than refused. Hints are rewritten with the host's `$NX_RUN` (`yarn nx`, `npx --no-install nx`, `./nx`). The package-manager and Nx-host resolution moved above validation so the hint can use them. |
| R6 | fixed | `SYNC_OK voice=` is read from `.devcontainer/.bespunky-devcontainer.json`. **Verified:** voice=1 after a `--voice` sync. |
| mig#4 | fixed | Preflight guarantees the tree was clean, so any dirt at migrate time comes from the run itself. The note now says "the toolkit install this run just made is committed first, in the checkpoint commit". `UNCOMMITTED_RECOVERY` is removed. |
| A1 (outer) | fixed | One requirement closure for both modes, built from layers.sh data (`house_layer_requires`, `house_layers_evident`, ensurability). A requirement that is neither ensured nor evident is added to the set and then ensurability-checked. If it fails, the refusal says "the 'firebase' layer requires 'node', which this repo does not have — and a sync cannot create it", with node's hint. All refusals are reported in one verdict, before anything is written. |
| S5 | fixed | The main-module guard compares realpaths. Tested with a symlinked invocation. |
| S6/R2 | fixed | `collectWorktrees` resolves `git rev-parse --show-prefix` onto every worktree path. Tested: the cwd, the slug, and another worktree's subdirectory. |
| S7 | fixed | `isPortFree` binds 127.0.0.1, ::1, 0.0.0.0 and :: (an unsupported family counts as free). Tested with a ::1 listener. |
| S8 | fixed | A child counts as clean only if it exited 0, exited during our stop, or ended by SIGINT/130. An interrupted child now triggers `onGroupStop` (no second signal). Tested: a SIGKILLed child makes the engine exit non-zero. |
| S10 | fixed | `portBlock` no longer throws. `resolvePortOffset` throws `PortError` only when a serve must shift. A bare or empty `--port-offset` is refused. `PortError` is reported plainly. |
| S11 | fixed | `--worktree <x>` accepts the space form. A bare value, or one followed by a flag, still means "pick". |
| F1 | fixed | `cmd_up` releases fd 9 after `up_locked`. Not automated, because it needs the X stack. |
| F6 | fixed | The CLI exports `SB_CDP` and passes `--cdp`. `runtime.mjs` exports `CDP_URL` for the recorder and attach. |
| F2 | fixed | Every routes.json mutation goes through `routes_mutate` under `flock routes.lock`, using a per-writer tmp file. Reconcile probes outside the lock and deletes via `del-if`. Tested: 12 parallel registers keep 12 routes (the old code kept 7). |
| F3 | fixed | Reconcile imports `tools/dev/lib/worktrees.mjs` (`collectWorktrees` + the new `servedSlug`, which the engine uses too). That makes one rule. Tested with `fix/Foo--bar` and a branch name over 70 characters. The old code dropped both. |
| F8 | fixed | `kill_proxy` fails, and keeps the pid file, if our proxy survives. `stop` reports that, or a foreign holder of the port. |
| F4 | fixed | An existing claim is replaced only under a per-port `wx` mutex, re-read under the mutex, and replaced by rename. A held mutex is waited on for up to 2s. An abandoned one ages out after 10s. Tested: 12 racers on a stale claim produce exactly 1 owner. |
| F5 | fixed | `--port`, `--recorded`, `--live` and `--band-start` are checked against 1..65535. The band must fit. |
| F7 | fixed | The profile.d hook is POSIX (`.`), single-quotes `$WS` and passes `BESPUNKY_FIREBASE_WS`. The banner's own lookup is `${BASH_SOURCE:-$0}`, so hooks written before this change still work. Tested under dash and bash with a path containing a space and a quote. |

## Found on the way
- **port-claim suite flake.** The shipped suite's "the SAME container racing itself" case failed about 40% of the time on unchanged code. It never ran in CI, so nobody saw it. **Root cause:** concurrent bind probes read each other as listeners. **Fix:** `localFree` retries a few times with spacing, because a real listener persists across attempts. The suite now runs in CI via `tools/test-scaffold/port-claim.test.sh`.
- **File location.** The F7 defect was in `generators/devcontainer/post-create/firebase-banner.sh.tpl`, not the firebase-emulators file. I edited both, and each change is small.

## Migration question
Every touched output is class A (tools/dev, tools/worktree-domains, tools/shared-browser, tools/port-claim, tools/firebase-welcome.sh, post-create.sh), regenerated by every sync. No path, target or project-state shape changed. dev.json is unchanged. **Nothing to migrate.** Existing containers keep their old profile.d hook until a rebuild. The banner still works with that hook, and sync reports `rebuild-container` because post-create.sh changed.
