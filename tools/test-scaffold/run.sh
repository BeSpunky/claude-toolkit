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

status=0
for t in "${tests[@]}"; do
  echo "── $t"
  bash "$t" || status=1
done

if [ "$status" -eq 0 ]; then echo "all scaffolder tests passed (${#tests[@]} file(s))"; fi
exit "$status"
