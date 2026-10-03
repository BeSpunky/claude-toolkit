#!/usr/bin/env bash
# `--local` must be re-runnable on its own output.
#
# WHAT THIS GUARDS. `--local` installs the toolkit's WORKING TREE (a packed tarball) instead of the registry copy —
# it is how every toolkit change is tested before it is published, so it is re-run on the same project as the
# change is iterated. Its first run ends by correcting the manifest to the plain version (FINALIZE_LOCAL: a
# temp-dir file: spec would break every later install), which leaves the project pinning a version NO registry
# can resolve yet. The node-host install used to be the package manager's add (`yarn add -D -E <tarball>`), and
# an add resolves the whole manifest before it replaces anything: the second run died on
#   error Couldn't find any versions for "@bespunky/nx-tools" that matches "0.35.0"
# — on the very entry it was about to replace. Reproduced end to end on a throwaway repo before the fix.
#
# HOW. The rendered program's local install is fenced by `# local-install:begin/end` markers. This renders a real
# `--sync --local` program for a fixture whose manifest pins an unresolvable version, extracts that fence, and runs
# it against a dummy tarball — npm always, yarn too when it is installed. No network is needed: the only
# dependency is a file: tarball. The fence is asserted present, so the test cannot pass by matching nothing.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/text.sh"  # in_text: grep captured output without a SIGPIPE race
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAFFOLD="$ROOT/plugins/project-starter/skills/new-project/assets/scaffold.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

# The stand-in for the packed working tree: a package with the real name and a recognisable version.
mkdir -p "$TMP/pkg"
printf '{ "name": "@bespunky/nx-tools", "version": "0.0.0-local-build" }\n' > "$TMP/pkg/package.json"
TGZ="$(cd "$TMP/pkg" && npm pack --silent --pack-destination "$TMP" 2>/dev/null)"
[ -n "$TGZ" ] && [ -f "$TMP/$TGZ" ] || { echo "FATAL: could not pack the stand-in tarball" >&2; exit 2; }

# fixture <pm> — a project left by a previous --local run: it pins a version no registry has.
fixture() {
  local dir="$TMP/proj-$1"
  mkdir -p "$dir/node_modules/.bin"
  printf '{\n  "name": "proj",\n  "private": true,\n  "devDependencies": {\n    "@bespunky/nx-tools": "0.0.0-never-published"\n  }\n}\n' > "$dir/package.json"
  case "$1" in yarn) : > "$dir/yarn.lock" ;; npm) printf '{ "lockfileVersion": 3, "requires": true, "packages": {} }\n' > "$dir/package-lock.json" ;; esac
  printf '{}\n' > "$dir/nx.json"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$dir/node_modules/.bin/nx"; chmod +x "$dir/node_modules/.bin/nx"
  printf 'node_modules/\n' > "$dir/.gitignore"
  git -C "$dir" init -q -b feat/x && git -C "$dir" add -A >/dev/null 2>&1 && git -C "$dir" commit -qm init
  printf '%s' "$dir"
}

check_pm() {
  local pm="$1" dir program snippet
  dir="$(fixture "$pm")"
  program="$(bash "$SCAFFOLD" --print-inner --sync --yes --local "$dir" 2>/dev/null)"
  snippet="$(printf '%s\n' "$program" | sed -n '/# local-install:begin/,/# local-install:end/p')"
  if [ -z "$snippet" ]; then fail "$pm: the rendered --local program has no local-install fence"; return; fi
  if in_text "$snippet" -qE '(yarn add|npm install --save-dev|pnpm add)'; then
    fail "$pm: the local install still goes through the package manager's add"
  fi
  if (cd "$dir" && _local_stage="$TMP" _local_tgz="$TGZ" bash -c "set -e; $snippet") >"$TMP/$pm.log" 2>&1; then
    ok "$pm: re-installs the working tree over an unpublished pin"
  else
    fail "$pm: the local install failed over an unpublished pin:"; sed -n '1,8p' "$TMP/$pm.log" | sed 's/^/         | /'; return
  fi
  local got
  got="$(node -p "require('$dir/node_modules/@bespunky/nx-tools/package.json').version" 2>/dev/null || echo none)"
  [ "$got" = "0.0.0-local-build" ] && ok "$pm: node_modules holds the working-tree build" || fail "$pm: node_modules holds '$got'"
}

echo "── --local re-runs on its own output"
check_pm npm
if command -v yarn >/dev/null 2>&1; then check_pm yarn; else echo "  skip yarn (not installed)"; fi
exit "$FAILED"
