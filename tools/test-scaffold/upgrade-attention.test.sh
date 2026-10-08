#!/usr/bin/env bash
# house.sh's UPGRADE_ATTENTION — what the generators need a human to look at, in the summary, not lost in the log.
#
# WHAT THIS GUARDS. The house-targets merge replaces a project's value inside a house target (an edit both sides
# changed, a value with no record to judge it by, a deploy-contract value) or keeps a project's own target over the
# house's. It always logged a warning — buried among hundreds of generator lines nobody reads once UPGRADE_OK prints.
# So each such line also lands in a report file in the upgrade lock (nx-tools _utils/upgrade-report.ts, named by
# BESPUNKY_UPGRADE_REPORT), and the outer summary prints it. A regression here is SILENT — the summary just stops
# saying it — so: the reporter, extracted and run (an empty extraction fails loudly), and its two wires, read.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOUSE_SH="$ROOT/plugins/house/engine/house.sh"
[ -f "$HOUSE_SH" ] || { echo "FATAL: house.sh not found at $HOUSE_SH" >&2; exit 2; }

block="$(awk '/^# --->8--- UPGRADE_ATTENTION$/{f=1;next} /^# ---8<--- UPGRADE_ATTENTION$/{exit} f{print}' "$HOUSE_SH")"
case "$block" in
  *_upgrade_attention*UPGRADE_ATTENTION*) ;;
  *) echo "FATAL: could not extract the UPGRADE_ATTENTION block from house.sh — an empty extraction would test nothing." >&2; exit 2 ;;
esac
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
eval "$block"

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %s\n' "$1"; else printf '  FAIL %s (%s)\n' "$1" "${3:-}"; FAILED=1; fi }

mkdir -p "$TMP/lock"
out="$(_upgrade_attention "$TMP/lock")"
ok "no report file: silent" "$([ -z "$out" ] && echo 1 || echo 0)" "$out"
out="$(_upgrade_attention '')"
ok "no lock (a new project): silent" "$([ -z "$out" ] && echo 1 || echo 0)" "$out"

printf '%s\n' '[firebase-emulators] functions:deploy — runs: your {"command":"mine"} was replaced by the house'"'"'s new {"command":"x"}' \
  '[firebase-emulators] firebase:deploy: this project already defines a `deploy` target of its own, so it is KEPT' > "$TMP/lock/report"
out="$(_upgrade_attention "$TMP/lock")"
ok "a header line that counts them" "$(grep -qx 'UPGRADE_ATTENTION: 2 thing(s) .*' <<<"$out" && echo 1 || echo 0)" "$out"
ok "every line relayed, indented, verbatim" "$(grep -qF '  [firebase-emulators] functions:deploy — runs: your {"command":"mine"}' <<<"$out" && grep -qF '  [firebase-emulators] firebase:deploy: this project already defines' <<<"$out" && echo 1 || echo 0)" "$out"

# The two wires: the plan runner names the file inside the lock, and the summary calls the reporter with the lock.
ok "the plan runner exports BESPUNKY_UPGRADE_REPORT into the lock" \
  "$(grep -qF 'export BESPUNKY_UPGRADE_REPORT=\"\$PWD/.bespunky-upgrade.lock/report\"' "$HOUSE_SH" && echo 1 || echo 0)"
ok "the upgrade summary calls the reporter with the lock" "$(grep -qE '^  _upgrade_attention "\$\{UPGRADE_LOCK:-\}"$' "$HOUSE_SH" && echo 1 || echo 0)"
ok "the generators' side names the same variable" \
  "$(grep -qF "UPGRADE_REPORT_ENV = 'BESPUNKY_UPGRADE_REPORT'" "$ROOT/plugins/house/engine/nx-tools/src/generators/_utils/upgrade-report.ts" && echo 1 || echo 0)"

exit "$FAILED"
