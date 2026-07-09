#!/usr/bin/env bash
# Publish @bespunky/nx-tools to npm.
#
# The house Nx generators (scaffolding + reusable-tool extraction) live as TypeScript in the toolkit
# (plugins/project-starter/.../assets/nx-tools). Nx can't run raw TS from node_modules, so a published
# package must ship COMPILED JS — this script compiles (reusing compile-generators.mts, the same
# transpile the scaffold uses) and publishes.
#
# Runs in Docker (the host's Node is too old) with your npm auth (~/.npmrc) mounted, mirroring the
# scaffold/extract-tool pattern. You run this; it needs your npm credentials.
#
# Usage:
#   tools/publish-nx-tools/publish.sh [--dry-run]
#
# Bump the version in assets/nx-tools/package.json before a real publish.
set -euo pipefail

DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ASSETS_DIR="$REPO_ROOT/plugins/project-starter/skills/new-project/assets"
[ -d "$ASSETS_DIR/nx-tools" ] || { echo "ERROR: nx-tools not found at $ASSETS_DIR/nx-tools" >&2; exit 1; }

command -v docker >/dev/null || { echo "ERROR: docker not found" >&2; exit 1; }
docker info >/dev/null 2>&1   || { echo "ERROR: docker daemon not accessible" >&2; exit 1; }
command -v curl >/dev/null    || { echo "ERROR: curl not found" >&2; exit 1; }

NPMRC="$HOME/.npmrc"
if [ ! -f "$NPMRC" ] && [ -z "$DRY" ]; then
  echo "ERROR: ~/.npmrc not found — npm publish needs auth. Run 'npm login' (or set a token) first," >&2
  echo "       or use --dry-run to validate the package without publishing." >&2
  exit 1
fi

echo "Resolving latest typescript-node base image..."
MAJOR="$(curl -fsSL 'https://mcr.microsoft.com/v2/devcontainers/typescript-node/tags/list' \
  | grep -oE '[0-9]+-bookworm' | sed 's/-bookworm//' | sort -rn | awk '$1>=20' | head -1 || true)"
[ -n "${MAJOR:-}" ] || MAJOR=24
IMAGE="mcr.microsoft.com/devcontainers/typescript-node:${MAJOR}"
echo "Base image: $IMAGE"

# Inner script (runs in the container, modern Node):
#  1. copy nx-tools to a temp dir, 2. install typescript (compile-generators resolves it from cwd),
#  3. compile .ts -> .js (removes .ts), 4. npm publish (the `files` allowlist ships only JS + json).
INNER="set -e
rm -rf /tmp/pub && cp -r /assets/nx-tools /tmp/pub
cd /tmp/pub
# Pin to TypeScript 5.x: compile-generators.mts uses the classic compiler API (ts.transpileModule /
# ts.ModuleKind), which the native-port TypeScript 7.x package no longer exposes from its main entry
# (an unpinned 'typescript' now resolves to 7.x → 'Cannot read properties of undefined (ModuleKind)').
npm install --no-save --no-audit --no-fund --silent 'typescript@^5'
node /assets/compile-generators.mts /tmp/pub
echo '--- package contents (npm pack --dry-run) ---'
npm publish $DRY"

NPMRC_MOUNT=()
[ -f "$NPMRC" ] && NPMRC_MOUNT=(-v "$NPMRC":/home/node/.npmrc:ro)

docker run --rm \
  -u "$(id -u):$(id -g)" \
  -e HOME=/home/node \
  -v "$ASSETS_DIR":/assets:ro \
  "${NPMRC_MOUNT[@]}" \
  "$IMAGE" \
  bash -lc "$INNER"

VERSION="$(node -e "console.log(require('$ASSETS_DIR/nx-tools/package.json').version)" 2>/dev/null || echo '?')"
echo "PUBLISH_${DRY:+DRYRUN_}OK @bespunky/nx-tools@$VERSION"
