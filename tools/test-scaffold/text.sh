# tools/test-scaffold/text.sh — sourced by the scaffolder tests; defines in_text.
#
# in_text TEXT GREP-ARGS...   grep captured TEXT, e.g. `in_text "$out" -q 'UPGRADE_REFUSED'`.
#
# Why not `printf '%s\n' "$out" | grep -q …`: grep -q exits at its first match and
# closes the pipe; if printf is still writing, it dies of SIGPIPE ("printf: write
# error: Broken pipe"), and under `set -o pipefail` the whole check then reads as
# FAILED although the text matched. Whether printf is still writing depends on the
# output's size and the scheduler, so the test fails at random (CI on main, d5f4a72).
# A here-string has no writer to kill.
in_text() {
  local text=$1
  shift
  grep "$@" <<<"$text"
}
