#!/usr/bin/env bash
# Adding a dev dependency is decided IN THE PROGRAM, at call time — never composed on the host.
#
# WHY THIS IS A TEST. The add used to be a string composed by house.sh before the program ran (`yarn add -D -E`),
# a snapshot of "is this a workspace root, and which yarn will run here?" taken before — for a scaffold — the
# project even existed. At a yarn 1 WORKSPACES root that string exits 1 ("…add the dependency to the workspace root
# rather than the workspace itself… run this command again with the -W flag"), so the install of the house tooling
# failed on every such upgrade; and a `--linking=workspaces` scaffold IS such a root by construction. It passed the
# toolkit's own testing only because `--local` installs by manifest rewrite + `yarn install`, never `yarn add` —
# the failure is invisible from exactly the path a maintainer exercises. Hence both halves here:
#
#   the WIRING  — the rendered program defines `_pm_add_dev` before its first call, every install goes through it,
#                 and no `<pm> add …` line is composed on the host any more (scaffold and upgrade, both hosts);
#   the DECISION — the shipped function, lifted out of the rendered program and run in a sandbox against stub
#                 package managers, picks the root flag from the workspace and the package manager's own version:
#                 yarn 1 + `workspaces` → -W, yarn 1 without → none, berry → none; pnpm-workspace.yaml → -w; npm
#                 never needs one. Every arm pins exactly.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOUSE_SH="$ROOT/plugins/house/engine/house.sh"
[ -f "$HOUSE_SH" ] || { echo "FATAL: house.sh not found at $HOUSE_SH" >&2; exit 2; }
command -v node >/dev/null || { echo "FATAL: node is required (the function reads package.json with it) — cannot test." >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export PROJECTS_DIR="$TMP/projects"; mkdir -p "$PROJECTS_DIR"

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

# A node-hosted project with no lockfile: the house default package manager (yarn).
FIX="$TMP/project"
mkdir -p "$FIX"
printf '{ "name": "fixture", "private": true }\n' > "$FIX/package.json"
printf '{}\n' > "$FIX/nx.json"
git -C "$FIX" init -q -b main && git -C "$FIX" add -A && git -C "$FIX" commit -qm init

# ── the wiring ────────────────────────────────────────────────────────────────────────────────────────────────────
echo "── the add is rendered as a function and called, in every node-hosted program"
# defined_before_use <label> <program> — the definition precedes the first call, every add goes through it, and no
# package-manager add is spelled out anywhere else in the program.
defined_before_use() {
  local label="$1" prog="$2" def use outside
  def="$(printf '%s\n' "$prog" | grep -n '^_pm_add_dev ()' | head -1 | cut -d: -f1)"
  use="$(printf '%s\n' "$prog" | grep -nE '^[[:space:]]*_pm_add_dev (yarn|npm|pnpm) ' | head -1 | cut -d: -f1)"
  if [ -n "$def" ] && [ -n "$use" ] && [ "$def" -lt "$use" ]; then
    ok "$label — _pm_add_dev is defined (line $def) before its first call (line $use)"
  else
    fail "$label — _pm_add_dev definition/first call: '${def:-none}' / '${use:-none}'"
  fi
  # Outside the function body, no line may compose an add itself.
  outside="$(printf '%s\n' "$prog" | awk '/^_pm_add_dev \(\)/{f=1} f&&/^}/{f=0; next} !f' | grep -vE '^[[:space:]]*#')"
  if grep -qE '(yarn add|pnpm add|npm install --save-dev)' <<< "$outside"; then
    fail "$label — a package-manager add is still composed outside _pm_add_dev"
  else
    ok "$label — no package-manager add is composed outside _pm_add_dev"
  fi
}
_prog="$(bash "$HOUSE_SH" upgrade --print-inner --yes "$FIX" 2>/dev/null)"
defined_before_use "upgrade" "$_prog"
grep -qE '^[[:space:]]*_pm_add_dev yarn @bespunky/nx-tools@' <<< "$_prog" \
  && ok "upgrade — the toolkit install is _pm_add_dev yarn @bespunky/nx-tools@<version>" \
  || fail "upgrade — the toolkit install does not go through _pm_add_dev"
grep -qF '_pm_add_dev yarn "@nx/devkit@$_nxv"' <<< "$_prog" \
  && ok "upgrade — the @nx/devkit floor goes through _pm_add_dev" \
  || fail "upgrade — the @nx/devkit floor does not go through _pm_add_dev"
defined_before_use "scaffold --preset=node" "$(bash "$HOUSE_SH" new --print-inner --preset=node newproj 2>/dev/null)"
defined_before_use "scaffold --preset=angular --linking=workspaces" \
  "$(bash "$HOUSE_SH" new --print-inner --preset=angular --linking=workspaces newproj shop 2>/dev/null)"

# ── the decision ──────────────────────────────────────────────────────────────────────────────────────────────────
echo "── the root flag is the workspace's and the package manager's answer, at call time"
FN="$(printf '%s\n' "$_prog" | sed -n '/^_pm_add_dev ()/,/^}/p')"
[ -n "$FN" ] || { echo "FATAL: could not lift _pm_add_dev out of the rendered program — the markers moved." >&2; exit 2; }

# Stub package managers: each records its argv; yarn reports the version the case asks for.
BIN="$TMP/bin"; mkdir -p "$BIN"
for _pm in yarn pnpm npm; do
  cat > "$BIN/$_pm" <<STUB
#!/usr/bin/env bash
if [ "$_pm" = yarn ] && [ "\${1:-}" = --version ]; then echo "\$STUB_YARN_VERSION"; exit 0; fi
printf '%s %s\n' "$_pm" "\$*" >> "\$STUB_LOG"
STUB
  chmod +x "$BIN/$_pm"
done

# add_case <label> <pm> <yarn version> <package.json> <pnpm-workspace? 0|1> <expected argv>
add_case() {
  local label="$1" pm="$2" yv="$3" pkg="$4" pnpmws="$5" want="$6" dir got
  dir="$(mktemp -d "$TMP/ws.XXXX")"
  printf '%s\n' "$pkg" > "$dir/package.json"
  [ "$pnpmws" = 1 ] && printf 'packages:\n  - packages/*\n' > "$dir/pnpm-workspace.yaml"
  : > "$dir/log"
  ( cd "$dir" && export PATH="$BIN:$PATH" STUB_YARN_VERSION="$yv" STUB_LOG="$dir/log"
    eval "$FN"; _pm_add_dev "$pm" '@bespunky/nx-tools@1.2.3' >/dev/null )
  got="$(cat "$dir/log")"
  [ "$got" = "$want" ] && ok "$label → $want" || fail "$label — expected '$want', got '$got'"
}
WS='{ "name": "r", "private": true, "workspaces": ["packages/*"] }'
PLAIN='{ "name": "r", "private": true }'
# A `"workspaces"` string that is not the field must not fool it: the field is READ, not grepped.
DECOY='{ "name": "r", "scripts": { "ls": "echo \"workspaces\": none" } }'
add_case 'yarn 1, workspaces root'        yarn 1.22.22 "$WS"    0 'yarn add -D -E -W @bespunky/nx-tools@1.2.3'
add_case 'yarn 1, plain repo'             yarn 1.22.22 "$PLAIN" 0 'yarn add -D -E @bespunky/nx-tools@1.2.3'
add_case 'yarn 1, "workspaces" only in a string' yarn 1.22.22 "$DECOY" 0 'yarn add -D -E @bespunky/nx-tools@1.2.3'
add_case 'yarn berry, workspaces root'    yarn 4.5.0   "$WS"    0 'yarn add -D -E @bespunky/nx-tools@1.2.3'
add_case 'pnpm, pnpm-workspace.yaml'      pnpm ''      "$PLAIN" 1 'pnpm add -D -w -E @bespunky/nx-tools@1.2.3'
add_case 'pnpm, plain repo'               pnpm ''      "$PLAIN" 0 'pnpm add -D -E @bespunky/nx-tools@1.2.3'
add_case 'npm, workspaces root'           npm  ''      "$WS"    0 'npm install --save-dev --save-exact @bespunky/nx-tools@1.2.3'

if ( eval "$FN"; _pm_add_dev bun x >/dev/null 2>&1 ); then
  fail "an unknown package manager is accepted"
else
  ok "an unknown package manager is refused, not guessed"
fi

[ "$FAILED" -eq 0 ] && echo "the dev-dependency add is decided at run time"
exit "$FAILED"
