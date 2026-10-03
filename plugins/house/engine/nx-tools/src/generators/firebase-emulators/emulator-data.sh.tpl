#!/usr/bin/env bash
# The emulator working-data lifecycle — the one place that owns the relationship
# between the **ephemeral, gitignored working dir** the emulators import/export and
# the **committed, pristine seeds** under tools/emulator-seeds/.
#
#   .emulator-data/              ← the cache: what `nx serve` imports on start and
#                                  writes back on a clean exit (gitignored, ephemeral)
#   tools/emulator-seeds/<name>/ ← the seeds: known-good worlds, checked in, rebuilt
#                                  by `nx run firebase:seed:build` (never written here)
#
# Two responsibilities, nothing more:
#   ensure          — prime the working dir from the default seed IF it's empty, so the
#                     very first serve (fresh clone, or just after a reset) starts in a
#                     known world instead of erroring on a missing --import dir.
#   reset [<seed>]  — the on-call reset: wipe the working dir and reprime it from the
#                     named seed (default: default). Takes effect on the next serve.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT/.emulator-data"
SEEDS_DIR="$ROOT/tools/emulator-seeds"
DEFAULT_SEED="default"

# An import dir is only usable to `firebase emulators:start --import` once it carries
# the export metadata firebase writes; its presence is our "primed" signal.
is_primed() { [ -f "$DATA_DIR/firebase-export-metadata.json" ]; }

seed_path() { echo "$SEEDS_DIR/$1"; }

prime_from_seed() {
  local seed="$1" src
  src="$(seed_path "$seed")"
  if [ ! -f "$src/firebase-export-metadata.json" ]; then
    echo "[emulator-data] seed '$seed' not found at $src" >&2
    echo "[emulator-data] build the seeds first:  yarn nx run firebase:seed:build" >&2
    return 1
  fi
  rm -rf "$DATA_DIR"
  cp -r "$src" "$DATA_DIR"
  echo "[emulator-data] working data primed from the '$seed' seed."
}

cmd="${1:-}"
case "$cmd" in
  ensure)
    # Already primed (your cached session) → leave it untouched. Empty → prime from
    # the default seed if one exists; if no seeds are built yet, stay empty and let
    # emulators.sh start fresh (it only passes --import when the dir is primed).
    if is_primed; then
      exit 0
    elif [ -f "$(seed_path "$DEFAULT_SEED")/firebase-export-metadata.json" ]; then
      prime_from_seed "$DEFAULT_SEED"
    else
      echo "[emulator-data] no working data and no '$DEFAULT_SEED' seed yet — starting fresh."
      echo "[emulator-data] build seeds anytime with:  yarn nx run firebase:seed:build"
    fi
    ;;
  reset)
    seed="${2:-$DEFAULT_SEED}"
    prime_from_seed "$seed"
    echo "[emulator-data] reset to '$seed'. Restart your serve (or it takes effect on the next one)."
    ;;
  *)
    echo "usage: emulator-data.sh {ensure | reset [<seed-name>]}" >&2
    exit 2
    ;;
esac
