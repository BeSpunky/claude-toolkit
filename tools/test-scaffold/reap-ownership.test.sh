#!/usr/bin/env bash
# `tools/reap-emulators.sh` — does it tell an ORPHAN from a running suite?
#
# WHAT THIS GUARDS. The reaper used to kill every emulator JVM in the container, so a second
# `nx serve` — one an agent ran while the developer had the app up — tore down the RUNNING suite.
# And via SIGKILL, which skips firebase-tools' export-on-exit, so the session and seeded data went
# with it. The distinction it was missing is ownership: a live suite's JVM has a live parent, an
# ungracefully-killed one is reparented to PID 1.
#
# If that test ever regresses, nothing says so. The reaper still "works" — it just quietly goes
# back to killing things people are using, and the only symptom is a developer's emulators dying
# for no visible reason.
#
# NEVER TOUCHES REAL PROCESSES. The rendered copy has its match pattern rewritten to a token unique
# to this run, and the fakes are named to match only that. So the suite cannot kill a real emulator
# — including a genuinely orphaned one, which is not this test's business to clean up.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="$ROOT/plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/reap-emulators.sh.tpl"

[ -f "$TPL" ] || { echo "FATAL: reap-emulators.sh.tpl not found at $TPL" >&2; exit 2; }
grep -q 'is_orphan' "$TPL" || {
  echo "FATAL: reap-emulators.sh.tpl no longer defines is_orphan — the ownership test moved or was removed." >&2
  exit 2
}

command -v pgrep >/dev/null 2>&1 || { echo "  skip  pgrep unavailable — cannot exercise the sweep"; exit 0; }

TMP="$(mktemp -d)"
TOKEN="reaptest$$"
FAKE_DIR="$TMP/cache/$TOKEN/emulators"
mkdir -p "$FAKE_DIR" "$TMP/ws/tools"

cleanup() { pkill -KILL -f "$TOKEN/emulators" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

# A stand-in for an emulator JVM: a script whose PATH matches the pattern the reaper looks for.
printf '#!/usr/bin/env bash\nsleep 300\n' > "$FAKE_DIR/fake.jar"
chmod +x "$FAKE_DIR/fake.jar"

# Render the reaper with its match pattern retargeted at our token, so it can only ever see fakes.
sed "s|firebase/emulators/|$TOKEN/emulators/|g" "$TPL" > "$TMP/ws/tools/reap-emulators.sh"
# A port nothing holds: the reaper exits early when no ports are configured, and would skip the sweep.
printf '{ "emulators": { "auth": { "port": 59731 } } }\n' > "$TMP/ws/firebase.json"

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-44s\n' "$1"; else printf '  FAIL %-44s\n' "$1"; FAILED=1; fi }

run_reap() { ( cd "$TMP/ws" && bash tools/reap-emulators.sh 2>&1 ); }
alive() { kill -0 "$1" 2>/dev/null && echo 1 || echo 0; }

# ── A LIVE, OWNED process must survive ──────────────────────────────────────────────────────────
# Started as a child of this shell, so its parent is alive — exactly the shape of a suite the
# developer is using.
# stdout/stderr to /dev/null is REQUIRED, not tidiness: a background child inherits this script's
# stdout, and when the suite is run through a pipe (`run.sh | tail`) that child holds the pipe open
# for its full lifetime — the reader blocks for 300 seconds and the suite looks hung.
bash "$FAKE_DIR/fake.jar" >/dev/null 2>&1 &
LIVE_PID=$!
disown "$LIVE_PID" 2>/dev/null || true   # keep job control from printing "Killed" when we tear it down
sleep 0.3
out="$(run_reap)"
sleep 0.3
ok 'live, owned process survives the sweep' "$(alive "$LIVE_PID")"
case "$out" in *'alive and owned'*) ok 'reaper reports leaving it alone' 1 ;; *) ok 'reaper reports leaving it alone' 0 ;; esac
kill -KILL "$LIVE_PID" 2>/dev/null

# ── An ORPHAN must be reaped ────────────────────────────────────────────────────────────────────
# Double-fork: the intermediate subshell exits immediately, so the kernel reparents the survivor to
# PID 1 — the shape firebase-tools leaves behind when it is killed ungracefully.
( bash "$FAKE_DIR/fake.jar" >/dev/null 2>&1 & )
sleep 0.4
ORPHAN_PID="$(pgrep -f "$TOKEN/emulators" | head -1)"
if [ -z "$ORPHAN_PID" ]; then
  echo "  skip  could not spawn an orphan fixture in this environment"
else
  ppid="$(ps -o ppid= -p "$ORPHAN_PID" 2>/dev/null | tr -d '[:space:]')"
  if [ "$ppid" != "1" ]; then
    # Some environments run a subreaper that adopts orphans instead of PID 1. Say so rather than
    # reporting a pass or a failure that would both be lies.
    echo "  skip  orphan reparented to PID $ppid, not 1 (subreaper in this environment)"
  else
    out="$(run_reap)"
    sleep 0.5
    ok 'orphan is reaped' "$([ "$(alive "$ORPHAN_PID")" = 0 ] && echo 1 || echo 0)"
    case "$out" in *'orphaned emulator process'*) ok 'reaper reports the reap' 1 ;; *) ok 'reaper reports the reap' 0 ;; esac
  fi
fi

exit "$FAILED"
