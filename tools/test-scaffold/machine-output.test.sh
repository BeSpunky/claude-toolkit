#!/usr/bin/env bash
# The generated tools' MACHINE output stays plain under FORCE_COLOR — what a shell script reads is digits, not ANSI.
#
# THE RULE. A generated tool whose stdout a script parses writes STRINGS. console.log formats a non-string the way
# util.inspect does, and under FORCE_COLOR (which Nx's run-commands sets for every task it runs) a number comes out
# as `\e[33m9099\e[39m`. That shipped once: every `nx run firebase:seed:build` died in 80 ms on "usage:
# emulator-ports.mjs shift", and reap-emulators.sh's port reclaim matched nothing — SILENTLY — under
# `nx run firebase:emulators`. Run directly (no FORCE_COLOR), every tool looked fine.
#
# Two halves: the behaviour (each parsed command, run under FORCE_COLOR=1 the way Nx runs it), and a static guard
# over every generator template, so the next tool that prints a bare value is caught where it is written.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$ROOT/plugins/house/engine/nx-tools/src/generators"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-70s\n' "$1"; else printf '  FAIL %-70s\n' "$1"; FAILED=1; fi }

# ── emulator-ports.mjs, as the generator renders it ─────────────────────────────────────────────────
node "$ROOT/tools/test-scaffold/emulator-ports.mjs" "$TMP"
printf '{ "emulators": { "auth": { "port": 9099 }, "firestore": { "port": 8080, "websocketPort": 9150 }, "ui": { "enabled": true, "port": 4000 } } }\n' > "$TMP/firebase.json"
export FORCE_COLOR=1

ports="$(node "$TMP/tools/emulator-ports.mjs" ports "$TMP/firebase.json")"
ok "ports: one plain number per line (FORCE_COLOR=1)" "$(grep -qvE '^[0-9]+$' <<<"$ports" && echo 0 || echo 1)"
ok "ports: lists the declared ports" "$(grep -qx 9099 <<<"$ports" && grep -qx 9150 <<<"$ports" && echo 1 || echo 0)"

offset="$(node "$TMP/tools/emulator-ports.mjs" free-offset "$TMP/firebase.json")"
ok "free-offset: a plain number (FORCE_COLOR=1) — got '$(printf '%q' "$offset")'" "$(grep -qxE '[0-9]+' <<<"$offset" && echo 1 || echo 0)"

# The consumer exactly as tools/seed/build-seeds.sh is: the free offset straight into `shift`.
if node "$TMP/tools/emulator-ports.mjs" shift "$TMP/firebase.json" "$offset" "$TMP/shifted.json" 2>"$TMP/shift.err"; then
  shifted="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).emulators.auth.port))' "$TMP/shifted.json")"
  ok "shift <free-offset>: accepted and applied (auth $((9099 + offset)))" "$([ "$shifted" = "$((9099 + offset))" ] && echo 1 || echo 0)"
else
  ok "shift <free-offset>: accepted ($(cat "$TMP/shift.err"))" 0
fi

# ── Static guard: no generator template hands a bare value to console.log/console.info ──────────────
# `console.log(port)`, `console.log(offset)`, `console.log(resolvePath())` — a lone identifier, member chain or
# call. A string or template literal is safe (strings are printed as-is), and so is a SCREAMING_CASE constant (the
# house spelling of a string constant, e.g. dev.mjs's USAGE); anything else must be made a string first.
hits="$(grep -rnE 'console\.(log|info)\(\s*[A-Za-z_$][A-Za-z0-9_$.]*(\(\))?\s*\)' "$GEN" --include='*.tpl' --include='*.mjs' \
  | grep -vE 'console\.(log|info)\(\s*[A-Z][A-Z0-9_]*\s*\)' || true)"
ok "no generator template prints a bare value with console.log" "$([ -z "$hits" ] && echo 1 || echo 0)"
[ -z "$hits" ] || sed "s|^$GEN/|    |" <<<"$hits"

exit "$FAILED"
