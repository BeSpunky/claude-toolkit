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

# The emulator suite MUST run under the SAME projectId the app's client uses. The moment any
# service is switched to real (e.g. real Auth), that real `projectId` is used for ALL services
# (singleProjectMode) — so a still-emulated Firestore/Storage launched under a DIFFERENT project
# id hits a mismatch and silently falls back to offline. The projectId has ONE source of truth —
# the app's environment.ts — so we DERIVE it here rather than hardcode a copy that drifts.
# `demo-` is Firebase's "offline only, no cloud project needed" convention and the safe fallback
# when no env file is found. One suite = one project (singleProjectMode), so it follows the
# PRIMARY app this workspace was wired with; set FIREBASE_EMULATOR_PROJECT for anything unusual.
# (Seeds are always built under demo-{{workspaceName}} — see tools/seed/build-seeds.sh — and import
# fine under a derived real id because singleProjectMode collapses project ids.)
#   Precedence:  FIREBASE_EMULATOR_PROJECT (override)  >  environment.ts  >  demo-{{workspaceName}}
ENV_FILE="$ROOT/{{appEnvPath}}"
derive_project() {
  [[ -f "$ENV_FILE" ]] || return 1
  local id
  # Anchor to the field (line, after indent, begins with `projectId:`) so a comment that merely
  # mentions `projectId:` — comments start with `//` — can't shadow the real value.
  id="$(grep -oE "^[[:space:]]*projectId:[[:space:]]*[\"'][^\"']+" "$ENV_FILE" | head -1 | sed -E "s/.*[\"']//")"
  [[ -n "$id" ]] && printf '%s' "$id"
}
PROJECT="${FIREBASE_EMULATOR_PROJECT:-$(derive_project || echo demo-{{workspaceName}})}"
echo "[emulators] project: $PROJECT" >&2

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

# Local Functions secrets: the Functions emulator reads `.secret.local` from the loaded bundle
# (firebase.json → dist/apps/functions), but the file lives with the app source
# (apps/functions/.secret.local, gitignored). It is deliberately NOT a build asset — Nx skips
# gitignored assets anyway, and routing a secret through build outputs would persist it into the
# Nx cache. Copy it into place at launch, so it stays a runtime concern of the emulator alone.
# (Re-run the suite after a functions rebuild — `deleteOutputPath` wipes dist.)
#
# `.secret.local` is a CLONE-level resource, not a per-worktree one: it's gitignored, so a
# freshly-created git worktree never receives a copy — and its emulated functions would then
# launch WITHOUT the secret (failing e.g. an OAuth code→token exchange with "client_secret is
# missing"). Resolve it as a cascade: the current tree's own file wins (a worktree may still drop
# in its own), else fall back to the MAIN worktree's copy (git lists it first). So serving ANY
# worktree — `nx serve` here or `<app>:serve-worktree` — reuses the one secret the main tree
# holds, with no per-worktree setup.
SECRETS_FILE="$ROOT/apps/functions/.secret.local"
if [ ! -f "$SECRETS_FILE" ]; then
  MAIN_WORKTREE="$(git -C "$ROOT" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | head -1)"
  if [ -n "$MAIN_WORKTREE" ] && [ "$MAIN_WORKTREE" != "$ROOT" ] && [ -f "$MAIN_WORKTREE/apps/functions/.secret.local" ]; then
    echo "[emulators] .secret.local absent in this worktree; using the main worktree's copy: $MAIN_WORKTREE" >&2
    SECRETS_FILE="$MAIN_WORKTREE/apps/functions/.secret.local"
  fi
fi
if [ -f "$SECRETS_FILE" ] && [ -d "$ROOT/dist/apps/functions" ]; then
  cp "$SECRETS_FILE" "$ROOT/dist/apps/functions/.secret.local"
fi

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
