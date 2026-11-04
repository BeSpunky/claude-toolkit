# shellcheck shell=bash
# container-engine.sh — SOURCED (never executed) by every host-side launcher that falls back to the
# typescript-node base image: house.sh (beside it) and this repo's tools/extract-tool/extract-tool.sh and
# tools/publish-nx-tools/publish.sh.
#
# Why it lives HERE, in the house plugin's engine: house.sh runs inside consumers' projects from the
# INSTALLED plugin directory, where this repo's tools/ does not exist — so the one copy both can reach is
# the one shipped with the plugin. The two tools live in this repo and reach it by a repo-relative path.
# (The reverse — a helper under tools/ — would leave house.sh unable to source it once installed.)
#
# It answers two questions the launchers used to answer by copy-paste:
#   1. WHICH base image  — the typescript-node image of the house's own Node major (HOUSE_NODE_MAJOR).
#   2. WHO OWNS the files a container writes into a bind mount — asked of the ENGINE, never the host.
#
# Ownership, the reasoning. On a ROOTFUL engine, container uids ARE host uids: we run as `-u uid:gid` so
# files land user-owned, then a throwaway root container `chown`s the tree back anyway, because some
# backends (Docker Desktop's WSL2 integration, notably) still leave root-owned files. On a ROOTLESS
# engine (rootless Docker, rootless Podman) the container's uid 0 IS the invoking host user and every
# other container uid maps to a host SUBUID — so `-u $(id -u)` writes subuid-owned files, and the chown
# "fix" re-chowns them to the same subuid. There the right move is the opposite: run as container root
# (== the host user) and chown nothing. Which case applies is a property of the engine, so we ask it.

# Exit 0 when the engine behind `docker` is rootless. Cached: the engine does not change mid-run.
#   Podman (incl. the `docker` -> podman shim) answers `.Host.Security.Rootless` directly; Docker has no
#   such field (the template errors) and instead lists `name=rootless` among its SecurityOptions.
#   An engine that answers neither is treated as rootful — the long-standing behaviour.
container_engine_rootless() {
  if [ -z "${_CONTAINER_ENGINE_ROOTLESS:-}" ]; then
    local podman docker_opts
    podman="$(docker info --format '{{.Host.Security.Rootless}}' 2>/dev/null || true)"
    if [ "$podman" = "true" ]; then
      _CONTAINER_ENGINE_ROOTLESS=1
    elif [ "$podman" = "false" ]; then
      _CONTAINER_ENGINE_ROOTLESS=0
    else
      docker_opts="$(docker info --format '{{json .SecurityOptions}}' 2>/dev/null || true)"
      case "$docker_opts" in
        *name=rootless*) _CONTAINER_ENGINE_ROOTLESS=1;;
        *)               _CONTAINER_ENGINE_ROOTLESS=0;;
      esac
    fi
  fi
  [ "$_CONTAINER_ENGINE_ROOTLESS" = "1" ]
}

# A one-line, human-readable description of the ownership mode, for the launchers' logs.
container_engine_describe() {
  if container_engine_rootless; then
    echo "rootless engine (container root == host user; no ownership fixup)"
  else
    echo "rootful engine (run as $(id -u):$(id -g), ownership normalized afterwards)"
  fi
}

# `docker run --rm` as whoever maps to the invoking host user. Takes every other `docker run` argument.
container_run_as_host_user() {
  if container_engine_rootless; then
    docker run --rm "$@"
  else
    docker run --rm -u "$(id -u):$(id -g)" "$@"
  fi
}

# Hand container-written files back to the invoking host user. Rootful only; a no-op when rootless.
#   $1 image   $2 host dir to mount at /work   $3.. paths under /work to chown (recursively)
container_restore_ownership() {
  container_engine_rootless && return 0
  local image="$1" host_dir="$2"; shift 2
  docker run --rm -v "$host_dir":/work -w /work "$image" chown -R "$(id -u):$(id -g)" "$@"
}

# Echo the Node major the fallback runs on: the house's own, read from the payload shipped beside this file (one
# source, HOUSE_NODE_MAJOR; the same one a new project's .nvmrc is seeded with), so a scaffold runs on the Node its
# project will run on.
#   It is deliberately NOT the newest image on MCR. It used to be, which made every launcher depend on whatever
#   Microsoft published that day: typescript-node:26 ships neither yarn nor corepack (24 ships yarn 1.22.22), so the
#   day it appeared `yarn create nx-workspace` stopped working with no change here. A runner needs a known toolchain,
#   not a new one. Moving HOUSE_NODE_MAJOR past 24 therefore has to answer where yarn comes from, here and in the
#   generated devcontainer: docs/features/2026-11-02-house-docker-pm/DECISION.md.
base_image_node_major() {
  local versions major
  versions="$(dirname "${BASH_SOURCE[0]}")/nx-tools/src/generators/_utils/versions.ts"
  major="$(sed -n "s/^export const HOUSE_NODE_MAJOR = '\([0-9][0-9]*\)';.*/\1/p" "$versions" 2>/dev/null)"
  if [ -z "$major" ]; then
    echo "ERROR: no HOUSE_NODE_MAJOR found in $versions — cannot choose a base image." >&2
    return 1
  fi
  echo "$major"
}

# Echo the base image reference for a typescript-node major.
base_image_for_major() {
  echo "mcr.microsoft.com/devcontainers/typescript-node:$1"
}

# Stop, saying why, when the image cannot run a command the program is about to depend on. Asked the way the program
# runs (same user, same login shell), before anything is written: without it a missing tool surfaced as one line of
# `env: 'yarn': No such file or directory`, deep in the run.
#   $1 image   $2 command   (docker run exits 125 and up when it could not start the container at all)
container_require_command() {
  local rc=0
  container_run_as_host_user -e HOME=/home/node "$1" bash -lc 'command -v "$1"' _ "$2" >/dev/null || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) echo "ERROR: $1 has no '$2', and this run needs it. Nothing was written." >&2 ;;
    *) echo "ERROR: could not run $1 to look for '$2' (docker exit $rc). Nothing was written." >&2 ;;
  esac
  return 1
}

# Echo what the image's own copy of a command says its version is, asked the way container_require_command asks, and
# away from any project: inside one, yarn would answer for the release that project dispatches to.
#   $1 image   $2 command
container_command_version() {
  container_run_as_host_user -e HOME=/home/node "$1" bash -lc '"$1" --version' _ "$2"
}
