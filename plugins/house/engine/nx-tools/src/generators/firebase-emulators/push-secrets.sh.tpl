#!/usr/bin/env bash
# Push the local Functions secrets file into Google Secret Manager. {{functionsRoot}}/.secret.local
# holds PRODUCTION's values and exists for this script alone — the emulator never reads it
# (tools/emulators.sh gives the emulator inert placeholders, or opt-in sandbox values). One command,
# one source of truth: every `KEY=VALUE` in it becomes a `firebase functions:secrets:set KEY` on the
# target project, so what exists locally and in prod can never drift.
#
# The file is read with Firebase's own dotenv rules (tools/emulator-secrets.cjs — the one parser the emulator side
# uses too): `KEY="v" # note` pushes `v`, `export KEY=v` pushes KEY, escapes in double quotes are decoded. A line
# that is not KEY=VALUE, or a key Firebase refuses, stops the push before anything is set.
#
# Values never touch a command line, a log, or this script's output: each one is piped into the
# CLI on stdin (`--data-file -`). Only key NAMES are printed — `--dry-run` adds each value's length,
# fingerprint and edges, so a stray quote or comment is visible without the value itself.
#
#   bash tools/push-secrets.sh                        # project from .firebaserc / environment.prod.ts
#   bash tools/push-secrets.sh --dry-run              # what WOULD be pushed; pushes nothing
#   FIREBASE_PROJECT=<id> bash tools/push-secrets.sh    # explicit override
#
# Nx target: `yarn nx run {{functionsProject}}:push-secrets`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "[push-secrets] unknown argument: $arg (expected --dry-run)" >&2; exit 2 ;;
  esac
done
SECRETS_FILE="$ROOT/{{functionsRoot}}/.secret.local"
ENV_PROD="$ROOT/{{appEnvProdPath}}"

if [ ! -f "$SECRETS_FILE" ]; then
  echo "[push-secrets] no $SECRETS_FILE — copy {{functionsRoot}}/.secret.local.example and fill it first." >&2
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

# Parse first, push after: a file Firebase would misread is refused whole, before any secret is set.
ENTRIES="$(mktemp)"
trap 'rm -f "$ENTRIES"' EXIT
node "$ROOT/tools/emulator-secrets.cjs" push-entries --file="$SECRETS_FILE" > "$ENTRIES" || exit 2

PUSHED=0
while IFS= read -r -d '' key && IFS= read -r -d '' value; do
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[push-secrets] would set $key — $(printf '%s' "$value" | node "$ROOT/tools/emulator-secrets.cjs" describe)"
  else
    echo "[push-secrets] setting $key …"
    printf '%s' "$value" | firebase functions:secrets:set "$key" --project "$PROJECT" --data-file -
  fi
  PUSHED=$((PUSHED + 1))
done < "$ENTRIES"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[push-secrets] dry run — $PUSHED secret(s) would be pushed to $PROJECT; nothing was set."
else
  echo "[push-secrets] done — $PUSHED secret(s) pushed. Redeploy functions for new versions to take effect."
fi
