#!/usr/bin/env bash
# check-house-version.sh (the SessionStart hook) — the notice it relays must be TRUE.
#
# WHAT THIS GUARDS. The hook speaks into every session of every house project on the machine, so a false
# sentence there is worse than silence. The case pinned here: a project stamped by an OLDER toolkit, whose
# registry did not yet know a layer the installed one detects (every 0.34 project and `node`). It changed
# nothing — the TOOLKIT moved — so the notice must be the version one ("the installed house tooling is NEWER"),
# never "this project has grown a layer". And the true layer-growth case (same version, a new layer's evidence)
# must still fire.
#
# Drives the hook against throwaway projects with the repo's own plugin root; touches nothing else.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLUGIN="$ROOT/plugins/project-starter"
HOOK="$PLUGIN/hooks/check-house-version.sh"
INSTALLED="$(node -p "require('$PLUGIN/skills/new-project/assets/nx-tools/package.json').version")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" 2>/dev/null || sudo -n rm -rf "$TMP"' EXIT

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-60s\n' "$1"; else printf '  FAIL %-60s (%s)\n' "$1" "${3:-}"; FAILED=1; fi }

stamp() {   # stamp <dir> <nx-tools version> <layers>
  mkdir -p "$1"
  printf '<!-- @bespunky/house-tooling:stamp nx-tools=%s plugin=0.0.0 layers=%s -->\n# HOUSE.md\n' "$2" "$3" > "$1/HOUSE.md"
}
run_hook() { CLAUDE_PROJECT_DIR="$1" CLAUDE_PLUGIN_ROOT="$PLUGIN" bash "$HOOK" 2>&1; }

# An older-stamped Angular-era project: package.json (the `node` layer's evidence) but no `node` in the stamp.
P="$TMP/old"; stamp "$P" 0.1.0 'agent,js,nx'
printf '{"name":"old","devDependencies":{"@nx/js":"1.0.0"}}\n' > "$P/package.json"
out="$(run_hook "$P")"
ok 'older stamp: no "grown a layer" for a layer the old registry lacked' "$( [[ "$out" != *'grown a layer'* ]] && echo 1 || echo 0)" "$out"
ok 'older stamp: the version notice speaks instead' "$( [[ "$out" == *'NEWER than this project'* ]] && echo 1 || echo 0)" "${out:0:200}"

# Same version, a layer genuinely grown: a wrapper repo stamped nx,agent that now declares what it serves.
P="$TMP/grew"; stamp "$P" "$INSTALLED" 'nx,agent'
mkdir -p "$P/.bespunky" && printf '{"apps":{"site":{"processes":[{"id":"app","cmd":"x","ports":{"app":8000}}]}}}\n' > "$P/.bespunky/dev.json"
out="$(run_hook "$P")"
ok 'same version: a grown layer (web) is still reported' "$( [[ "$out" == *'grown a layer'* && "$out" == *'web'* ]] && echo 1 || echo 0)" "${out:0:200}"

# Current and complete: silence.
P="$TMP/current"; stamp "$P" "$INSTALLED" 'nx,agent'
out="$(run_hook "$P")"
ok 'current stamp, no new layer: silent' "$( [ -z "$out" ] && echo 1 || echo 0)" "$out"

# A root-owned volume mount point: the container's post-create most likely failed on it. ONE fact, naming the
# path and owner and the exact fix, from the same derivation the sync preflight uses (the project's
# devcontainer.json). Needs a non-root user with passwordless sudo to build the fixture; skipped out loud otherwise.
if [ "$(id -u)" = 0 ] || ! sudo -n true 2>/dev/null; then
  echo "  skip root-owned mount point cases — need a non-root user with passwordless sudo"
else
  P="$TMP/vol"; stamp "$P" "$INSTALLED" 'nx,agent'
  mkdir -p "$P/.devcontainer"
  printf '{ "mounts": [ "source=x,target=${containerWorkspaceFolder}/.angular,type=volume" ] }\n' > "$P/.devcontainer/devcontainer.json"
  echo 'echo hi' > "$P/.devcontainer/post-create.sh"
  mkdir "$P/node_modules"
  out="$(run_hook "$P")"
  ok 'writable mount points: silent' "$( [ -z "$out" ] && echo 1 || echo 0)" "$out"
  sudo -n mkdir "$P/.angular"
  out="$(run_hook "$P")"
  ok 'root-owned volume mount point: one fact, path + owner' "$( [[ "$out" == *'post-create most likely FAILED'* && "$out" == *'.angular (root)'* && "$out" != *node_modules* ]] && echo 1 || echo 0)" "$out"
  ok 'root-owned volume mount point: the exact remedy' "$( [[ "$out" == *'sudo chown -R "$(id -un):$(id -gn)" .angular'* && "$out" == *'bash .devcontainer/post-create.sh'* ]] && echo 1 || echo 0)" "$out"
  ok 'root-owned volume mount point: a single line' "$( [ "$(printf '%s\n' "$out" | wc -l)" = 1 ] && echo 1 || echo 0)" "$out"
fi

exit "$FAILED"
