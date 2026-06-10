#!/usr/bin/env bash
# Launch the local Firebase emulator suite for development — the single launch path
# the Nx `firebase:emulators*` targets all funnel through (so the reap → prime → start
# recipe lives in exactly one place instead of being copy-pasted across five targets).
#
# Three steps, in order:
#   1. reap   — clear any stale emulator processes/ports from an ungraceful prior exit
#               (tools/reap-emulators.sh — see its header for the root cause).
#   2. prime  — make sure the working data dir exists (from the default seed on a fresh
#               clone), so --import has something to load (tools/emulator-data.sh).
#   3. start  — boot the suite, IMPORTING the working dir and, on the full run only,
#               EXPORTING back to it on a clean exit. That import/export pair is the
#               "caching": onboard once and your session + data survive every serve.
#
# Persistence is ON for the full suite and OFF for any focused `--only` run: a partial
# run (e.g. auth-only) would otherwise export ONLY its slice on exit and clobber the
# firestore/storage data sitting in the shared working dir. Focused runs still IMPORT
# the cached world (handy for debugging against real data) — they just don't write it back.
#
#   bash tools/emulators.sh                  # full suite, cached (import + export)
#   bash tools/emulators.sh --only auth,ui   # focused, import-only (no export)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DATA_DIR="$ROOT/.emulator-data"
# `demo-` is Firebase's documented convention for "offline only, no cloud calls" — no
# login, no .firebaserc, no real GCP project needed. Must match environment.ts.
PROJECT="demo-{{workspaceName}}"

# Pass through an optional `--only <list>` (the focused targets use it); its presence
# is also what flips persistence off (see header).
ONLY_ARGS=()
PERSIST=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only)
      ONLY_ARGS=(--only "$2")
      PERSIST=0
      shift 2
      ;;
    *)
      echo "[emulators] unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

bash "$ROOT/tools/reap-emulators.sh"
bash "$ROOT/tools/emulator-data.sh" ensure

# Only import when the working dir is actually primed — `--import` on a missing dir is
# a hard error. On a brand-new clone with no seeds built yet, we start fresh and (when
# persisting) the clean exit writes the first export, so the next serve has data to import.
IMPORT_ARGS=()
[ -f "$DATA_DIR/firebase-export-metadata.json" ] && IMPORT_ARGS=(--import "$DATA_DIR")

EXPORT_ARGS=()
[ "$PERSIST" -eq 1 ] && EXPORT_ARGS=(--export-on-exit "$DATA_DIR")

exec firebase emulators:start \
  --project="$PROJECT" \
  "${ONLY_ARGS[@]}" \
  "${IMPORT_ARGS[@]}" \
  "${EXPORT_ARGS[@]}"
