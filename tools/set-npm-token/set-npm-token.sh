#!/usr/bin/env bash
# Write an npm auth token into your per-user ~/.npmrc.
#
# WHERE THE TOKEN GOES. npm reads auth from a per-USER config file at ~/.npmrc (your home directory —
# /home/<you>/.npmrc, NOT /usr). That's the file publish-nx-tools/publish.sh expects an npm AUTOMATION
# token to live in so it can publish unattended (no interactive `npm login`, no 2FA OTP window). This
# script is the one-step way to put it there.
#
# The token is stored as a registry-scoped line:
#     //registry.npmjs.org/:_authToken=<token>
# so it only ever authenticates to that registry.
#
# SECURITY. The prompt is silent (the token never echoes to the terminal or shell history), and the
# file is chmod 600 (owner read/write only). The token is still stored in PLAINTEXT — that is how npm
# reads it — so treat ~/.npmrc as a secret. Prefer a GRANULAR / AUTOMATION token (npm → Access Tokens)
# scoped to only what it must publish, not your account password or a classic full-access token.
#
# Usage:
#   tools/set-npm-token/set-npm-token.sh [--registry <url>] [--npmrc <path>]
#
#   --registry <url>   Registry to scope the token to (default: https://registry.npmjs.org/).
#   --npmrc <path>     Target file (default: ~/.npmrc). Useful for a project-local .npmrc.
set -euo pipefail

REGISTRY="https://registry.npmjs.org/"
NPMRC="$HOME/.npmrc"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2;;
    --registry=*) REGISTRY="${1#*=}"; shift;;
    --npmrc) NPMRC="$2"; shift 2;;
    --npmrc=*) NPMRC="${1#*=}"; shift;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2;;
  esac
done

# Reduce the registry URL to the //host/path/ form npm keys the _authToken line by (scheme stripped).
KEY="//${REGISTRY#*://}"
[ "${KEY: -1}" = "/" ] || KEY="$KEY/"

# Read the token silently — no echo, so it stays out of the terminal and shell history.
printf 'npm token for %s\n' "$REGISTRY" >&2
printf 'Token (input hidden): ' >&2
read -rs TOKEN
printf '\n' >&2
[ -n "$TOKEN" ] || { echo "ERROR: no token entered — nothing written." >&2; exit 1; }

# Idempotent write: drop any existing _authToken line for THIS registry, then append the new one.
# Create the file first so it exists (and is 600) even on a fresh machine.
touch "$NPMRC"
chmod 600 "$NPMRC"
LINE="${KEY}:_authToken=${TOKEN}"
TMP="$(mktemp)"
grep -v -F "${KEY}:_authToken=" "$NPMRC" > "$TMP" || true
printf '%s\n' "$LINE" >> "$TMP"
mv "$TMP" "$NPMRC"
chmod 600 "$NPMRC"

echo "Wrote npm auth token for ${REGISTRY} to ${NPMRC} (permissions 600)." >&2
echo "Verify with: npm whoami --registry ${REGISTRY}" >&2
