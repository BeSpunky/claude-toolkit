#!/usr/bin/env bash
# tools/port-claim — host-port arbitration across devcontainers — runs its OWN suite (port-claim.test.mjs, shipped
# to every project beside it) here too, so the toolkit's CI exercises it before a project ever does.
#
# WHAT THIS GUARDS. A double-booked host port fails silently: two containers each print a URL, and one of them
# is showing the other's app. The suite races real processes on one registry (allocation, and the takeover of an
# expired claim), and refuses out-of-range ports. Materialised exactly as the generator writes it: the .tpl
# files with the noVNC band injected from novnc-band.ts.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$ROOT/plugins/house/engine/nx-tools/src/generators"
command -v node >/dev/null 2>&1 || { echo "  skip  node unavailable"; exit 0; }

band() { sed -nE "s/^export const NOVNC_BAND_$1 = ([0-9]+);.*/\1/p" "$GEN/shared-browser/novnc-band.ts"; }
START="$(band START)"; SIZE="$(band SIZE)"
[ -n "$START" ] && [ -n "$SIZE" ] || { echo "FATAL: could not read the noVNC band from novnc-band.ts" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for f in port-claim port-claim.test; do
  sed -e "s/{{novncBandStart}}/$START/g" -e "s/{{novncBandSize}}/$SIZE/g" "$GEN/port-claim/$f.mjs.tpl" > "$TMP/$f.mjs"
done
out="$(node --test "$TMP/port-claim.test.mjs" 2>&1)"; rc=$?
printf '%s\n' "$out" | grep -E '^(not ok|# (pass|fail))' | sed 's/^/  /'
[ "$rc" -eq 0 ] || printf '%s\n' "$out" | grep -A12 '^not ok' | sed 's/^/    /'
exit "$rc"
