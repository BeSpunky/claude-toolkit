#!/usr/bin/env bash
# `house.sh` must be able to RENDER the program it exists to produce.
#
# WHAT THIS GUARDS, AND WHY IT IS NOT A STYLE CHECK. house.sh's real product is a ~500-line shell program
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
# at line 1450 — before the first command of the sequence, on an upgrade AND on a fresh scaffold. Released on
# project-starter 0.27.0.
#
# THE FAILURE IS ONE STEP REMOVED FROM ITS SYMPTOM, which is what makes it worth a test rather than care.
# What users reported was not "the scaffolder crashes" — it was "after running the upgrade, nx-tools doesn't
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
#                       fails, or if `set -e` is ever relaxed). house.sh's own progress lines go to stderr
#                       under --print-inner, so this matches bash's `script: line N:` diagnostics, not "any
#                       output" as the comment in house.sh loosely puts it.
#   the install line  — the render must still emit the pinned `@bespunky/nx-tools@<payload version>` install,
#                       derived from the payload's package.json rather than hardcoded here. This is the
#                       user-visible promise ("an upgrade installs the current house tooling") asserted directly,
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
# much larger strings, the layers/--firebase gate whole blocks in or out, and scaffold mode renders a
# different program entirely. A render check that only ever exercised the default path would have missed
# three of the four places this can go wrong.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/text.sh"  # in_text: grep captured output without a SIGPIPE race
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE="$ROOT/plugins/house/engine"
HOUSE_SH="$ENGINE/house.sh"

[ -f "$HOUSE_SH" ] || { echo "FATAL: house.sh not found at $HOUSE_SH" >&2; exit 2; }
grep -q -- '--print-inner' "$HOUSE_SH" || {
  echo "FATAL: house.sh no longer supports --print-inner — this test cannot render anything." >&2
  exit 2
}

# Derived, never hand-maintained — the same line house.sh reads to build the pin.
PAYLOAD_VERSION="$(grep -m1 '"version"' "$ENGINE/nx-tools/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
[ -n "$PAYLOAD_VERSION" ] || { echo "FATAL: could not read the payload version from $ENGINE/nx-tools/package.json" >&2; exit 2; }

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

# The WRAPPER host: a repo with no package.json (a Python service). The upgrade lays the Nx floor through the Nx
# wrapper (./nx) instead of making it a Node project, so it renders a different install, probe and nx command.
FIXW="$TMP/pyproject"
mkdir -p "$FIXW"
printf 'print("hi")\n' > "$FIXW/main.py"
git -C "$FIXW" init -q -b main
git -C "$FIXW" add -A >/dev/null 2>&1
git -C "$FIXW" commit -qm init

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
# down with it (`0.29.0`, `--firebase` scaffolds, reported to the user as `UPGRADE_FAILED`). Nothing about the
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

# render <label> <command> <flags…> — renders one arm and asserts everything above about it.
#
# stdout is the program, stderr is house.sh's own commentary; they are captured SEPARATELY because the
# whole point is to read one without the other. (--print-inner already redirects its progress lines to
# stderr and hands the program back on the original stdout, precisely so this is possible.)
render() {
  local label="$1" cmd="$2"; shift 2
  local out="$TMP/out.$$" err="$TMP/err.$$" rc=0

  bash "$HOUSE_SH" "$cmd" --print-inner "$@" > "$out" 2> "$err" || rc=$?

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
  # having been evaluated. house.sh's deliberate progress output never takes that shape.
  if grep -qE '(^|/)scaffold\.sh: line [0-9]+:' "$err"; then
    fail "$label — bash evaluated something inside a block string:"
    grep -E '(^|/)scaffold\.sh: line [0-9]+:' "$err" | head -6 | sed 's/^/         | /'
  else
    ok "$label — nothing in a block string was evaluated"
  fi

  # The pin the whole upgrade hangs on, and the thing the reported symptom was actually about. Asserted as
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
render 'upgrade'                upgrade --yes "$FIX"
render 'upgrade --local'        upgrade --yes --local "$FIX"
# Only nx, agent and firebase are addable by an upgrade — the rest are refused, deliberately, by the guard
# preflight-gate.test.sh covers. The layer-gated generator blocks are rendered either way (they are gated
# at RUN time by `layer_active` inside the program), so one plain upgrade arm already exercises all of them.
render 'add-layer nx,agent'     add-layer --yes nx,agent "$FIX"
render 'add-layer --firebase'   add-layer --yes --firebase firebase "$FIX"
render 'add-layer --staging firebase' add-layer --yes --staging firebase "$FIX"
render 'new'                    new "newproj"
render 'new --preset=angular'   new --preset=angular "newproj" "myapp"
render 'new --firebase'         new --preset=angular --firebase --staging "newproj" "myapp"
# --voice is a second opt-in that reaches the devcontainer generator by the same route as --firebase, and it
# was broken by the same duplicate-author bug — undetected, because no arm had ever rendered it.
render 'new --voice'            new --voice "newproj"
render 'new --local'            new --local "newproj"
render 'new --local angular'    new --local --preset=angular "newproj"
render 'upgrade (wrapper host)' upgrade --yes "$FIXW"
render 'add-layer --local (wrapper)' add-layer --yes --local agent "$FIXW"
render 'new --add-layer=nx,agent' new --add-layer=nx,agent "newproj"

# NEW = AN UPGRADE WITH AN ENSURE SET: the bootstrap is rendered FROM the ensure set, never hard-wired. It once ran
# the Angular bootstrap unconditionally, so --add-layer=nx,agent (now --add-layer) still created an Angular workspace and app; and the
# default project is now the agent preset — wrapper-hosted, no package.json, no stack.
echo "── the scaffold bootstrap is the ensure set's"
_bootstrap() { printf '%s\n' "$1" | grep -vE '^[[:space:]]*#' | grep -E 'create nx-workspace|create-nx-workspace|nx add |nx-tools:app |useDotNxInstallation=true|^git init'; }
_prog="$(bash "$HOUSE_SH" new --print-inner "newproj" 2>/dev/null)"
_b="$(_bootstrap "$_prog")"
if in_text "$_prog" -q "^ENSURED='nx,agent'$" && in_text "$_b" -q 'useDotNxInstallation=true' \
   && ! in_text "$_b" -qE 'nx-workspace|nx add |nx-tools:app '; then
  ok "default scaffold = the agent preset: wrapper floor, no create-nx-workspace, no plugin, no app"
else
  fail "the default scaffold is not the agent preset on the wrapper floor:"; printf '%s\n' "$_b" | sed 's/^/         | /'
fi
_prog="$(bash "$HOUSE_SH" new --print-inner --add-layer=nx,agent "newproj" 2>/dev/null)"
if ! in_text "$(_bootstrap "$_prog")" -qE 'nx-workspace|nx add |nx-tools:app '; then
  ok "--add-layer=nx,agent bootstraps no stack"
else
  fail "--add-layer=nx,agent renders a stack bootstrap"
fi
_prog="$(bash "$HOUSE_SH" new --print-inner --preset=angular --firebase "newproj" "shop" 2>/dev/null)"
_b="$(_bootstrap "$_prog")"
if in_text "$_b" -q 'create nx-workspace' && in_text "$_b" -q 'nx add @nx/angular' \
   && in_text "$_b" -q "nx-tools:app 'apps/shop' --stack=angular" && ! in_text "$_b" -q 'useDotNxInstallation=true' \
   && in_text "$_prog" -q "^ENSURED='nx,agent,node,web,angular,design-system,firebase'$"; then
  ok "--preset=angular --firebase: package.json host, @nx/angular, the first app through the adapter"
else
  fail "--preset=angular does not render the Angular bootstrap:"; printf '%s\n' "$_b" | sed 's/^/         | /'
fi
if ! bash "$HOUSE_SH" new --print-inner "newproj" "shop" >/dev/null 2>&1; then
  ok "an app name with nothing that creates an app is refused"
else
  fail "house.sh new newproj shop (agent preset) accepted an app name nothing uses"
fi
# And the wrapper host never makes a Python repo a Node project: no package-manager add, ./nx throughout.
_prog="$(bash "$HOUSE_SH" add-layer --print-inner --yes agent "$FIXW" 2>/dev/null)"
if in_text "$_prog" -q 'useDotNxInstallation=true' && ! in_text "$_prog" -qE 'yarn add|npm install --save-dev|pnpm add'; then
  ok "wrapper host: nx init through the wrapper, no package-manager add"
else
  fail "wrapper host renders a Node-project install"
fi
# A refusal's hint is a command the user will paste: on a wrapper host Nx is `./nx`, and a bare `nx add …` fails.
_err="$(bash "$HOUSE_SH" add-layer --print-inner --yes angular "$FIXW" 2>&1 >/dev/null)"
if in_text "$_err" -q '`./nx add @nx/angular`' && ! in_text "$_err" -q '`nx add'; then
  ok "wrapper host: the not-upgrade-addable hint says ./nx"
else
  fail "wrapper host: the not-upgrade-addable hint does not say ./nx:"; printf '%s\n' "$_err" | sed 's/^/         | /'
fi
# THE APP A UPGRADE REFRESHES IS INFERRED BY THE PACKAGE, AT RUN TIME — never by a bash glob over apps/. That glob
# knew one layout and one project file, and excluded the house's server app (Cloud Functions) by its NAME; a Firebase
# core with no client app once had its per-app generators run on `functions` ("has nothing to serve"). Which projects
# are client apps is now `layers/cli.js apps` (project graph + projectRole, `platform:server` excluded); what this
# render must guarantee is that the program ASKS — passing the given app (or none) and the fallback — and that no
# app name is baked into the plan call at render time.
_FIXF="$TMP/fbcore"
mkdir -p "$_FIXF/apps/functions" && git -C "$_FIXF" init -q
printf '{"name":"fbcore"}\n' > "$_FIXF/package.json"; printf '{}\n' > "$_FIXF/nx.json"
printf '{"name":"functions","root":"apps/functions","tags":["platform:server"]}\n' > "$_FIXF/apps/functions/project.json"
_prog="$(bash "$HOUSE_SH" upgrade --print-inner --yes "$_FIXF" 2>/dev/null)"
if in_text "$_prog" -q -- "_resolve_upgrade_app 'node_modules/@bespunky/nx-tools' '' 'fbcore'" \
   && in_text "$_prog" -q -- '--app="$APP"' && ! in_text "$_prog" -q -- '--app=functions'; then
  ok "upgrade: the app is inferred in the program by the package (layers/cli.js apps), fallback = the project name"
else
  fail "upgrade: the app is not inferred at run time by the package: $(printf '%s\n' "$_prog" | grep -o -- '_resolve_upgrade_app [^\n]*\|--app=[^ ]*' | head -2 | tr '\n' ' ')"
fi
_prog="$(bash "$HOUSE_SH" upgrade --print-inner --yes "$_FIXF" shop 2>/dev/null)"
if in_text "$_prog" -q -- "_resolve_upgrade_app 'node_modules/@bespunky/nx-tools' 'shop' 'fbcore'"; then
  ok "upgrade: an app given on the command line is handed to the program as given"
else
  fail "upgrade: the given app is not handed to the program"
fi

if [ "$FAILED" -eq 0 ]; then
  echo "house.sh renders cleanly in every mode"
else
  echo "house.sh FAILED to render — the scaffolder cannot run in at least one mode" >&2
fi
exit "$FAILED"
