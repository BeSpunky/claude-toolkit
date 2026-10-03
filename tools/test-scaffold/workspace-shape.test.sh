#!/usr/bin/env bash
# THE WORKSPACE SHAPE — `--layout` (where projects live) and `--linking` (how they reach each other) — is CHOSEN only
# by a scaffold and DETECTED by an upgrade. The regressions this guards would all be silent:
#
#   - an upgrade that accepted the flags would read as if it had relocated or relinked a workspace it never touched
#     (an ignored flag is a lie of omission), so an upgrade must REFUSE them, before anything is written;
#   - `--linking=workspaces` without a package.json does not exist (it IS package-manager workspaces) — scaffolding
#     `paths` instead would hand back a different workspace than the one asked for;
#   - omitting both must reproduce today's bootstrap exactly — no workspaceLayout declared, the `apps` preset with
#     workspaces off, the first app under apps/;
#   - `--linking=workspaces` must bootstrap a real TS-solution (`--preset=ts`: `--preset=apps --workspaces=true` was
#     verified to produce none), and `--layout` must land the first app in that layout's appsDir.
# Render-level only (bash + git): the refusals happen before the program, and the bootstrap is the program's text.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/text.sh"  # in_text: grep captured output without a SIGPIPE race
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOUSE_SH="$ROOT/plugins/house/engine/house.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

# ── an upgrade refuses both flags, and writes nothing ─────────────────────────────────────────────────────────────
P="$TMP/proj"
mkdir -p "$P" && git -C "$P" init -q
printf '{}\n' > "$P/nx.json"
before="$(ls -A "$P")"
for flag in --layout=packages --linking=workspaces; do
  err="$(bash "$HOUSE_SH" upgrade --yes "$flag" "$P" 2>&1 >/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ] && in_text "$err" -q -- "upgrade does not take $flag" \
     && in_text "$err" -q 'DETECTED' && in_text "$err" -q 'Nothing has been written'; then
    ok "upgrade refuses $flag (detected, never chosen)"
  else
    fail "upgrade did not refuse $flag (rc=$rc): $(printf '%s' "$err" | head -2)"
  fi
done
# --print-inner is no loophole: the refusal is about the request, not the act.
bash "$HOUSE_SH" upgrade --yes --print-inner --layout=apps-libs "$P" >/dev/null 2>&1 \
  && fail "upgrade --print-inner accepted --layout" || ok "upgrade refuses --layout under --print-inner too"
[ "$(ls -A "$P")" = "$before" ] && ok "the refused upgrades wrote nothing" || fail "a refused upgrade changed the project"

# ── unknown ids are refused with the known ones ───────────────────────────────────────────────────────────────
err="$(bash "$HOUSE_SH" new --print-inner --layout=monorepo newp 2>&1 >/dev/null)" \
  && fail "an unknown layout was accepted" \
  || { in_text "$err" -q 'apps-libs' && ok "an unknown layout is refused, listing the known ones" \
       || fail "unknown-layout refusal does not list the layouts: $err"; }
err="$(bash "$HOUSE_SH" new --print-inner --linking=symlinks newp 2>&1 >/dev/null)" \
  && fail "an unknown linking was accepted" \
  || { in_text "$err" -q 'workspaces' && ok "an unknown linking is refused, listing the known ones" \
       || fail "unknown-linking refusal does not list the linkings: $err"; }
bash "$HOUSE_SH" new --print-inner --layout --yes newp >/dev/null 2>&1 \
  && fail "--layout swallowed a flag as its value" || ok "--layout refuses a flag-shaped value"

# ── workspaces linking needs a package.json ───────────────────────────────────────────────────────────────────
err="$(bash "$HOUSE_SH" new --print-inner --linking=workspaces newp 2>&1 >/dev/null)"; rc=$?
if [ "$rc" -ne 0 ] && in_text "$err" -q 'need a package.json' && in_text "$err" -q -- '--add-layer=node'; then
  ok "--linking=workspaces on the wrapper host (no node layer) is refused, naming the fix"
else
  fail "--linking=workspaces without the node layer was not refused (rc=$rc)"
fi

# ── the bootstrap each choice renders ─────────────────────────────────────────────────────────────────────────
render() { bash "$HOUSE_SH" new --print-inner "$@" 2>/dev/null; }
prog="$(render --preset=angular newp shop)"
if in_text "$prog" -q -- "--preset=apps --workspaces=false" \
   && ! in_text "$prog" -q 'workspace-layout' \
   && ! in_text "$prog" -q 'NX_IGNORE_UNSUPPORTED_TS_SETUP=true' \
   && in_text "$prog" -q -- "nx-tools:app 'apps/shop'"; then
  ok "defaults: today's bootstrap (apps preset, no workspaces, no layout declared, app under apps/)"
else
  fail "the default bootstrap changed"
fi
prog="$(render --preset=angular --linking=workspaces --layout=packages newp shop)"
if in_text "$prog" -q -- "--preset=ts --workspaces=true" \
   && in_text "$prog" -q 'nx-tools:workspace-layout --layout=packages' \
   && in_text "$prog" -q -- "nx-tools:app 'packages/shop'" \
   && in_text "$prog" -q '^NX_IGNORE_UNSUPPORTED_TS_SETUP=true .*nx add @nx/angular'; then
  ok "--linking=workspaces --layout=packages: TS-solution preset, layout declared, app in packages/, scoped opt-out on nx add"
else
  fail "--linking=workspaces --layout=packages does not render its bootstrap"
fi
# The layout is declared after the toolkit is installed and before the first app exists.
_install="$(printf '%s\n' "$prog" | grep -n '@bespunky/nx-tools@' | head -1 | cut -d: -f1)"
_layout="$(printf '%s\n' "$prog" | grep -n 'nx-tools:workspace-layout' | head -1 | cut -d: -f1)"
_app="$(printf '%s\n' "$prog" | grep -n 'nx-tools:app ' | head -1 | cut -d: -f1)"
if [ -n "$_install" ] && [ -n "$_layout" ] && [ -n "$_app" ] && [ "$_install" -lt "$_layout" ] && [ "$_layout" -lt "$_app" ]; then
  ok "the layout is declared between the toolkit install and the first app"
else
  fail "the layout is not declared between the install and the first app (install=$_install layout=$_layout app=$_app)"
fi
prog="$(render --preset=angular --layout=apps-libs newp shop)"
in_text "$prog" -q -- "nx-tools:app 'apps/shop'" && in_text "$prog" -q -- "--preset=apps --workspaces=false" \
  && ok "--layout=apps-libs alone: paths linking, app in apps/" || fail "--layout=apps-libs does not render as expected"
prog="$(render --layout=packages newp)"
in_text "$prog" -q 'nx-tools:workspace-layout --layout=packages' && ! in_text "$prog" -q 'nx-tools:app ' \
  && ok "--layout on the agent preset (wrapper host): declared, no app" || fail "--layout on the agent preset does not render as expected"
printf '%s\n' "$prog" | bash -n /dev/stdin 2>/dev/null && ok "the rendered program parses" || fail "the rendered program does not parse"

[ "$FAILED" -eq 0 ] || exit 1
