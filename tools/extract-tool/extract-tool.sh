#!/usr/bin/env bash
# Docker launcher for extract-tool (Phase 2 of reusable-tool extraction).
#
# Why Docker: the host's bare Node is too old for modern Nx (and modern JS syntax) — the BeSpunky
# pattern runs all Node tooling inside the typescript-node base image via `docker run` (see
# scaffold.sh). This launcher mounts ~/projects (so BOTH the source project and the shared @bespunky
# workspace are visible) and runs extract-tool.mjs inside the container, where Node is modern and the
# shared workspace's own Nx (its mounted node_modules) is available to scaffold the package shell.
#
# Usage:
#   extract-tool.sh --from <project-name|path> [--into <shared-name|path>] [--lib <name>]
#                   [--scope @bespunky] [--dry-run] [--no-scaffold] [--force]
#
# PROJECTS_DIR overrides the projects root (default ~/projects). --from/--into are resolved relative
# to it by basename, so both must live under the same projects root (they do — flat isolated workspaces).
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"

FROM_INPUT=""
INTO_INPUT="bespunky"
PASS=()   # forwarded flags

while [ "${1:-}" != "" ]; do
  case "$1" in
    --from)        FROM_INPUT="$2"; shift 2;;
    --into)        INTO_INPUT="$2"; shift 2;;
    --lib|--scope) PASS+=("$1" "$2"); shift 2;;
    --dry-run|--no-scaffold|--force) PASS+=("$1"); shift;;
    *) echo "ERROR: unknown arg '$1'" >&2; exit 1;;
  esac
done

[ -n "$FROM_INPUT" ] || { echo "ERROR: --from <project-name|path> is required" >&2; exit 1; }

FROM_BASE="$(basename "$FROM_INPUT")"
INTO_BASE="$(basename "$INTO_INPUT")"
[ -d "$PROJECTS_DIR/$FROM_BASE" ] || { echo "ERROR: source project not found: $PROJECTS_DIR/$FROM_BASE" >&2; exit 1; }
[ -d "$PROJECTS_DIR/$INTO_BASE" ] || { echo "ERROR: shared workspace not found: $PROJECTS_DIR/$INTO_BASE" >&2; exit 1; }

# --- guards ---
command -v docker >/dev/null || { echo "ERROR: docker not found" >&2; exit 1; }
docker info >/dev/null 2>&1   || { echo "ERROR: docker daemon not accessible" >&2; exit 1; }
command -v curl >/dev/null    || { echo "ERROR: curl not found" >&2; exit 1; }

# --- resolve newest typescript-node base image (same source as scaffold.sh) ---
echo "Resolving latest typescript-node base image..."
MAJOR="$(curl -fsSL 'https://mcr.microsoft.com/v2/devcontainers/typescript-node/tags/list' \
  | grep -oE '[0-9]+-bookworm' | sed 's/-bookworm//' | sort -rn | awk '$1>=18' | head -1 || true)"
[ -n "${MAJOR:-}" ] || MAJOR=24
IMAGE="mcr.microsoft.com/devcontainers/typescript-node:${MAJOR}"
echo "Base image: $IMAGE"

# --- run the tool inside the container; ~/projects at /work, the tool dir read-only at /tool ---
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -e HOME=/home/node \
  -v "$PROJECTS_DIR":/work -v "$TOOL_DIR":/tool:ro -w /work \
  "$IMAGE" \
  node /tool/extract-tool.mjs --from "/work/$FROM_BASE" --into "/work/$INTO_BASE" "${PASS[@]}"

# --- normalize ownership back to the host user (Docker Desktop/WSL2 can leave root-owned files) ---
docker run --rm \
  -v "$PROJECTS_DIR":/work -w /work \
  "$IMAGE" \
  chown -R "$(id -u):$(id -g)" "/work/$FROM_BASE" "/work/$INTO_BASE"

echo "EXTRACT_OK (image=$IMAGE from=$FROM_BASE into=$INTO_BASE)"
