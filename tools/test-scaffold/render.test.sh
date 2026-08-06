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
#   one author per flag
#                     — no `nx g` line may pass the same flag twice. See `assert_one_author_per_flag` below
#                       for why the interesting half of that is invisible to a human reading the line.
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

# assert_one_author_per_flag <label> <rendered program> — every flag on a generator invocation has exactly
# one author.
#
# WHY THIS IS NOT JUST "GREP FOR A REPEATED WORD". A generator invocation in the rendered program is a
# concatenation of a literal command and one or more shell variables that are filled in LATER, when the
# program runs:
#
#     yarn nx g @bespunky/nx-tools:devcontainer --name=x --nodeMajor=22$DC_LAYER_FLAGS --firebase=true
#
# That line passed `--firebase=true` TWICE — once literally, and once from `$DC_LAYER_FLAGS`, which the
# program had assembled from layer detection forty lines earlier. Nx coerces a repeated flag to an array,
# the array fails a `boolean` schema, the generator exits 1, and `set -e` takes every generator after it
# down with it (`0.29.0`, `--firebase` scaffolds, reported to the user as `SYNC_FAILED`). Nothing about the
# line looks wrong: you cannot see the duplicate without knowing what the variable expands to, and no
# reader of a diff knows that. `nx g` itself is the only other thing that ever checks, and it checks in
# someone else's project.
#
# So the check RESOLVES THE VARIABLES rather than reading the line. Every `VAR=…--flag…` assignment in the
# rendered program declares what that variable can emit; a generator line that names the variable AND
# spells the same flag out has two authors for one fact. That is derived from the program itself — no list
# of flag names lives here, so a flag added tomorrow is covered on the day it is added.
assert_one_author_per_flag() {
  local label="$1" out="$2" violations
  violations="$(awk '
    # Pass 1 — what can each run-time flag accumulator emit?  `V=" --a=1"` and `V="$V --b=2"` both count.
    # Statement-by-statement, not line-by-line: these assignments live inside one-line conditionals
    # (`if layer_active web; then DC_LAYER_FLAGS=" --web=true"; else …; fi`), so nothing useful is anchored
    # to the start of a line.
    {
      stmt = $0; gsub(/&&|\|\|/, ";", stmt)
      m = split(stmt, part, ";")
      for (p = 1; p <= m; p++) {
        s = part[p]
        sub(/^[[:space:]]*/, "", s)
        while (sub(/^(if|then|else|elif|do|fi|done|local|export|declare)[[:space:]]+/, "", s)) ;
        if (s !~ /^[A-Za-z_][A-Za-z0-9_]*=/) continue
        var = s; sub(/=.*/, "", var)
        rest = s
        while (match(rest, /--[A-Za-z][A-Za-z0-9-]*/)) {
          emits[var, substr(rest, RSTART + 2, RLENGTH - 2)] = 1
          rest = substr(rest, RSTART + RLENGTH)
        }
      }
    }
    # Pass 2 — held until the end, because an accumulator may be assigned below the line that uses it.
    /nx g / { gen[++n] = $0; lineno[n] = FNR }
    END {
      for (i = 1; i <= n; i++) {
        line = gen[i]
        # The flags spelled out literally on the invocation, and the variables it interpolates.
        delete literal; delete refs
        rest = line
        while (match(rest, /--[A-Za-z][A-Za-z0-9-]*/)) {
          f = substr(rest, RSTART + 2, RLENGTH - 2)
          if (f in literal) report(lineno[i], f, "spelled out twice on the same line", line)
          literal[f] = 1
          rest = substr(rest, RSTART + RLENGTH)
        }
        rest = line
        while (match(rest, /\$\{?[A-Za-z_][A-Za-z0-9_]*/)) {
          v = substr(rest, RSTART, RLENGTH); sub(/^\$\{?/, "", v)
          refs[v] = 1
          rest = substr(rest, RSTART + RLENGTH)
        }
        for (v in refs)
          for (f in literal)
            if ((v, f) in emits)
              report(lineno[i], f, "spelled out literally AND emitted by $" v, line)
      }
    }
    function report(ln, flag, how, line) {
      printf "line %d: --%s %s\n           %s\n", ln, flag, how, line
    }
  ' "$out")"

  if [ -z "$violations" ]; then
    ok "$label — every generator flag has exactly one author"
  else
    fail "$label — a generator flag is passed twice (nx coerces it to an array and rejects it):"
    printf '%s\n' "$violations" | sed 's/^/         | /'
  fi
}

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

  assert_one_author_per_flag "$label" "$out"
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
# --voice is a second opt-in that reaches the devcontainer generator by the same route as --firebase, and it
# was broken by the same duplicate-author bug — undetected, because no arm had ever rendered it.
render 'scaffold --voice'       --voice "newproj"
render 'scaffold --local'       --local "newproj"

if [ "$FAILED" -eq 0 ]; then
  echo "scaffold.sh renders cleanly in every mode"
else
  echo "scaffold.sh FAILED to render — the scaffolder cannot run in at least one mode" >&2
fi
exit "$FAILED"
