# shellcheck shell=bash
# container-engine.sh — SOURCED (never executed) by every host-side launcher that falls back to the
# typescript-node base image: house.sh (beside it) and this repo's tools/extract-tool/extract-tool.sh.
#
# Why it lives HERE, in the house plugin's engine: house.sh runs inside consumers' projects from the
# INSTALLED plugin directory, where this repo's tools/ does not exist — so the one copy both can reach is
# the one shipped with the plugin. extract-tool lives in this repo and reaches it by a repo-relative path.
# (The reverse — a helper under tools/ — would leave house.sh unable to source it once installed.)
#
# It answers two questions both launchers used to answer by copy-paste:
#   1. WHICH base image  — the newest typescript-node major published on MCR (>= 18; 24 when offline).
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

# Echo the newest typescript-node major tagged on MCR (>= 18), or 24 when the registry is unreachable.
base_image_node_major() {
  local major
  major="$(curl -fsSL 'https://mcr.microsoft.com/v2/devcontainers/typescript-node/tags/list' \
    | grep -oE '[0-9]+-bookworm' | sed 's/-bookworm//' | sort -rn | awk '$1>=18' | head -1 || true)"
  echo "${major:-24}"
}

# Echo the base image reference for a typescript-node major.
base_image_for_major() {
  echo "mcr.microsoft.com/devcontainers/typescript-node:$1"
}
