#!/usr/bin/env bash
# Push the local Functions secrets file into Google Secret Manager — the PRODUCTION counterpart
# of the emulator's `.secret.local` (tools/emulators.sh injects the same file locally). One
# command, one source of truth: every `KEY=VALUE` in apps/functions/.secret.local becomes a
# `firebase functions:secrets:set KEY` on the target project, so local and prod can never drift
# on WHICH secrets exist.
#
# Values never touch a command line, a log, or this script's output: each one is piped into the
# CLI on stdin (`--data-file -`). Only key NAMES are printed.
#
#   bash tools/push-secrets.sh                        # project from .firebaserc / environment.prod.ts
#   FIREBASE_PROJECT=<id> bash tools/push-secrets.sh    # explicit override
#
# Nx target: `yarn nx run functions:push-secrets`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="$ROOT/apps/functions/.secret.local"
ENV_PROD="$ROOT/{{appEnvProdPath}}"

if [ ! -f "$SECRETS_FILE" ]; then
  echo "[push-secrets] no $SECRETS_FILE — copy apps/functions/.secret.local.example and fill it first." >&2
  exit 1
fi

# Target project, most explicit wins: FIREBASE_PROJECT > .firebaserc default > environment.prod.ts
# (the prod config these secrets serve). The projectId field is anchored (^\s*projectId:) so a
# comment can't shadow it — same idiom as tools/emulators.sh. `|| true` keeps a missing match from
# tripping `set -e`; an undeterminable project is reported below, not crashed on.
derive_project() {
  local id=""
  if [ -f "$ROOT/.firebaserc" ]; then
    id="$(grep -oE '"default":[[:space:]]*"[^"]+' "$ROOT/.firebaserc" | head -1 | sed -E 's/.*"//' || true)"
  fi
  if [ -z "$id" ] && [ -f "$ENV_PROD" ]; then
    id="$(grep -oE "^[[:space:]]*projectId:[[:space:]]*[\"'][^\"']+" "$ENV_PROD" | head -1 | sed -E "s/.*[\"']//" || true)"
  fi
  printf '%s' "$id"
}
PROJECT="${FIREBASE_PROJECT:-$(derive_project)}"
if [ -z "$PROJECT" ]; then
  echo "[push-secrets] could not determine the target project — set FIREBASE_PROJECT, fill environment.prod.ts, or run 'firebase use --add'." >&2
  exit 1
fi
echo "[push-secrets] project: $PROJECT"

PUSHED=0
while IFS= read -r line || [ -n "$line" ]; do
  # Skip blanks, comments, and any non-`KEY=VALUE` line.
  case "$line" in ''|\#*) continue ;; esac
  case "$line" in *=*) ;; *) continue ;; esac
  key="${line%%=*}"
  value="${line#*=}"
  if [ -z "$value" ] || [[ "$value" == PASTE_* ]]; then
    echo "[push-secrets] skipping $key — value not filled in." >&2
    continue
  fi
  echo "[push-secrets] setting $key …"
  printf '%s' "$value" | firebase functions:secrets:set "$key" --project "$PROJECT" --data-file -
  PUSHED=$((PUSHED + 1))
done < "$SECRETS_FILE"

echo "[push-secrets] done — $PUSHED secret(s) pushed. Redeploy functions for new versions to take effect."
