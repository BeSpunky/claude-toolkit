# seam3-wire — Landing 3, the `supabase` layer's verification wiring and docs
Branch feat/hps3-wire, off feat/hps3-core. Written as it goes; newest at the bottom.

## Log
- Upstream check: `tools/supabase-cli/check.mjs`. Only a broken pin fails. A newer release (npm `latest`, not GitHub, which lists betas) and the native runtime's stage (the feature page's data) are notices. In `upstream-tables.yml` and `publish.sh`. `brokenDownloads` moved to `tools/postgres-debs/downloads.mjs`, shared with dbmate's check. Run for real: both downloads match, latest 3.0.0, "Public Alpha".
- Real image job: `supabase-image.sh`, `.inside.sh`, `.launcher.sh`; `image-case.lib.sh` holds what it shares with `postgres-image.sh`. Fake docker cases in `test.sh`. Job `supabase-images`, both architectures.
- Tripwire workflow `supabase-tripwire.yml`: job container, `--user root` for GitHub's steps, the driver via `runuser -u node`. The fragment's OS packages (`procps`, `tar`, `postgresql-client`) by a real `apt-get` step, since the driver stubs apt.
- FOUND, by running the driver under a parent that adopts orphans and reaps nothing (`prctl(PR_SET_CHILD_SUBREAPER)`, in Python, no namespace needed; `unshare` is refused in this devcontainer): 3 of the driver's own checks asked `/proc/<pid>` exists, so they would all have gone red on the first real run. `isRunning` reads the state.
- FOUND the same way, by reading, and a real defect: the keeper's lock asked a holder's pid and start time, and a zombie has both, so a holder killed as an orphan held the lock for good, and every start, stop and reset of that stack waited. Any container with no init. `processStart` says a zombie has no start time. A check in `supabase-launcher.checks.mjs`; a mutant removing the fix fails it.
- After both: 79 checks, all ok, with 63 zombies adopted and unreaped. The stack's stops do not wait on a zombie: the CLI and the keeper's `ownerRunning` (reads the name, which a zombie has none of) hold.
- Rebased onto the finished core (c03873a3). Types and a real function added to the `new-supabase` road and the image probe. The road's project lives under `~/.cache` (removed with the run), and the probe's under `$HOME`, since a tree under /tmp serves no function.
- FOUND: the launcher's SUPABASE_HOME is `XDG_DATA_HOME/supabase`, whatever the environment says. So the road's first "nothing left" check, on SUPABASE_HOME in the command line, watched nothing: a check it now must pass first ("its daemon is in sight") showed that. It now reads each process's environment. The two agree in a real container, where the layer sets the same path and XDG_DATA_HOME is unset; a project that sets XDG_DATA_HOME gets a hand-run `supabase` on another home than the launcher's. Left, named for the orchestrator.
- `supabase status` under Claude Code is agent-shaped unless `--agent no`: the road's key was undefined, a 401. The driver passes it; the road and the probe do now.
- `supabase-image.sh` with real generators and the real inside and launcher probes, only `docker` faked (on this machine, amd64 trixie, real CLI, real stack): every launcher fact as asserted, function included. The findings left were all this machine's and none the image's: the CLI's path, this devcontainer's own postgres and dbmate, SUPABASE_HOME under the scratch cache; and my `launcher.left` awk matching this very shell's command, fixed to the argument.

## Final results, over c03873a3
| What | Final line |
|---|---|
| tools/test-layers | ok: 113 passed, 0 failed |
| tools/test-generators | ok: 452 passed, 0 failed, 35 skipped |
| CI=true tools/test-scaffold/run.sh | all scaffolder tests passed (30 file(s)) |
| tools/check-runner-image/test.sh | PASS |
| tools/test-supabase/run.mjs | all ok: 106 checks; supabase@3.0.0 |
| the same, under a parent that reaps nothing | all ok: 106 checks; supabase@3.0.0; no-reaper: 73 zombies adopted and unreaped at the end |
| tools/check-descriptions, tools/test-tips | ok; all 10 passed |
| dogfood --released=main --only=add-layer-supabase,new-supabase,new-postgres | PASS — 146 passed, 0 failed, 0 skipped in 6m58s |
| tools/check-release-invariants | red, as expected: the bumps are the gate's |

## Only real CI or an account can prove
Real CI: the workflow itself, `runuser` and `actions/cache` in the job container, the real PID 1; the image job on real images: root install, bookworm's glibc, Docker's default /dev/shm, Node 18 running the keeper, all of arm64 and its runtime. Written, faked at the docker boundary, never met an image.
A real account: inherited from seam3-core, untouched: login, link, a real push and function deploy. Nothing hosted was touched here.

## Migrations and persistence
Nothing to migrate from this unit: the keeper is an owned template, the rest is repo tooling. No new tool enters a container.

## Bumps owed
bespunky-house, bespunky-workflow (the reference), @bespunky/nx-tools (the keeper). None made.

## For the orchestrator
1. The launcher's SUPABASE_HOME is XDG_DATA_HOME/supabase, ignoring the env. Agree in a house container; a project setting XDG_DATA_HOME gets a hand-run CLI on another home.
2. Tips name `postgres.mjs` verbs; each was run by the road, the probe or the driver except secrets-set, by a fake only, by design.
3. No Node 16 refusal, as Landing 2 left it.
