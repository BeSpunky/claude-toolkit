#!/usr/bin/env bash
# two-container-check — the validation the shared browser's port arbitration actually needs.
#
# WHY THIS EXISTS
# The failure this mechanism prevents CANNOT be reproduced with one container: each container's netns has
# its own free 6080, so a single container always succeeds and always looks correct. The bug only appears
# in pairs — and it appears silently, as a URL pointing at the *other* container's browser. So a one-
# container smoke test proves nothing about the only property that matters.
#
# WHAT IT CHECKS
#   1. Two containers sharing the registry volume get DISTINCT ports.
#   2. Each container's claim names itself, and no port is double-booked.
#   3. A REBUILD (same ${devcontainerId}, brand-new container) RECLAIMS the same port — the property that
#      makes the viewer URL bookmarkable and stops the band leaking a slot per rebuild.
#   4. Without the registry volume a container still allocates, and REPORTS that the gate was missing
#      rather than degrading in silence.
#   5. A container never releases a claim for a port it is serving on.
#
# The in-process half of this suite (tools/shared-browser/port-claim.test.mjs in a scaffolded project,
# `node --test`) covers the race with real concurrent processes. THIS script covers what that cannot: a
# real shared docker volume, real separate containers, real container identities.
#
# Usage:  bash tools/validate-shared-browser/two-container-check.sh [--keep]
#         --keep   leave the containers and volume behind for inspection
set -uo pipefail

IMAGE="${IMAGE:-mcr.microsoft.com/devcontainers/typescript-node:22}"
VOLUME="${VOLUME:-bespunky-shared-ports-validate}"
BAND_START="${BAND_START:-6080}"
BAND_SIZE="${BAND_SIZE:-40}"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="$REPO_ROOT/plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/shared-browser/port-claim.mjs.tpl"

pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$*"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; fail=$((fail+1)); }
info() { printf '  ---- %s\n' "$*"; }

command -v docker >/dev/null 2>&1 || {
  printf 'two-container-check: docker is not available here.\n' >&2
  printf '  This check REQUIRES a real Docker engine — that is the whole point: the failure it hunts\n' >&2
  printf '  only exists across containers. Run it on a machine with Docker (the devcontainer host).\n' >&2
  printf '  The in-process race is covered without Docker by port-claim.test.mjs (node --test).\n' >&2
  exit 2
}
[ -f "$TPL" ] || { printf 'cannot find %s\n' "$TPL" >&2; exit 1; }

# The arbiter, with its band placeholders expanded exactly as the generator would.
WORK="$(mktemp -d)"
sed -e "s/{{novncBandStart}}/$BAND_START/g" -e "s/{{novncBandSize}}/$BAND_SIZE/g" "$TPL" > "$WORK/port-claim.mjs"

cleanup() {
  [ "$KEEP" -eq 1 ] && { info "kept: volume $VOLUME, containers sb-check-*"; return; }
  docker rm -f sb-check-a sb-check-b sb-check-a2 sb-check-solo >/dev/null 2>&1
  docker volume rm "$VOLUME" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

docker volume create "$VOLUME" >/dev/null || { printf 'could not create volume\n' >&2; exit 1; }

# Run the arbiter inside a container with the registry volume mounted. $1=container name, $2=identity,
# rest=extra args. Prints the arbiter's JSON.
run_in() {
  local name="$1" identity="$2"; shift 2
  docker run --rm --name "$name" \
    -v "$VOLUME:/var/opt/bespunky/ports" \
    -v "$WORK/port-claim.mjs:/opt/port-claim.mjs:ro" \
    -e "BESPUNKY_DEVCONTAINER_ID=$identity" \
    "$IMAGE" node /opt/port-claim.mjs \
      --registry=/var/opt/bespunky/ports --identity="dc:$identity" \
      --band-start="$BAND_START" --band-size="$BAND_SIZE" "$@" 2>/dev/null
}
jfield() { printf '%s' "$1" | sed -n "s/.*\"$2\":\\([^,}]*\\).*/\\1/p" | tr -d '"'; }

printf '\ntwo-container-check — %s\n\n' "$IMAGE"

# ── 1 + 2: two containers, distinct ports, self-owned claims ─────────────────────────────────────────
A="$(run_in sb-check-a alpha allocate)"
B="$(run_in sb-check-b beta  allocate)"
pa="$(jfield "$A" port)"; pb="$(jfield "$B" port)"
info "alpha -> ${pa:-?}   beta -> ${pb:-?}"
if [ -n "$pa" ] && [ -n "$pb" ] && [ "$pa" != "$pb" ]; then
  ok "two containers sharing one registry got DISTINCT ports"
else
  bad "expected distinct ports, got alpha=$pa beta=$pb  (this is the original bug)"
fi
[ "$(jfield "$A" registry)" = true ] && ok "the registry gate was available" || bad "registry reported unavailable inside the container"

OWNER_A="$(run_in sb-check-a alpha owner --port="$pa")"
[ "$(jfield "$OWNER_A" owner)" = "dc:alpha" ] && ok "alpha's claim names alpha" || bad "claim owner is $(jfield "$OWNER_A" owner)"

# ── 3: a REBUILD reclaims the same port ──────────────────────────────────────────────────────────────
A2="$(run_in sb-check-a2 alpha allocate --recorded="$pa")"
pa2="$(jfield "$A2" port)"
if [ "$pa2" = "$pa" ]; then
  ok "a rebuilt container (same devcontainerId, new container) RECLAIMED :$pa"
else
  bad "rebuild moved the port $pa -> $pa2 (URL would break; band leaks a slot per rebuild)"
fi

# ── 4: no registry → still allocates, and SAYS the gate was missing ─────────────────────────────────
SOLO="$(docker run --rm --name sb-check-solo \
  -v "$WORK/port-claim.mjs:/opt/port-claim.mjs:ro" "$IMAGE" \
  node /opt/port-claim.mjs allocate --registry=/var/opt/bespunky/ports --identity=dc:solo \
    --band-start="$BAND_START" --band-size="$BAND_SIZE" 2>/dev/null)"
if [ -n "$(jfield "$SOLO" port)" ] && [ "$(jfield "$SOLO" registry)" = false ]; then
  ok "without the volume it still allocates AND reports registry=false (no silent degradation)"
else
  bad "expected a port with registry=false, got: $SOLO"
fi

# ── 5: a served port is never GC'd out from under us ────────────────────────────────────────────────
GC="$(run_in sb-check-a alpha allocate --recorded="$pa" --live="$pb")"
OWNER_B="$(run_in sb-check-a alpha owner --port="$pb")"
if [ "$(jfield "$OWNER_B" owner)" = "dc:beta" ]; then
  ok "beta's LIVE port survived alpha's claim GC"
else
  bad "alpha's GC released a live port (owner now: $(jfield "$OWNER_B" owner))"
fi

printf '\n  %d passed, %d failed\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
