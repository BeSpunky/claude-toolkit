#!/usr/bin/env bash
# `scaffold.sh` must be able to RENDER the program it exists to produce.
#
# WHAT THIS GUARDS, AND WHY IT IS NOT A STYLE CHECK. scaffold.sh's real product is a ~500-line shell program
# assembled out of nested double-quoted strings. Inside such a string a backtick is COMMAND SUBSTITUTION,
# evaluated at render time — including inside a `#` comment, which is the trap, because a comment reads as
# inert prose to everyone who has ever written one. The script says so itself, at length, right above the
# blocks ("Rule of thumb: inside these blocks write comments in plain prose with no backticks…") and names
# this exact verification (`--print-inner`, "ANY stderr during rendering means something in a string was
# evaluated that should not have been"). It had to be run by hand, by someone who remembered to.
#
# Nobody did, and it shipped. `66a4449` wrote four backticked words into a prose comment inside
# WORKSPACE_GEN_BLOCK. The render then ran `agent`, `@`, `retire-inline-house-sections` and `--layers` as
# commands, each exited 127, the assignment inherited that status, and `set -euo pipefail` killed the script
# at line 1450 — before the first command of the sequence, on `--sync` AND on a fresh scaffold. Released on
# project-starter 0.27.0.
#
# THE FAILURE IS ONE STEP REMOVED FROM ITS SYMPTOM, which is what makes it worth a test rather than care.
# What users reported was not "the scaffolder crashes" — it was "after running the sync, nx-tools doesn't
# install the latest version". Perfectly true, and it points at the install, the pin, the registry, the
# migration ladder: everything except a comment four hundred lines away. A guard that fails at the render
# names the cause on the first read.
#
# WHAT EACH ASSERTION IS FOR:
#   exit 0            — the shipped failure exactly. Under `set -e` a failed substitution aborts the render.
#   non-empty program — a render that "succeeds" and emits nothing is not a render.
#   bash -n           — quoting damage that does not abort still yields a program that cannot parse. This is
#                       the half that catches an unbalanced quote rather than a live command.
#   no bash diagnostic on stderr
#                     — catches the same class when it is NOT fatal (a substitution whose command exists and
#                       fails, or if `set -e` is ever relaxed). scaffold.sh's own progress lines go to stderr
#                       under --print-inner, so this matches bash's `script: line N:` diagnostics, not "any
#                       output" as the comment in scaffold.sh loosely puts it.
#   the install line  — the render must still emit the pinned `@bespunky/nx-tools@<payload version>` install,
#                       derived from the payload's package.json rather than hardcoded here. This is the
#                       user-visible promise ("a sync installs the current house tooling") asserted directly,
#                       so a future refactor cannot quietly render a sequence that installs nothing.
#
# HONEST LIMIT: a backtick around a command that EXISTS and SUCCEEDS (`date`, `pwd`) is still silently
# substituted into the comment and this will not catch it. It catches every failing one, which is every
# accident of this shape so far — the words that end up in prose are prose words, not commands.
#
# EVERY ARM IS A DIFFERENT SET OF BLOCKS. --local swaps INSTALL_NX_TOOLS and the migration collector for
# much larger strings, --ensure/--firebase gate whole blocks in or out, and scaffold mode renders a
# different program entirely. A render check that only ever exercised the default path would have missed
# three of the four places this can go wrong.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ASSETS="$ROOT/plugins/project-starter/skills/new-project/assets"
SCAFFOLD="$ASSETS/scaffold.sh"

[ -f "$SCAFFOLD" ] || { echo "FATAL: scaffold.sh not found at $SCAFFOLD" >&2; exit 2; }
grep -q -- '--print-inner' "$SCAFFOLD" || {
  echo "FATAL: scaffold.sh no longer supports --print-inner — this test cannot render anything." >&2
  exit 2
}

# Derived, never hand-maintained — the same line scaffold.sh reads to build the pin.
PAYLOAD_VERSION="$(grep -m1 '"version"' "$ASSETS/nx-tools/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
[ -n "$PAYLOAD_VERSION" ] || { echo "FATAL: could not read the payload version from $ASSETS/nx-tools/package.json" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# ── A fixture that gets past the OUTER script's own preconditions ───────────────────────────────
# Only the outer script's checks matter here: --print-inner exits before the rendered program runs, so
# nx.json / the nx binary are never consulted. A git repo with one commit is, though — the backup step
# refuses a non-repo before it reaches the render.
FIX="$TMP/project"
mkdir -p "$FIX/node_modules/.bin"
printf '{ "name": "fixture", "private": true }\n' > "$FIX/package.json"
printf '{}\n' > "$FIX/nx.json"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FIX/node_modules/.bin/nx"
chmod +x "$FIX/node_modules/.bin/nx"
git -C "$FIX" init -q -b main
printf 'node_modules/\n' > "$FIX/.gitignore"
git -C "$FIX" add -A >/dev/null 2>&1
git -C "$FIX" commit -qm init

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

# render <label> <flags…> — renders one arm and asserts everything above about it.
#
# stdout is the program, stderr is scaffold.sh's own commentary; they are captured SEPARATELY because the
# whole point is to read one without the other. (--print-inner already redirects its progress lines to
# stderr and hands the program back on the original stdout, precisely so this is possible.)
render() {
  local label="$1"; shift
  local out="$TMP/out.$$" err="$TMP/err.$$" rc=0

  bash "$SCAFFOLD" --print-inner "$@" > "$out" 2> "$err" || rc=$?

  if [ "$rc" -ne 0 ]; then
    fail "$label — render exited $rc (a failed command substitution in a block string aborts under set -e)"
    sed -n '1,12p' "$err" | sed 's/^/         | /'
    return
  fi
  ok "$label — render exits 0"

  if [ ! -s "$out" ]; then fail "$label — rendered an EMPTY program"; return; fi
  ok "$label — rendered a non-empty program"

  if bash -n "$out" 2>"$TMP/syn.$$"; then
    ok "$label — rendered program parses"
  else
    fail "$label — rendered program does NOT parse"
    sed -n '1,8p' "$TMP/syn.$$" | sed 's/^/         | /'
  fi

  # bash prefixes its own diagnostics with `<script>: line N:` — the signature of something in a string
  # having been evaluated. scaffold.sh's deliberate progress output never takes that shape.
  if grep -qE '(^|/)scaffold\.sh: line [0-9]+:' "$err"; then
    fail "$label — bash evaluated something inside a block string:"
    grep -E '(^|/)scaffold\.sh: line [0-9]+:' "$err" | head -6 | sed 's/^/         | /'
  else
    ok "$label — nothing in a block string was evaluated"
  fi

  # The pin the whole sync hangs on, and the thing the reported symptom was actually about. Asserted as
  # "the payload version reaches the program" rather than as an exact command line: --local deliberately
  # installs a packed tarball and carries the version in the manifest correction instead, and the arms must
  # not have to know which. A render that forgets it entirely is the failure worth catching.
  if grep -qF "$PAYLOAD_VERSION" "$out"; then
    ok "$label — carries the payload version ($PAYLOAD_VERSION)"
  else
    fail "$label — rendered program never mentions the payload version $PAYLOAD_VERSION"
  fi
}

# `scaffold` mode resolves a BARE project name under PROJECTS_DIR and refuses a directory that already
# exists, so it is pointed at an empty temp root — never at the developer's real ~/projects.
export PROJECTS_DIR="$TMP/projects"
mkdir -p "$PROJECTS_DIR"

echo "── rendering every block-selecting combination"
render 'sync'                   --sync --yes "$FIX"
render 'sync --local'           --sync --yes --local "$FIX"
# Only nx, agent and firebase are ensurable by a sync — the rest are refused, deliberately, by the guard
# preflight-gate.test.sh covers. The layer-gated generator blocks are rendered either way (they are gated
# at RUN time by `layer_active` inside the program), so one plain sync arm already exercises all of them.
render 'sync --ensure=agent'    --sync --yes --ensure=nx,agent "$FIX"
render 'sync --firebase'        --sync --yes --firebase --ensure=firebase "$FIX"
render 'scaffold'               "newproj"
render 'scaffold --firebase'    --firebase --staging "newproj" "myapp"
render 'scaffold --local'       --local "newproj"

if [ "$FAILED" -eq 0 ]; then
  echo "scaffold.sh renders cleanly in every mode"
else
  echo "scaffold.sh FAILED to render — the scaffolder cannot run in at least one mode" >&2
fi
exit "$FAILED"
