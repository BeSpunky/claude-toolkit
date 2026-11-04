# seam3-wire — Landing 3, the `supabase` layer's verification wiring and docs
Branch feat/hps3-wire, off feat/hps3-core. Written as it goes; newest at the bottom.

## Log
- Upstream check: `tools/supabase-cli/check.mjs`. Only a broken pin fails. A newer release (npm `latest`, not GitHub, which lists betas) and the native runtime's stage (the feature page's data) are notices. In `upstream-tables.yml` and `publish.sh`. `brokenDownloads` moved to `tools/postgres-debs/downloads.mjs`, shared with dbmate's check. Run for real: both downloads match, latest 3.0.0, "Public Alpha".
- Real image job: `supabase-image.sh`, `.inside.sh`, `.launcher.sh`; `image-case.lib.sh` holds what it shares with `postgres-image.sh`. Fake docker cases in `test.sh`. Job `supabase-images`, both architectures.
- Tripwire workflow `supabase-tripwire.yml`: job container, `--user root` for GitHub's steps, the driver via `runuser -u node`. The fragment's OS packages (`procps`, `tar`, `postgresql-client`) by a real `apt-get` step, since the driver stubs apt.
- FOUND, by running the driver under a parent that adopts orphans and reaps nothing (`prctl(PR_SET_CHILD_SUBREAPER)`, in Python, no namespace needed; `unshare` is refused in this devcontainer): 3 of the driver's own checks asked `/proc/<pid>` exists, so they would all have gone red on the first real run. `isRunning` reads the state.
- FOUND the same way, by reading, and a real defect: the keeper's lock asked a holder's pid and start time, and a zombie has both, so a holder killed as an orphan held the lock for good, and every start, stop and reset of that stack waited. Any container with no init. `processStart` says a zombie has no start time. A check in `supabase-launcher.checks.mjs`; a mutant removing the fix fails it.
- After both: 79 checks, all ok, with 63 zombies adopted and unreaped. The stack's stops do not wait on a zombie: the CLI and the keeper's `ownerRunning` (reads the name, which a zombie has none of) hold.
