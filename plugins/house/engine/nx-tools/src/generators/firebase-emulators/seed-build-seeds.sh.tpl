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

# Clear any stale emulator processes/ports first, so the exec runs can bind cleanly.
bash "$ROOT/tools/reap-emulators.sh"

for seed in "${SEEDS[@]}"; do
  dir="tools/emulator-seeds/$seed"
  echo "[seed] building '$seed' → $dir"
  rm -rf "$dir"
  # Only auth + firestore are needed to seed the world; export-on-exit captures both.
  firebase emulators:exec \
    --only auth,firestore \
    --project="$PROJECT" \
    --export-on-exit "$dir" \
    "node tools/seed/build.mjs $seed"
done

echo "[seed] done — commit tools/emulator-seeds/. ('default' is where a fresh serve / reset lands.)"
