#!/usr/bin/env bash
# Reap stale Firebase emulator processes before a fresh `firebase emulators:start`.
#
# ROOT CAUSE this addresses
#   The emulator suite (Firestore / Storage / functions runtime) runs on the JVM, spawned as a
#   grandchild of the dev-server task: nx -> sh -> firebase-tools -> java. firebase-tools only
#   tears that JVM down when IT receives SIGINT/SIGTERM and runs its cleanup handler. On an
#   UNGRACEFUL death — terminal/IDE window closed (SIGHUP that never reaches the grandchild),
#   container stop/restart, host sleep, OOM-kill, any SIGKILL — that handler never runs, the JVM
#   is re-parented to PID 1 and lingers — sometimes still holding its port, sometimes on a
#   FALLBACK port firebase-tools picked (hub 4401, ws 9151), sometimes alive-but-unbound mid-
#   teardown (a Firestore JVM that already released 8080). Any survivor breaks the next start:
#   "Port NNNN is not open", or — when a stray hub is still up — "running multiple instances …
#   An unexpected error has occurred" and an abort. No in-process trap can cover SIGKILL or a
#   container restart, so the only robust fix is to RECLAIM ON START — and to do it by BOTH
#   process and port, so nothing slips through.
#
# WHY THIS IS SAFE
#   Each project runs in its own (bridge-network) devcontainer, so anything bound to these ports —
#   or running from this project's emulator cache — is unambiguously THIS project's own leftover,
#   never another project's. And `serve` always boots its own suite, so there is no "reuse a
#   running suite" model to break by reaping.
#
# Two passes: (0) kill orphaned emulator BINARY processes by their cache path — this catches the
# fallback-port and alive-but-unbound orphans the port scan cannot see; then (1) reclaim, and
# verify free, the configured ports from firebase.json (single source of truth) plus the hub
# (4400) and logging (4500) ports firebase-tools always uses — this catches the firebase-tools
# node/hub process, which the cache-path sweep does not match.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIREBASE_JSON="$ROOT/firebase.json"
[ -f "$FIREBASE_JSON" ] || exit 0

# Extract configured emulator ports via node (always present in the devcontainer), plus the
# fixed hub/logging ports. De-duplicated, one per line.
mapfile -t PORTS < <(node -e '
  const fs = require("fs");
  const cfg = (JSON.parse(fs.readFileSync(process.argv[1], "utf8")).emulators) || {};
  const ports = Object.values(cfg)
    .filter((v) => v && typeof v === "object" && typeof v.port === "number")
    .map((v) => v.port);
  for (const p of new Set([...ports, 4400, 4500])) console.log(p);
' "$FIREBASE_JSON" 2>/dev/null)

[ "${#PORTS[@]}" -eq 0 ] && exit 0

# ── Pass 0: reap orphaned emulator BINARY processes (independent of any port) ──────────────────
# The port scan below only sees CURRENTLY-BOUND holders. The emulator binaries the CLI downloads
# under ~/.cache/firebase/emulators (Firestore/Storage/Pub-Sub JVMs, the UI runtime) are spawned
# as grandchildren and, after an ungraceful death, linger reparented to PID 1 — on a fallback
# port we don't enumerate, or unbound mid-teardown. Either way the next start sees "multiple
# instances" and aborts. Kill them by their unmistakable cache path, independent of ports. The
# pattern matches a running emulator JAR specifically (firestore/database/pubsub/storage all run
# on the JVM, and the JVM grandchildren are the orphans that actually linger) — never the
# firebase-tools node process (handled by the hub/UI ports below) nor our own launch shell, so
# this can't sabotage the very start it guards.
EMU_PROC='firebase/emulators/[^[:space:]]+\.jar'
if pgrep -f "$EMU_PROC" >/dev/null 2>&1; then
  echo "[reap-emulators] stale emulator process(es) found — sending SIGTERM"
  pkill -TERM -f "$EMU_PROC" >/dev/null 2>&1 || true
  for ((tick = 0; tick < 15; tick++)); do
    pgrep -f "$EMU_PROC" >/dev/null 2>&1 || break
    sleep 0.1
  done
  if pgrep -f "$EMU_PROC" >/dev/null 2>&1; then
    echo "[reap-emulators] stale emulator process(es) still alive — forcing (SIGKILL)"
    pkill -KILL -f "$EMU_PROC" >/dev/null 2>&1 || true
  fi
fi

# Helper: echo the ports from PORTS that are still bound, one per line.
held_ports() {
  local port
  for port in "${PORTS[@]}"; do
    fuser -s "${port}/tcp" 2>/dev/null && echo "$port"
  done
}

# Graceful first: ask any holder to shut down (SIGTERM). A Firestore JVM catches this and
# unwinds cleanly, which is preferable to a hard kill.
mapfile -t held < <(held_ports)
[ "${#held[@]}" -eq 0 ] && exit 0
for port in "${held[@]}"; do
  echo "[reap-emulators] port ${port} held by a stale process — sending SIGTERM"
  fuser -k -TERM "${port}/tcp" >/dev/null 2>&1 || true
done

# VERIFIED reclaim — do NOT return until every port is actually free.
#   The caller chains us as `reap && firebase emulators:start`, so the instant we exit, firebase
#   tries to BIND these ports. Killing a holder is asynchronous: a SIGTERM'd JVM takes a moment
#   (sometimes seconds) to release its socket, and even a SIGKILL'd one isn't reclaimed by the
#   kernel synchronously. Returning before the port is confirmed free hands firebase a port that
#   is still held → "Port NNNN is not open". So we POLL until free, escalating SIGTERM → SIGKILL,
#   and only then exit. This is the difference between "we sent a kill" and "the port is free".
GRACE_TICKS=10           # ~1s of polite waiting for graceful shutdown before we force
DEADLINE_TICKS=100       # ~10s hard ceiling; past this the stale holder is wedged, not just slow
for ((tick = 0; tick < DEADLINE_TICKS; tick++)); do
  mapfile -t held < <(held_ports)
  [ "${#held[@]}" -eq 0 ] && exit 0   # every port confirmed free — safe to start firebase
  if [ "$tick" -eq "$GRACE_TICKS" ]; then
    for port in "${held[@]}"; do
      echo "[reap-emulators] port ${port} still held after grace — forcing (SIGKILL)"
      fuser -k -KILL "${port}/tcp" >/dev/null 2>&1 || true
    done
  fi
  sleep 0.1
done

# Still held after the hard ceiling: surface it loudly rather than silently letting firebase fail
# with its cryptic port message. Exit non-zero so the `&&` chain stops here with a clear cause.
mapfile -t held < <(held_ports)
echo "[reap-emulators] FAILED to reclaim port(s): ${held[*]} — a process is wedged holding them." >&2
echo "[reap-emulators] Inspect with: fuser -v ${held[0]}/tcp" >&2
exit 1
