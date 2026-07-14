#!/usr/bin/env bash
# Publish @bespunky/nx-tools to npm.
#
# The house Nx generators (scaffolding + reusable-tool extraction) live as TypeScript in the toolkit
# (plugins/project-starter/.../assets/nx-tools). Nx can't run raw TS from node_modules, so a published
# package must ship COMPILED JS — this script compiles (reusing compile-generators.mts, the same
# transpile the scaffold uses) and publishes.
#
# WHERE IT RUNS. Docker was never the requirement — a modern NODE is. Docker existed here only to supply
# one, back when the host's Node was too old. So: if the local Node is new enough, this runs natively (no
# daemon, no image pull, no mounts, and your ~/.npmrc is simply already there); otherwise it falls back to
# the typescript-node image exactly as before. "New enough" = Node 22.18+, the first release where
# compile-generators.mts's type-stripping runs unflagged. Both paths execute the SAME command sequence
# (rendered once, below), so they cannot drift.
#
# You run this; it needs your npm credentials.
#
# 2FA: if the npm account requires an OTP for writes, pass --otp <code>. Prefer an npm AUTOMATION token in
# ~/.npmrc — a 30s TOTP code can expire during the staging + compile, and the native path (being faster
# than the Docker one) narrows but does not close that window.
#
# Usage:
#   tools/publish-nx-tools/publish.sh [--dry-run] [--otp <code>] [--docker]
#
# Bump the version in assets/nx-tools/package.json before a real publish.
set -euo pipefail

# Args: --dry-run (validate only), --otp <code> / --otp=<code> (2FA one-time password).
# If the npm account has "require 2FA for write actions" on, a real publish needs an OTP — BUT the
# publish runs after ~15s of staging/compile, so a 30s TOTP code can expire mid-run. The robust fix
# is an npm AUTOMATION token (or a granular token that bypasses 2FA) in ~/.npmrc: then no --otp is
# needed and this script publishes unattended.
DRY=""
OTP=""
FORCE_DOCKER=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY="--dry-run"; shift;;
    --otp)     OTP="--otp=$2"; shift 2;;
    --otp=*)   OTP="$1"; shift;;
    --docker)  FORCE_DOCKER=1; shift;;  # escape hatch: use the image even if the local Node would do
    *) echo "ERROR: unknown argument: $1" >&2; exit 2;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ASSETS_DIR="$REPO_ROOT/plugins/project-starter/skills/new-project/assets"
[ -d "$ASSETS_DIR/nx-tools" ] || { echo "ERROR: nx-tools not found at $ASSETS_DIR/nx-tools" >&2; exit 1; }

NPMRC="$HOME/.npmrc"
if [ ! -f "$NPMRC" ] && [ -z "$DRY" ]; then
  echo "ERROR: ~/.npmrc not found — npm publish needs auth. Run 'npm login' (or set a token) first," >&2
  echo "       or use --dry-run to validate the package without publishing." >&2
  exit 1
fi

# --- is the local Node new enough to skip Docker entirely? ---
# The bar is compile-generators.mts: it is TypeScript run directly by node, which needs type-stripping
# ON BY DEFAULT — Node 22.18+ (it was flagged/experimental before that). Anything older, or no local
# node/npm at all, falls back to the image.
local_node_ok() {
  command -v node >/dev/null && command -v npm >/dev/null || return 1

  local major minor
  major="$(node -p 'process.versions.node.split(".")[0]')" || return 1
  minor="$(node -p 'process.versions.node.split(".")[1]')" || return 1

  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 18 ]; }
}

# The command sequence — rendered ONCE and run by whichever path we take, so the two can never drift:
#  1. copy nx-tools to a scratch dir, 2. install typescript (compile-generators resolves it from cwd),
#  3. compile .ts -> .js (removes .ts), 4. npm publish (the `files` allowlist ships only JS + json).
# $1 = the dir holding compile-generators.mts + nx-tools; $2 = the scratch dir to build in.
render_steps() {
  cat <<EOF
set -e
rm -rf '$2' && cp -r '$1/nx-tools' '$2'
cd '$2'
# Pin to TypeScript 5.x: compile-generators.mts uses the classic compiler API (ts.transpileModule /
# ts.ModuleKind), which the native-port TypeScript 7.x package no longer exposes from its main entry
# (an unpinned 'typescript' now resolves to 7.x → 'Cannot read properties of undefined (ModuleKind)').
npm install --no-save --no-audit --no-fund --silent 'typescript@^5'
node '$1/compile-generators.mts' '$2'
echo '--- package contents (npm pack --dry-run) ---'
npm publish $DRY $OTP
EOF
}

if [ "$FORCE_DOCKER" = "0" ] && local_node_ok; then
  echo "Node $(node -v) is new enough — publishing locally (no Docker)."
  bash -c "$(render_steps "$ASSETS_DIR" "$(mktemp -d)")"
else
  if [ "$FORCE_DOCKER" = "1" ]; then
    echo "--docker: using the container even though the local Node may suffice."
  else
    echo "Local Node is missing or older than 22.18 — falling back to Docker."
  fi

  command -v docker >/dev/null || { echo "ERROR: docker not found" >&2; exit 1; }
  docker info >/dev/null 2>&1   || { echo "ERROR: docker daemon not accessible" >&2; exit 1; }
  command -v curl >/dev/null    || { echo "ERROR: curl not found" >&2; exit 1; }

  echo "Resolving latest typescript-node base image..."
  MAJOR="$(curl -fsSL 'https://mcr.microsoft.com/v2/devcontainers/typescript-node/tags/list' \
    | grep -oE '[0-9]+-bookworm' | sed 's/-bookworm//' | sort -rn | awk '$1>=20' | head -1 || true)"
  [ -n "${MAJOR:-}" ] || MAJOR=24
  IMAGE="mcr.microsoft.com/devcontainers/typescript-node:${MAJOR}"
  echo "Base image: $IMAGE"

  NPMRC_MOUNT=()
  [ -f "$NPMRC" ] && NPMRC_MOUNT=(-v "$NPMRC":/home/node/.npmrc:ro)

  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -e HOME=/home/node \
    -v "$ASSETS_DIR":/assets:ro \
    "${NPMRC_MOUNT[@]}" \
    "$IMAGE" \
    bash -lc "$(render_steps /assets /tmp/pub)"
fi

VERSION="$(node -e "console.log(require('$ASSETS_DIR/nx-tools/package.json').version)" 2>/dev/null || echo '?')"
echo "PUBLISH_${DRY:+DRYRUN_}OK @bespunky/nx-tools@$VERSION"
