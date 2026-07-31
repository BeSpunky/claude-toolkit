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
# WHAT MAKES IT SAFE — AND THE ARGUMENT THAT DID NOT
#   This block used to reason: each project runs in its own (bridge-network) devcontainer, so
#   anything bound to these ports — or running from this project's emulator cache — is
#   unambiguously THIS project's own leftover. The first half is true. The conclusion does not
#   follow, because it silently equates BELONGS TO THIS PROJECT with IS STALE, and a healthy suite
#   started thirty seconds ago belongs to this project too. Acting on it, a second `nx serve` tore
#   down the suite a developer was using — and via SIGKILL, which skips firebase-tools'
#   export-on-exit, so the session and seeded data went with it.
#
#   What actually separates the two is OWNERSHIP, and it is observable rather than assumed: the
#   emulator JVMs are spawned as grandchildren of the dev-server task, so a live suite's JVM has a
#   live parent, while an ungracefully-killed one is reparented to PID 1. Every kill below is gated
#   on that test (`is_orphan`). A live, owned holder is never killed — the run stops and says what
#   is in the way, which is the house rule this file used to break: never kill a server you didn't
#   start.
#
# Two passes: (0) kill orphaned emulator BINARY processes by their cache path — this catches the
# fallback-port and alive-but-unbound orphans the port scan cannot see; then (1) reclaim, and
# verify free, the configured ports from firebase.json (single source of truth) plus the hub
# (4400) and logging (4500) ports firebase-tools always uses — this catches the firebase-tools
# node/hub process, which the cache-path sweep does not match.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Args: [config-path] [isolated]. ISOLATED mode (a port-offset stack from `<app>:serve --portOffset`)
# reclaims ONLY the shifted ports in the given config and SKIPS the global JVM sweep below — because
# a base emulator suite the developer is running coexists with this one, and both the sweep and the
# base-port/hub reclaim would kill THAT suite. Default (no args) is the original single-suite reclaim.
FIREBASE_JSON="${1:-$ROOT/firebase.json}"
ISOLATED="${2:-}"
[ -f "$FIREBASE_JSON" ] || exit 0

# Extract configured emulator ports via node (always present in the devcontainer). In full mode add
# the fixed hub/logging ports (4400/4500) firebase-tools always uses; in isolated mode the config
# already carries the SHIFTED hub/logging, so add nothing base. De-duplicated, one per line.
mapfile -t PORTS < <(node -e '
  const fs = require("fs");
  const cfg = (JSON.parse(fs.readFileSync(process.argv[1], "utf8")).emulators) || {};
  const extra = process.argv[2] === "isolated" ? [] : [4400, 4500];
  const ports = Object.values(cfg)
    .filter((v) => v && typeof v === "object" && typeof v.port === "number")
    .map((v) => v.port);
  for (const p of new Set([...ports, ...extra])) console.log(p);
' "$FIREBASE_JSON" "$ISOLATED" 2>/dev/null)

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
#
# IT NOW RUNS IN EVERY MODE, and dropping that split is a fix rather than a simplification. The
# sweep used to be skipped for an isolated stack because it matched EVERY emulator JVM in the
# container with no way to tell the developer's base suite from this stack's own orphan. Ownership
# is that way. And the skip had a cost that grows: an isolated stack that dies ungracefully strands
# JVMs on an offset no later run enumerates, so the port reclaim can never see them — they simply
# accumulate until the container restarts. The sweep is the only thing that catches those, which
# makes running it everywhere the point, not a side effect.
# ── ORPHAN, NOT MERELY PRESENT ────────────────────────────────────────────────────────────────
# This is the distinction the sweep was missing, and the bug it caused was ugly: it killed every
# emulator JVM in the container, so a second `nx serve` — one Claude ran while the developer had
# the app up — tore down the RUNNING suite. Worse than an interruption: SIGKILL skips
# firebase-tools' export-on-exit handler, so the session and seeded data went with it.
#
# The header below argues the sweep is safe because anything matching is "unambiguously THIS
# project's own leftover". True, and beside the point: it silently equates BELONGS TO THIS PROJECT
# with IS STALE. A healthy suite a developer started thirty seconds ago also belongs to this
# project. It is also the rule HOUSE.rules.md states outright — never kill a server you didn't
# start — broken by house tooling, automatically, on every serve.
#
# An orphan is identifiable rather than assumed: firebase-tools spawns the JVM as a grandchild, so
# a LIVE suite's JVM has a live parent (the firebase-tools node process). When that parent dies
# ungracefully the kernel reparents the JVM to PID 1. So `PPID == 1` is the question, and it is the
# only one that separates "left behind by a crash" from "running for someone right now".
is_orphan() {   # is_orphan <pid> — true when the process has been reparented, i.e. its owner is gone
  local ppid
  ppid="$(ps -o ppid= -p "$1" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$ppid" ] && [ "$ppid" = "1" ]
}

EMU_PROC='firebase/emulators/[^[:space:]]+\.jar'
orphans=()
live=0
while read -r pid; do
  [ -n "$pid" ] || continue
  if is_orphan "$pid"; then orphans+=("$pid"); else live=$((live + 1)); fi
done < <(pgrep -f "$EMU_PROC" 2>/dev/null || true)

if [ "$live" -gt 0 ]; then
  # Not a warning about something to fix — a statement that we deliberately left it alone.
  echo "[reap-emulators] $live emulator process(es) are alive and owned — leaving them running."
fi
if [ "${#orphans[@]}" -gt 0 ]; then
  echo "[reap-emulators] ${#orphans[@]} orphaned emulator process(es) (reparented to PID 1) — sending SIGTERM"
  kill -TERM "${orphans[@]}" >/dev/null 2>&1 || true
  for ((tick = 0; tick < 15; tick++)); do
    still=()
    for pid in "${orphans[@]}"; do kill -0 "$pid" 2>/dev/null && still+=("$pid"); done
    [ "${#still[@]}" -eq 0 ] && break
    sleep 0.1
  done
  still=()
  for pid in "${orphans[@]}"; do kill -0 "$pid" 2>/dev/null && still+=("$pid"); done
  if [ "${#still[@]}" -gt 0 ]; then
    echo "[reap-emulators] orphan(s) still alive — forcing (SIGKILL)"
    kill -KILL "${still[@]}" >/dev/null 2>&1 || true
  fi
fi

# Helper: echo the ports from PORTS that are still bound, one per line.
held_ports() {
  local port
  for port in "${PORTS[@]}"; do
    fuser -s "${port}/tcp" 2>/dev/null && echo "$port"
  done
}

# The PIDs holding a port. `fuser` writes the `8080/tcp:` label to stderr and the pids to stdout.
port_holders() { fuser "${1}/tcp" 2>/dev/null | tr -s '[:space:]' '\n' | grep -E '^[0-9]+$' || true; }

mapfile -t held < <(held_ports)
[ "${#held[@]}" -eq 0 ] && exit 0

# CLASSIFY BEFORE KILLING ANYTHING. `fuser -k` is indiscriminate: it kills whoever holds the port,
# which is fine for an orphan and catastrophic for a suite someone is using — or for an unrelated
# process that simply happens to be on 8080. The same PPID==1 test as the sweep above decides, and
# a live owner means we stop rather than take the port from it. The caller chains us with `&&`, so
# exiting non-zero here stops the launch with a cause the user can act on, instead of "fixing" the
# collision by destroying the thing it collided with.
live_holders=()
for port in "${held[@]}"; do
  while read -r pid; do
    [ -n "$pid" ] || continue
    is_orphan "$pid" || live_holders+=("port ${port} — pid ${pid} ($(ps -o comm= -p "$pid" 2>/dev/null | tr -d '[:space:]'))")
  done < <(port_holders "$port")
done
if [ "${#live_holders[@]}" -gt 0 ]; then
  echo "[reap-emulators] REFUSING to reclaim: these ports are held by LIVE, owned processes:" >&2
  for entry in "${live_holders[@]}"; do echo "[reap-emulators]   ${entry}" >&2; done
  echo "[reap-emulators] Something is already running here — most likely an emulator suite you started." >&2
  echo "[reap-emulators] Nothing was killed. Stop it yourself, or serve on an isolated stack:" >&2
  echo "[reap-emulators]   nx serve <app> --portOffset=auto" >&2
  exit 1
fi

# Everything still held is an orphan. Graceful first: a Firestore JVM catches SIGTERM and unwinds
# cleanly, which is preferable to a hard kill.
for port in "${held[@]}"; do
  echo "[reap-emulators] port ${port} held by an orphaned process — sending SIGTERM"
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
