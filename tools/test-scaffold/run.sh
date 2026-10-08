#!/usr/bin/env bash
# Run every scaffolder behaviour test in this directory.
#
# Globs `*.test.sh` rather than listing them, so adding a test is adding a file — no second place to update,
# and no way to add one that silently never runs. Adding a test therefore needs no edit to the workflow or to
# this script.
#
# NEVER PASSES VACUOUSLY. If the glob matches nothing, that is a broken checkout or a moved directory, not a
# green run — the same reason the release checker refuses a shallow clone instead of reporting success.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

shopt -s nullglob
tests=( *.test.sh )

if [ "${#tests[@]}" -eq 0 ]; then
  echo "FATAL: no *.test.sh files found in $(pwd) — refusing to report success." >&2
  exit 2
fi

# The machine's git config must not decide a result. CI's runner defaults new repos to `master`, a developer's
# machine often to `main` — a test that leaned on that passed locally and failed in CI (0.50.0). So every test
# here runs with a default branch name nobody uses: anything that only works because of the machine's default
# fails HERE, first. (Tests that need a branch name pass `-b` explicitly, as fixtures should.)
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=not-a-default-branch

status=0
for t in "${tests[@]}"; do
  echo "── $t"
  bash "$t" || status=1
done

if [ "$status" -eq 0 ]; then echo "all scaffolder tests passed (${#tests[@]} file(s))"; fi
exit "$status"
