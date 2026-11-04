#!/usr/bin/env bash
# Does the image the Docker fallback runs on still hold what the fallback assumes? Asked of the REAL image, pulled now.
#
# WHY: the fallback (plugins/house/engine/house.sh, container-engine.sh) runs on typescript-node:<HOUSE_NODE_MAJOR>.
# The major is ours; the tag is not. `:24` is rolling, so Microsoft can change what is in it on any day. The up-front
# check in house.sh stops a run when the package manager has gone, but only when somebody's run reaches it, and a digest
# pin was rejected (it stops security updates and still leaves generated devcontainers on the rolling tag):
# docs/features/2026-11-04-house-docker-open-items/DECISION.md, D3.
#
# IT DRIFTS WITH UPSTREAM, BY DESIGN, so it runs on a schedule and never on every push:
# .github/workflows/upstream-tables.yml says why.
#
# What is asserted: Node is there, yarn is there, runs, and is the major below, and the run's HOME is writable by this
# user; the program cannot get anywhere without any of them. What is only reported: corepack and pnpm; neither stops
# anything today, and each answers a question somebody will ask when something else breaks.
#
# The exit code separates the two ways to be red, because they want different people doing different things:
#   0  the image holds the assumption
#   1  the image RAN and the assumption is broken: decide what to do about the image
#   2  the image COULD NOT RUN, so nothing is known about it: look at docker, the registry, the tag
#
#   bash tools/check-runner-image/check.sh     (needs docker and the network; nothing else)
#   bash tools/check-runner-image/test.sh      its own branches, against a fake docker
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The same functions the fallback itself calls, so this asks about the image the fallback would actually pick.
# shellcheck source=../../plugins/house/engine/container-engine.sh
. "$ROOT/plugins/house/engine/container-engine.sh"

# Why 1: `new` runs `yarn create nx-workspace`, the project it makes declares the yarn it ran on (yarn@1.22.22 on the last
# real run; the repo pins none), and a project's own yarn 2+ is reached only through yarn 1's yarnPath dispatch. A runner
# on a newer yarn would change all three without saying so.
EXPECTED_YARN_MAJOR=1

DECISION=docs/features/2026-11-04-house-docker-open-items/DECISION.md

annotate() { [ -z "${GITHUB_ACTIONS:-}" ] || echo "::error title=$1::$2"; }
summary()  { [ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "$1" >> "$GITHUB_STEP_SUMMARY"; }

could_not_run() {   # <what happened>  <evidence, may be empty>
  annotate 'runner image could not run' "$1"
  {
    echo "COULD NOT RUN: $1"
    [ -z "$2" ] || printf '%s\n' "$2" | sed 's/^/  | /'
    echo "Nothing is known about what the image holds; this is not a finding about yarn. To look into:"
    echo "  - is docker up here? docker info"
    echo "  - is MCR reachable? A one-off outage needs only a re-run."
    echo "  - 'manifest unknown' means the tag itself is gone: HOUSE_NODE_MAJOR names an image MCR no longer publishes."
    echo "    Moving it is a decision with a release behind it, see $DECISION."
  } >&2
  exit 2
}

broken() {   # <the assumption that broke>
  annotate 'runner image lost its assumption' "$IMAGE: $1"
  {
    echo "BROKEN: $IMAGE: $1"
    echo "Nothing in this repo changed: the rolling tag did. Until this is settled, every Docker-path run of house.sh"
    echo "on a yarn project (new --preset=angular, for one) stops or dies. Generated devcontainers are not affected:"
    echo "house.package-manager.sh provides theirs. To settle it:"
    echo "  1. Look at it: docker run --rm --pull=always $IMAGE bash -lc 'type -a node yarn; yarn --version; ls -ld \$HOME'"
    echo "  2. Choose where the fallback's yarn comes from: it installs it itself (npm install -g yarn@1.22.22 worked as the"
    echo "     node user on :26, but the program runs as the host's uid, so it needs a --prefix under its HOME)."
    echo "     A digest pin was weighed and rejected: it stops security updates. Background: $DECISION."
  } >&2
  exit 1
}

command -v docker >/dev/null || could_not_run "no docker on PATH" ""

MAJOR="$(base_image_node_major)" || exit 2
IMAGE="$(base_image_for_major "$MAJOR")"
echo "Image: $IMAGE (HOUSE_NODE_MAJOR=$MAJOR), pulled fresh"
echo "Engine: $(container_engine_describe)"

# Ends with a sentinel and exits 0 whatever it found, so a non-zero docker exit or a missing sentinel can only mean the
# probe did not run to the end. That is what keeps "could not run" and "has no yarn" apart. Through the seam the program
# house.sh runs through, in the same login shell: a tool only a root shell can see would not help it.
# shellcheck disable=SC2016  # it runs in the container.
PROBE='
for tool in node yarn corepack pnpm; do
  where="$(command -v "$tool" 2>/dev/null)"
  version=""
  [ -z "$where" ] || version="$("$tool" --version 2>/dev/null </dev/null | head -n 1)"
  echo "$tool.path=$where"
  echo "$tool.version=$version"
done
if [ -w "$HOME" ]; then echo "home.writable=yes"; else echo "home.writable=no"; fi
echo "uid=$(id -u)"
echo "probe=done"
'

STDERR_FILE="$(mktemp)"
trap 'rm -f "$STDERR_FILE"' EXIT
# --pull=always: this asks what the tag holds TODAY, and a copy cached on this machine would answer for the day it was
# pulled. No stdin, so a corepack shim that wants to ask before downloading cannot wait for an answer.
rc=0
OUTPUT="$(container_run_program --pull=always -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  "$IMAGE" bash -lc "$PROBE" </dev/null 2>"$STDERR_FILE")" || rc=$?
EVIDENCE="$(tail -n 5 "$STDERR_FILE")"

[ "$rc" -eq 0 ] || could_not_run "docker run exited $rc on $IMAGE" "$EVIDENCE"
fact() { printf '%s\n' "$OUTPUT" | sed -n "s/^$1=//p" | head -n 1; }
[ "$(fact probe)" = "done" ] || could_not_run "the probe in $IMAGE did not reach its end" "$EVIDENCE"

report() {   # <tool>  <what its absence means>
  local where version
  where="$(fact "$1.path")"; version="$(fact "$1.version")"
  if [ -n "$where" ]; then
    echo "  $1: ${version:-present, but --version gave nothing} ($where)"
    summary "- $1: ${version:-present, but --version gave nothing}"
  else
    echo "  $1: absent. $2"
    summary "- $1: absent"
  fi
}
summary "### $IMAGE"
echo "What the image holds, as uid $(fact uid) in the container:"
report node "(Asserted below.)"
report yarn "(Asserted below.)"
report corepack "Nothing here enables it; a project's yarn 2+ needs a yarnPath."
report pnpm "A pnpm project on the fallback stops at UPGRADE_REFUSED: runner-image, and needs the native route."
echo "  HOME=$CONTAINER_HOME writable: $(fact home.writable)"
summary "- HOME=$CONTAINER_HOME writable by uid $(fact uid): $(fact home.writable)"

[ -n "$(fact node.path)" ] || broken "has no node"
[ "$(fact home.writable)" = "yes" ] || broken "HOME=$CONTAINER_HOME is not writable by uid $(fact uid): git, npm and yarn all write there"
[ -n "$(fact yarn.path)" ] || broken "has no yarn"
YARN_VERSION="$(fact yarn.version)"
[ -n "$YARN_VERSION" ] || broken "has yarn at $(fact yarn.path), but 'yarn --version' printed nothing"
[ "${YARN_VERSION%%.*}" = "$EXPECTED_YARN_MAJOR" ] || broken "has yarn $YARN_VERSION, and the fallback rests on yarn $EXPECTED_YARN_MAJOR"

echo "OK: $IMAGE has yarn $YARN_VERSION (major $EXPECTED_YARN_MAJOR expected)"
