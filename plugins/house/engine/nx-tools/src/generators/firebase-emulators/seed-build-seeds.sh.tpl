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
# with a running suite. `tools/dev/dev ps` shows it while it runs; it is released when this script ends. It used to
# probe for a free block on its own, which a serve starting in the same second could take too.
CLAIM="$(node "$ROOT/tools/dev/dev.mjs" claim seed-build --pid=$$ --shifted \
  --ports="$(node "$ROOT/tools/emulator-ports.mjs" claim "$ROOT/firebase.json")")" || exit 1
eval "$CLAIM"
OFFSET="$STACK_OFFSET"
# The shifted config sits beside firebase.json (firebase-tools resolves its relative paths — the functions
# bundle, rules — from the config's own directory), under the ignored /.firebase.offset-*.json.
CONFIG="$ROOT/.firebase.offset-$OFFSET-seed.json"
trap 'rm -f "$CONFIG"; node "$ROOT/tools/dev/dev.mjs" release "$STACK_KEY" --pid=$$ >/dev/null 2>&1 || true' EXIT
node "$ROOT/tools/emulator-ports.mjs" shift "$ROOT/firebase.json" "$OFFSET" "$CONFIG"
export TMPDIR="$STACK_TMP"
echo "[seed] own emulator stack $STACK_KEY on port offset $OFFSET (TMPDIR $STACK_TMP)"

for seed in "${SEEDS[@]}"; do
  dir="tools/emulator-seeds/$seed"
  echo "[seed] building '$seed' → $dir"
  rm -rf "$dir"
  # Only auth + firestore are needed to seed the world; export-on-exit captures both.
  firebase --config "$CONFIG" emulators:exec \
    --only auth,firestore \
    --project="$PROJECT" \
    --export-on-exit "$dir" \
    "node tools/seed/build.mjs $seed"
done

echo "[seed] done — commit tools/emulator-seeds/. ('default' is where a fresh serve / reset lands.)"
