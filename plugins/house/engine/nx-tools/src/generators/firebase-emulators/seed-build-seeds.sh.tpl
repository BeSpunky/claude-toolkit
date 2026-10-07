#!/usr/bin/env bash
# Rebuild the committed emulator seeds from their single source of truth (tools/seed/world.mjs).
# For each world: start a clean, isolated emulator pair, run the seed script against it, and
# export the resulting state into tools/emulator-seeds/<name>/. Commit that folder.
#
# Run this whenever the seeded world or the Firestore document shapes change:
#   yarn nx run firebase:seed:build
#
# `firebase emulators:exec` boots the emulators, waits until they're ready, runs the command,
# then (because of --export-on-exit) writes the data out and shuts down — fully unattended.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PROJECT="demo-{{workspaceName}}"

# The seeds to build are whatever worlds tools/seed/world.mjs declares — so adding a
# world there is the only edit needed; this orchestrator adapts automatically.
mapfile -t SEEDS < <(node --input-type=module -e \
  'import { WORLDS } from "./tools/seed/world.mjs"; console.log(Object.keys(WORLDS).join("\n"));')

# ITS OWN STACK. A seed build is a short-lived emulator suite of its own, so it gets what every stack gets (see
# tools/emulators.sh): it CLAIMS a free, SHIFTED port block through the dev engine — never the base ports, which
# belong to the suite the developer may have up, and never a block any other stack holds or is still saving on —
# and gets the stack's own short TMPDIR, so firebase-tools' hub locator (keyed by project id alone) is not shared
# with a running suite. The stack lives while its LOCK is held: this script takes it before the claim and
# firebase-tools inherits it, so `tools/dev/dev ps` shows the stack for exactly as long as any of it runs.
mkdir -p "$ROOT/.bespunky/run/locks"
STACK_LOCK="$ROOT/.bespunky/run/locks/$$-$RANDOM$RANDOM.lock"
exec {STACK_LOCK_FD}>"$STACK_LOCK"
flock -s -n "$STACK_LOCK_FD"
STACK_KEY=''
CONFIG=''
FB=''
# Released when this script ends — after its suite has: our descriptor closed, then the record removed (or, with no
# claim made, the lock file).
trap 'exec {STACK_LOCK_FD}>&-; [ -z "$CONFIG" ] || rm -f "$CONFIG"; if [ -n "$STACK_KEY" ]; then node "$ROOT/tools/dev/dev.mjs" release "$STACK_KEY" --lock="$STACK_LOCK" >/dev/null 2>&1 || true; else rm -f "$STACK_LOCK"; fi' EXIT
# A STOP (`tools/dev/dev stop seed-build --offset=N`, a Ctrl+C, a closed terminal) is passed to the suite, and this
# script waits for it to end before it releases anything: dying at once used to leave `firebase emulators:exec` and
# its JVMs running on the claimed block with no record left to find them by.
stop_suite() {
  trap '' TERM INT HUP
  echo "[seed] stopping — waiting for the emulator suite to shut down…" >&2
  if [ -n "$FB" ]; then
    kill -TERM "$FB" 2>/dev/null || true
    wait "$FB" 2>/dev/null || true
  fi
  exit 143
}
trap stop_suite TERM INT HUP
CLAIM="$(node "$ROOT/tools/dev/dev.mjs" claim seed-build --pid=$$ --lock="$STACK_LOCK" --shifted --port-offset=auto \
  --ports="$(node "$ROOT/tools/emulator-ports.mjs" claim "$ROOT/firebase.json")")" || exit 1
eval "$CLAIM"
OFFSET="$STACK_OFFSET"
# The shifted config sits beside firebase.json (firebase-tools resolves its relative paths — the functions
# bundle, rules — from the config's own directory), under the ignored /.firebase.offset-*.json.
CONFIG="$ROOT/.firebase.offset-$OFFSET-seed.json"
node "$ROOT/tools/emulator-ports.mjs" shift "$ROOT/firebase.json" "$OFFSET" "$CONFIG"
export TMPDIR="$STACK_TMP"
echo "[seed] own emulator stack $STACK_KEY on port offset $OFFSET (TMPDIR $STACK_TMP)"

for seed in "${SEEDS[@]}"; do
  dir="tools/emulator-seeds/$seed"
  echo "[seed] building '$seed' → $dir"
  rm -rf "$dir"
  # Only auth + firestore are needed to seed the world; export-on-exit captures both. In the background and waited
  # for, so a stop reaches this script while it runs (bash runs a trap only between commands).
  firebase --config "$CONFIG" emulators:exec \
    --only auth,firestore \
    --project="$PROJECT" \
    --export-on-exit "$dir" \
    "node tools/seed/build.mjs $seed" &
  FB=$!
  wait "$FB"
  FB=''
done

echo "[seed] done — commit tools/emulator-seeds/. ('default' is where a fresh serve / reset lands.)"
