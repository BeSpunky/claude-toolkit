#!/usr/bin/env bash
# The engine's COMMAND LINE: `house.sh new | upgrade | add-layer | help`, and the deprecated scaffold.sh shim.
#
# WHAT THIS GUARDS. Each command's name says what it does (docs/features/2026-10-03-house-plugin-rename/
# DECISION.md), and that only stays true while the parser enforces it: `upgrade` must never quietly bring a layer
# into being, `add-layer` must always be told which, and the old spellings (`--sync`, `--ensure`, a bare path) must
# be answered with the commands that exist rather than half-understood. The shim is the other half: every HOUSE.md
# generated before the rename prints `scaffold.sh --sync`, so a translation regression breaks every such project's
# documented upgrade, silently, far from here.
#
# NOTHING HERE RUNS A REAL RUN. Every accepted invocation carries --print-inner (render, run nothing), and `new`
# is pointed at an empty PROJECTS_DIR; every refusal fires before anything is read from the project.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/text.sh"  # in_text: grep captured output without a SIGPIPE race
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOUSE_SH="$ROOT/plugins/house/engine/house.sh"
SHIM="$ROOT/plugins/house/engine/scaffold.sh"
[ -f "$HOUSE_SH" ] || { echo "FATAL: house.sh not found at $HOUSE_SH" >&2; exit 2; }
[ -f "$SHIM" ] || { echo "FATAL: scaffold.sh (the shim) not found at $SHIM" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export PROJECTS_DIR="$TMP/projects"
mkdir -p "$PROJECTS_DIR"

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

# A node-hosted project the outer script accepts (git repo, one commit, package.json) — firebase is addable here.
P="$TMP/proj"
mkdir -p "$P"
printf '{ "name": "proj", "private": true }\n' > "$P/package.json"
printf '{}\n' > "$P/nx.json"
git -C "$P" init -q -b main && git -C "$P" add -A && git -C "$P" commit -qm init

# run <args…> — sets OUT (stdout), ERR (stderr) and RC.
run() { local _o="$TMP/o" _e="$TMP/e"; RC=0; bash "$@" >"$_o" 2>"$_e" || RC=$?; OUT="$(cat "$_o")"; ERR="$(cat "$_e")"; }
# refused <label> <expected stderr text> <args…>
refused() {
  local label="$1" want="$2"; shift 2
  run "$HOUSE_SH" "$@"
  if [ "$RC" -ne 0 ] && in_text "$ERR" -qF -- "$want"; then ok "$label"
  else fail "$label (rc=$RC): $(printf '%s' "$ERR" | head -3 | tr '\n' ' ')"; fi
}
# renders <label> <expected ENSURED> <args…> — accepted, a program rendered, with this ensure set.
renders() {
  local label="$1" want="$2"; shift 2
  run "$HOUSE_SH" "$@"
  if [ "$RC" -eq 0 ] && in_text "$OUT" -q "^ENSURED='$want'$"; then ok "$label"
  else fail "$label (rc=$RC, ENSURED=$(in_text "$OUT" -m1 '^ENSURED=' || echo none)): $(printf '%s' "$ERR" | tail -2 | tr '\n' ' ')"; fi
}

echo "── the command comes first, and only the real ones are understood"
refused "no command: usage + an error"                 "no command given"
refused "an unknown command is named"                  "unknown command 'deploy'"          deploy "$P"
refused "--sync is not a command"                      "unknown command '--sync'"          --sync --yes "$P"
refused "a bare path is not a command"                 "new | upgrade | add-layer | help"  "$P"
refused "--ensure is not a flag of new"                "unknown flag '--ensure=agent'"     new --print-inner --ensure=agent x
for h in help --help -h; do
  run "$HOUSE_SH" "$h"
  if [ "$RC" -eq 0 ] && in_text "$OUT" -qF 'house.sh add-layer [flags] <layers>'; then ok "'$h' prints the usage"
  else fail "'$h' does not print the usage (rc=$RC)"; fi
done
run "$HOUSE_SH" upgrade --help
[ "$RC" -eq 0 ] && in_text "$OUT" -qF 'house.sh upgrade' && ok "'upgrade --help' prints the usage" || fail "'upgrade --help' (rc=$RC)"

echo "── upgrade adds no layer"
for f in --add-layer=agent --preset=angular --firebase; do
  refused "upgrade refuses $f, naming add-layer"       "house.sh add-layer"                upgrade --yes "$f" "$P"
done
refused "upgrade refuses the space form too"           "does not take --add-layer"         upgrade --add-layer agent "$P"
refused "--staging on upgrade names the firebase layer" "requires the firebase layer"      upgrade --print-inner --yes --staging "$P"
renders "upgrade renders, ensuring only the floor"     "nx"                                upgrade --print-inner --yes "$P"

echo "── add-layer takes its layers first"
refused "add-layer with nothing"                        "needs the layers to add AND the project" add-layer
refused "add-layer with only one positional"            "got only 'agent'"                 add-layer agent
refused "add-layer --preset without layers: the list is always required" "always required, --preset or not" add-layer --yes --preset=angular "$P"
renders "add-layer --preset + layers: they union"       "nx,agent,firebase" add-layer --print-inner --yes --preset=agent firebase "$P"
refused "add-layer with an empty list"                  "empty layer list"                 add-layer '' "$P"
refused "add-layer refuses --add-layer"                 "first positional, not --add-layer" add-layer --add-layer=agent agent "$P"
refused "an unknown layer is refused"                   "unknown layer 'bogus'"            add-layer --yes bogus "$P"
refused "a flag after the layers is caught"             "comes AFTER a positional"         add-layer agent --yes "$P"
refused "a flag after the path is caught"               "comes AFTER a positional"         upgrade "$P" --yes
refused "too many positionals"                          "too many arguments"               add-layer agent "$P" app extra
renders "add-layer agent"                               "nx,agent"                         add-layer --print-inner --yes agent "$P"
renders "add-layer --firebase = the firebase layer"     "nx,firebase"                      add-layer --print-inner --yes --firebase firebase "$P"
# The generated HOUSE.md advises exactly this for the staging bundle — it must be accepted.
renders "add-layer --staging firebase"                  "nx,firebase"                      add-layer --print-inner --yes --staging firebase "$P"

echo "── new: layers by preset and --add-layer"
renders "new --add-layer=nx,agent"                      "nx,agent"                         new --print-inner --add-layer=nx,agent newp
renders "new --add-layer node (space form)"             "nx,agent,node"                    new --print-inner --add-layer agent,node newp
refused "new --add-layer swallowing a flag"             "--add-layer needs a comma-separated layer list" new --print-inner --add-layer --yes newp
renders "new --preset=angular --firebase --staging"     "nx,agent,node,web,angular,design-system,firebase" new --print-inner --preset=angular --firebase --staging newp shop
[ -z "$(ls -A "$PROJECTS_DIR")" ] && ok "nothing was created under PROJECTS_DIR" || fail "a render created a project"

echo "── scaffold.sh: the deprecated shim translates and hands over"
[ -x "$SHIM" ] && ok "the shim is executable" || fail "the shim is not executable"
# shim <label> <expected new form> <expected ENSURED> <old args…>
shim() {
  local label="$1" want="$2" ens="$3"; shift 3
  run "$SHIM" "$@"
  local _notes; _notes="$(in_text "$ERR" -c '^NOTE: scaffold.sh is deprecated')" || true
  if [ "$RC" -eq 0 ] && [ "$_notes" = "1" ] && in_text "$ERR" -qF -- "this is now: house.sh $want" \
     && in_text "$OUT" -q "^ENSURED='$ens'$"; then ok "$label"
  else fail "$label (rc=$RC, notes=$_notes): $(in_text "$ERR" -m1 'deprecated' || printf '%s' "$ERR" | head -2 | tr '\n' ' ')"; fi
}
shim "--sync → upgrade"                     "upgrade --yes --print-inner $P"           "nx"        --sync --yes --print-inner "$P"
shim "--sync --ensure=X → add-layer X"      "add-layer --yes --print-inner agent $P"   "nx,agent"  --sync --ensure=agent --yes --print-inner "$P"
shim "--sync --ensure X (space form)"       "add-layer --print-inner --yes agent $P"         "nx,agent"  --sync --ensure agent --print-inner --yes "$P"
shim "--sync --firebase → add-layer firebase" "add-layer --print-inner --yes firebase $P" "nx,firebase" --sync --firebase --print-inner --yes "$P"
shim "no --sync → new, --ensure → --add-layer" "new --print-inner --add-layer=nx,agent newp" "nx,agent" --print-inner --ensure=nx,agent newp
run "$SHIM" --sync --ensure=bogus --yes "$P"
[ "$RC" -ne 0 ] && in_text "$ERR" -qF "unknown layer 'bogus'" && ok "the shim leaves validation to house.sh" \
  || fail "the shim did not hand a bad layer to house.sh's validation (rc=$RC)"

if [ "$FAILED" -eq 0 ]; then echo "house.sh command line + scaffold.sh shim: all cases passed"; fi
exit "$FAILED"
