#!/usr/bin/env bash
# Resolve the CURRENTLY-INSTALLED root of a claude-toolkit plugin — the one on disk right now, not the one
# this session happens to be running from. Prints an absolute path on stdout; every diagnostic goes to stderr.
#
#   resolve-plugin-root.sh [<plugin-id>]      # default: bespunky-project-starter@claude-toolkit
#
# WHY THIS EXISTS. `${CLAUDE_PLUGIN_ROOT}` is fixed for the life of a session. `claude plugin update` writes a
# new version to disk immediately, but the running session keeps pointing at the copy it started with — so
# `/sync` used to STOP after updating and demand a restart, spending an entire run on nothing. That restart is
# the single biggest reason the sync took two or three passes to complete.
#
# It is also why the payload version was wrong on the wasted run: `scaffold.sh` derives NX_TOOLS_VERSION from
# its OWN directory (`${BASH_SOURCE[0]}` -> assets/nx-tools/package.json), so whichever copy executes decides
# which `@bespunky/nx-tools` gets installed and stamped into HOUSE.md. An old root installs an old payload and
# stamps it; the next sync then has to walk the ladder that run should have walked. Resolving the root fixes
# the payload for free — there is no second knob.
#
# THE MANIFEST IS THE ANSWER, AND A DIRECTORY SCAN IS NOT. `installed_plugins.json` is written by the CLI at
# install/update time and records `installPath` per scope. That is a keyed read of a fact the CLI just stated.
# The thing this deliberately does NOT do is what `sync.md` used to forbid for good reason: `find … | head -1`
# over the cache, which picks an ARBITRARY cached version — on a machine with several that has handed back a
# scaffolder ten releases old. The cache also retains versions that are no longer installed, so "newest
# directory" and "installed" are simply different questions. The scan survives only as a last-resort fallback
# when the manifest is unreadable, and it says so out loud when it fires.
#
# BOOTSTRAPPING. This script necessarily runs from the FROZEN root (it is what finds the current one). That is
# safe because it only reads a manifest — no generator logic, no payload, nothing that changes between
# releases. Keep it that way: if this file ever needs to know something version-specific, the knowledge
# belongs in the resolved copy, not here.
#
# IT NEVER RESOLVES BACKWARDS. If the version it finds is OLDER than the root this session is running from,
# that is the downgrade case the old prohibition existed to prevent, and it is a hard failure rather than a
# silent pick — running an older scaffolder re-stamps HOUSE.md backwards and runs older generators over a
# newer shape, which migrations cannot undo.
set -uo pipefail

PLUGIN_ID="${1:-bespunky-project-starter@claude-toolkit}"
PLUGIN_NAME="${PLUGIN_ID%@*}"
MARKETPLACE="${PLUGIN_ID#*@}"

# INSIDE A HOUSE DEVCONTAINER THIS PATH IS IN THE WORKSPACE. The generated devcontainer bind-mounts
# `${localWorkspaceFolder}/.claude/data` onto `/home/node/.claude`, so `$HOME/.claude` resolves to a folder
# of the project itself. Three things follow, and all of them are wanted: the plugin cache is per-workspace
# (two projects can sit on different toolkit versions without fighting), it is a BIND mount rather than a
# volume so it survives `Rebuild Container` intact, and the manifest read below is a plain file read either
# way. Nothing here needs to know which of the two it is looking at — but `scaffold.sh`'s SYNC_NEXT reporter
# does, since this state churns inside the tree it diffs; see the anchoring note there.
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
MANIFEST="$CONFIG_DIR/plugins/installed_plugins.json"
CACHE_DIR="$CONFIG_DIR/plugins/cache/$MARKETPLACE/$PLUGIN_NAME"

# Version ordering — the same comparator shape scaffold.sh uses (see its `_vlt`); kept as its own copy here
# because this script runs standalone, before anything of the payload is resolved. The only way the two can
# disagree is over prerelease ordering, and this marketplace has never shipped a prerelease.
_version_of() {  # <plugin-root> -> version from its manifest, or empty
  local manifest="$1/.claude-plugin/plugin.json"
  [ -f "$manifest" ] || return 0
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -1
}

_vlt() {  # true when $1 < $2
  node -e '
    const core = v => { const m = String(v).match(/^[0-9]+(\.[0-9]+)*/); const n = (m ? m[0] : "").split(".").filter(s => s !== "").map(Number); while (n.length < 3) n.push(0); return n; };
    const isPre = v => /^[^+]*-/.test(String(v));
    const [a, b] = process.argv.slice(1);
    if (a === b) process.exit(1);
    const x = core(a), y = core(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) process.exit(x[i] < y[i] ? 0 : 1);
    if (isPre(a) !== isPre(b)) process.exit(isPre(a) ? 0 : 1);
    process.exit(1);
  ' "$1" "$2" 2>/dev/null
}

# --- the manifest path: ask the CLI's own record where the plugin is installed ---------------------------
#
# A plugin can be installed at several SCOPES (project and user both appear in a normal setup) and they can
# legitimately sit at different versions. The highest one whose directory actually exists is the one this
# machine can run — an entry whose path has been cleaned away is a stale record, not a candidate.
RESOLVED=""
if [ -f "$MANIFEST" ] && command -v node >/dev/null 2>&1; then
  RESOLVED="$(node -e '
    const fs = require("fs");
    const [manifest, id] = process.argv.slice(1);
    let doc;
    try { doc = JSON.parse(fs.readFileSync(manifest, "utf8")); } catch { process.exit(0); }
    const entries = (doc && doc.plugins && doc.plugins[id]) || [];
    const core = v => { const m = String(v).match(/^[0-9]+(\.[0-9]+)*/); const n = (m ? m[0] : "").split(".").filter(s => s !== "").map(Number); while (n.length < 3) n.push(0); return n; };
    const cmp = (a, b) => { const x = core(a), y = core(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
    const live = entries.filter(e => e && e.installPath && fs.existsSync(e.installPath));
    if (!live.length) process.exit(0);
    live.sort((a, b) => cmp(b.version || "0.0.0", a.version || "0.0.0"));
    process.stdout.write(live[0].installPath);
  ' "$MANIFEST" "$PLUGIN_ID" 2>/dev/null)"
fi

# --- last resort: the versioned cache, sorted properly ----------------------------------------------------
#
# Only when the manifest could not answer (absent, unreadable, or no node). Announced, because "newest cached"
# is a weaker claim than "installed" and the difference is exactly what the old prohibition was about.
if [ -z "$RESOLVED" ] && [ -d "$CACHE_DIR" ]; then
  RESOLVED="$(find "$CACHE_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)"
  [ -n "$RESOLVED" ] && echo "[resolve-plugin-root] NOTE: '$MANIFEST' was unreadable — fell back to the newest CACHED version. Verify it matches 'claude plugin list' before trusting it." >&2
fi

if [ -z "$RESOLVED" ] || [ ! -d "$RESOLVED" ]; then
  echo "[resolve-plugin-root] ERROR: could not locate an installed '$PLUGIN_ID'." >&2
  echo "                      Looked in: $MANIFEST" >&2
  echo "                             and: $CACHE_DIR" >&2
  exit 1
fi

# --- never hand back an OLDER root than the one already running -------------------------------------------
CURRENT="${CLAUDE_PLUGIN_ROOT:-}"
if [ -n "$CURRENT" ] && [ -d "$CURRENT" ]; then
  RESOLVED_V="$(_version_of "$RESOLVED")"
  CURRENT_V="$(_version_of "$CURRENT")"
  if [ -n "$RESOLVED_V" ] && [ -n "$CURRENT_V" ] && _vlt "$RESOLVED_V" "$CURRENT_V"; then
    echo "[resolve-plugin-root] ERROR: the installed plugin ($RESOLVED_V) is OLDER than the one this session is" >&2
    echo "                      running ($CURRENT_V). Running it would re-stamp the project backwards and apply" >&2
    echo "                      older generators over a newer shape — migrations do not walk backwards." >&2
    echo "                      installed: $RESOLVED" >&2
    echo "                      session:   $CURRENT" >&2
    exit 1
  fi
fi

printf '%s\n' "$RESOLVED"
