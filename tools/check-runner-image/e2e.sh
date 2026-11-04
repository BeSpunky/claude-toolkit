#!/usr/bin/env bash
# The whole Docker fallback on a real engine: `house.sh new --docker --preset=angular`, in a throwaway directory, ending
# in a project. A fake docker (tools/test-scaffold/docker-fallback.test.sh) proves the launcher's decisions; only this
# proves that the program those decisions start actually gets through the real image.
#
#   bash tools/check-runner-image/e2e.sh local      --local: packs this working tree, so it needs nothing published
#   bash tools/check-runner-image/e2e.sh registry   what a consumer gets: installs the version this checkout declares
#
# THE REGISTRY ROAD ASKS npm FIRST. It can only be walked once the version in engine/nx-tools/package.json is on npm, and
# a branch carrying a bump has a version nobody published yet. That is the normal state of such a branch, not a defect
# in it, so a 404 is a stated SKIP (exit 0), and only an unanswered question fails. The first run on main after the
# publish walks it.
#
# Needs docker and the network, ~5-15 minutes per road; exits 0 pass or skip, 1 fail. .github/workflows/runner-image-e2e.yml.
set -uo pipefail

ROAD="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE="$ROOT/plugins/house/engine"
# shellcheck source=../../plugins/house/engine/container-engine.sh
. "$ENGINE/container-engine.sh"

notice() { echo "$2"; [ -z "${GITHUB_ACTIONS:-}" ] || echo "::$1::$2"; }

case "$ROAD" in
  local)    FLAGS=(--docker --local) ;;
  registry) FLAGS=(--docker)
    VERSION="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ENGINE/nx-tools/package.json" | head -n 1)"
    [ -n "$VERSION" ] || { notice error "No version in $ENGINE/nx-tools/package.json: nothing to look for on npm."; exit 1; }
    STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "https://registry.npmjs.org/@bespunky/nx-tools/$VERSION" || true)"
    case "$STATUS" in
      200) echo "@bespunky/nx-tools@$VERSION is on npm: walking the registry road." ;;
      404) notice notice "SKIP registry road: @bespunky/nx-tools@$VERSION is not on npm yet, so no consumer can install it either. Nothing was observed."
           exit 0 ;;
      *)   notice error "Could not tell whether @bespunky/nx-tools@$VERSION is on npm (HTTP '$STATUS')."; exit 1 ;;
    esac ;;
  *) echo "usage: e2e.sh local|registry" >&2; exit 2 ;;
esac

MAJOR="$(base_image_node_major)" || exit 1
IMAGE="$(base_image_for_major "$MAJOR")"
PROJECT=runner-image-e2e

WORK="$(mktemp -d)"
# The chown at the end of a run is what makes this removable on a rootful engine, so a run that died before it can leave
# files here that cannot be removed. That is not this check's verdict, and it says so instead of hiding it.
trap 'rm -rf "$WORK" 2>/dev/null || echo "note: could not fully remove $WORK" >&2' EXIT
mkdir "$WORK/projects"
LOG="$WORK/run.log"

echo "Road: $ROAD   Image: $IMAGE   Directory: $WORK/projects"
rc=0
PROJECTS_DIR="$WORK/projects" bash "$ENGINE/house.sh" new "${FLAGS[@]}" --preset=angular "$PROJECT" </dev/null 2>&1 | tee "$LOG"
rc="${PIPESTATUS[0]}"

FAILED=0
check() {   # <what>  <holds? 0/1>
  if [ "$2" -eq 0 ]; then echo "  ok   $1"; else notice error "FAILED ($ROAD road): $1"; FAILED=1; fi
}
echo
echo "Verdict ($ROAD road):"
check "house.sh exited 0 (it exited $rc)" "$rc"
grep -q "^NEW_OK $WORK/projects/$PROJECT " "$LOG"; check "it reported NEW_OK for $PROJECT" $?
grep -q "^NEW_OK .*image=$IMAGE " "$LOG"; check "it ran on $IMAGE, not the host's Node" $?
[ -f "$WORK/projects/$PROJECT/HOUSE.md" ]; check "$PROJECT/HOUSE.md exists" $?

if [ "$FAILED" -ne 0 ]; then
  {
    echo "The fallback does not get through a real image on this machine (uid $(id -u)). The run's own output is above."
    echo "If the image lost a tool, tools/check-runner-image/check.sh says which; if it passes, the fault is in the"
    echo "program house.sh rendered, or in what the image allows this user to do."
  } >&2
  exit 1
fi
