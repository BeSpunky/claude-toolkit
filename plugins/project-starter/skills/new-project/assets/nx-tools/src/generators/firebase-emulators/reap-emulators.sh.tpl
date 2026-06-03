#!/usr/bin/env bash
# Reap stale Firebase emulator processes before a fresh `firebase emulators:start`.
#
# ROOT CAUSE this addresses
#   The emulator suite (Firestore / Storage / functions runtime) runs on the JVM, spawned as a
#   grandchild of the dev-server task: nx -> sh -> firebase-tools -> java. firebase-tools only
#   tears that JVM down when IT receives SIGINT/SIGTERM and runs its cleanup handler. On an
#   UNGRACEFUL death — terminal/IDE window closed (SIGHUP that never reaches the grandchild),
#   container stop/restart, host sleep, OOM-kill, any SIGKILL — that handler never runs, the JVM
#   is re-parented to PID 1, and it keeps holding its port. The next start then fails with
#   "Port NNNN is not open on localhost". No in-process trap can cover SIGKILL or container
#   restart, so the only robust fix is to RECLAIM THE PORTS ON START rather than to tear down
#   better on exit.
#
# WHY THIS IS SAFE
#   Each project runs in its own (bridge-network) devcontainer, so anything bound to these ports
#   inside the container is unambiguously THIS project's own leftover — never another project's
#   emulator. And `serve` always boots its own suite via `dependsOn: ['emulators']`, so there is
#   no "reuse a running suite" model to break by reaping.
#
# Ports come from firebase.json (single source of truth — stays correct if you re-port an
# emulator) plus the emulator hub (4400) and logging (4500) ports firebase-tools always uses.
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

# Pass 1: graceful — ask any holder to shut down (SIGTERM).
reaped=0
for port in "${PORTS[@]}"; do
  if fuser -s "${port}/tcp" 2>/dev/null; then
    echo "[reap-emulators] port ${port} held by a stale process — sending SIGTERM"
    fuser -k -TERM "${port}/tcp" >/dev/null 2>&1 || true
    reaped=1
  fi
done

# Pass 2: force — anything still bound after a grace period gets SIGKILL.
if [ "$reaped" -eq 1 ]; then
  sleep 1
  for port in "${PORTS[@]}"; do
    if fuser -s "${port}/tcp" 2>/dev/null; then
      echo "[reap-emulators] port ${port} still held — forcing (SIGKILL)"
      fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    fi
  done
fi

exit 0
