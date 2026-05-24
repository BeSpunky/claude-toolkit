#!/usr/bin/env bash
# Scaffold a BeSpunky-standard project: integrated Nx monorepo + Angular (clean --minimal app) + devcontainer.
# Node comes from the typescript-node devcontainer base image, run via Docker - NO nvm.
# Usage: scaffold.sh <project-name> [app-name]
#   PROJECTS_DIR env overrides the target root (default: ~/projects).
set -euo pipefail

PROJECT="${1:?Usage: scaffold.sh <project-name> [app-name]}"
APP="${2:-$PROJECT}"
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"
ASSETS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$PROJECTS_DIR/$PROJECT"

GIT_NAME="$(git config --global user.name 2>/dev/null || whoami)"
GIT_EMAIL="$(git config --global user.email 2>/dev/null || echo "$(whoami)@localhost")"

# --- guards ---
command -v docker >/dev/null || { echo "ERROR: docker not found" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: docker daemon not accessible" >&2; exit 1; }
command -v curl >/dev/null || { echo "ERROR: curl not found" >&2; exit 1; }
[ -e "$TARGET" ] && { echo "ERROR: '$TARGET' already exists. Choose another name." >&2; exit 1; }

# --- 1. Resolve newest Node major that has a typescript-node devcontainer image ---
echo "Resolving latest typescript-node base image..."
MAJOR="$(curl -fsSL 'https://mcr.microsoft.com/v2/devcontainers/typescript-node/tags/list' \
  | grep -oE '[0-9]+-bookworm' | sed 's/-bookworm//' | sort -rn | awk '$1>=18' | head -1 || true)"
[ -n "${MAJOR:-}" ] || MAJOR=24
IMAGE="mcr.microsoft.com/devcontainers/typescript-node:${MAJOR}"
echo "Base image: $IMAGE"

# --- 2. Run the Nx generators INSIDE the base image (Node from the image; no nvm) ---
INNER="set -e
git config --global user.name '$GIT_NAME'
git config --global user.email '$GIT_EMAIL'
git config --global init.defaultBranch main
yarn create nx-workspace '$PROJECT' --preset=apps --packageManager=yarn --nxCloud=skip --no-interactive
cd '$PROJECT'
yarn nx add @nx/angular
yarn nx g @nx/angular:application 'apps/$APP' --minimal --style=scss --routing --e2eTestRunner=none
mkdir -p node_modules/@bespunky
cp -r /assets/nx-tools node_modules/@bespunky/nx-tools
node /assets/compile-generators.mjs node_modules/@bespunky/nx-tools
yarn nx g @bespunky/nx-tools:serve-options --project=$APP
yarn nx g @bespunky/nx-tools:devcontainer --name=$PROJECT --nodeMajor=$MAJOR
yarn nx g @bespunky/nx-tools:claude-settings"

docker run --rm \
  -u "$(id -u):$(id -g)" \
  -e HOME=/home/node \
  -v "$PROJECTS_DIR":/work -v "$ASSETS_DIR":/assets:ro -w /work \
  "$IMAGE" \
  bash -lc "$INNER"

echo "SCAFFOLD_OK $TARGET (image=$IMAGE app=apps/$APP)"
