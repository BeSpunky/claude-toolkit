#!/usr/bin/env bash
# resolve-plugin-root.sh — "which install of this plugin is current, right now?"
#
# WHAT THIS GUARDS. `${CLAUDE_PLUGIN_ROOT}` is frozen for the life of a session, so `/sync` asks this script
# where the version it just installed actually lives. Everything downstream rides on the answer: `scaffold.sh`
# derives the `@bespunky/nx-tools` version it installs AND STAMPS into HOUSE.md from its own directory, so a
# wrong answer here does not fail — it quietly syncs the project to the wrong payload and stamps that as
# current, which every later sync then believes.
#
# The two failures worth a test are both silent:
#   - resolving to an OLDER root than the session is running (the downgrade the old "do not hunt for the
#     directory yourself" rule existed to prevent). Migrations do not walk backwards; there is no repair.
#   - picking an ARBITRARY cached version. The cache keeps versions that are no longer installed, so "newest
#     directory" and "installed" are different questions, and a `find … | head -1` answers neither.
#
# Everything is driven through a fake CLAUDE_CONFIG_DIR, so this never reads or touches the real one.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOLVER="$ROOT/plugins/project-starter/scripts/resolve-plugin-root.sh"

[ -f "$RESOLVER" ] || { echo "FATAL: resolve-plugin-root.sh not found at $RESOLVER" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-52s\n' "$1"; else printf '  FAIL %-52s (%s)\n' "$1" "${3:-}"; FAILED=1; fi }

ID="bespunky-project-starter@claude-toolkit"

# A fake ~/.claude: cached plugin directories, plus the manifest naming which are installed.
mk_cache() {   # mk_cache <cfg> <version...> — creates cache dirs with real plugin.json manifests
  local cfg="$1"; shift
  local v
  for v in "$@"; do
    mkdir -p "$cfg/plugins/cache/claude-toolkit/bespunky-project-starter/$v/.claude-plugin"
    printf '{"name":"bespunky-project-starter","version":"%s"}\n' "$v" \
      > "$cfg/plugins/cache/claude-toolkit/bespunky-project-starter/$v/.claude-plugin/plugin.json"
  done
}

mk_manifest() {   # mk_manifest <cfg> <version...> — records those versions as INSTALLED
  local cfg="$1"; shift
  local entries="" v
  for v in "$@"; do
    [ -n "$entries" ] && entries="$entries,"
    entries="$entries{\"scope\":\"user\",\"installPath\":\"$cfg/plugins/cache/claude-toolkit/bespunky-project-starter/$v\",\"version\":\"$v\"}"
  done
  mkdir -p "$cfg/plugins"
  printf '{"version":2,"plugins":{"%s":[%s]}}\n' "$ID" "$entries" > "$cfg/plugins/installed_plugins.json"
}

# Sets OUT and RC. Deliberately NOT `out="$(run …)"` — a command substitution runs in a subshell, so an RC
# assigned inside it never reaches the caller, every `[ "$RC" -ne 0 ]` below reads a stale value, and the
# refusal cases pass or fail for the wrong reason. (Caught by this suite the first time it ran.)
RC=0; OUT=""
run() {   # run <cfg> [session-root]
  local cfg="$1" session="${2-}"
  if [ -n "$session" ]; then
    OUT="$(CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$session" bash "$RESOLVER" 2>"$TMP/err")"
  else
    OUT="$(CLAUDE_CONFIG_DIR="$cfg" bash "$RESOLVER" 2>"$TMP/err")"
  fi
  RC=$?
}

echo "resolve-plugin-root"

# ── the ordinary case: the session is behind, the manifest knows better ──────────────────────────
CFG="$TMP/a"; mk_cache "$CFG" 0.31.0 0.32.0; mk_manifest "$CFG" 0.32.0
run "$CFG" "$CFG/plugins/cache/claude-toolkit/bespunky-project-starter/0.31.0"
ok "resolves the JUST-INSTALLED version, not the session's" \
   "$([ "$OUT" = "$CFG/plugins/cache/claude-toolkit/bespunky-project-starter/0.32.0" ] && echo 1 || echo 0)" "got '$OUT'"

# ── the cache is not the manifest ────────────────────────────────────────────────────────────────
# 0.40.0 sits in the cache but is NOT installed. A directory scan would hand it back; the manifest must win.
CFG="$TMP/b"; mk_cache "$CFG" 0.32.0 0.40.0; mk_manifest "$CFG" 0.32.0
run "$CFG"
ok "ignores a CACHED version that is not installed" \
   "$([ "$OUT" = "$CFG/plugins/cache/claude-toolkit/bespunky-project-starter/0.32.0" ] && echo 1 || echo 0)" "got '$OUT'"

# ── several scopes, different versions ───────────────────────────────────────────────────────────
CFG="$TMP/c"; mk_cache "$CFG" 0.9.0 0.32.0; mk_manifest "$CFG" 0.9.0 0.32.0
run "$CFG"
ok "picks the highest installed scope (semver, not string)" \
   "$([ "$OUT" = "$CFG/plugins/cache/claude-toolkit/bespunky-project-starter/0.32.0" ] && echo 1 || echo 0)" "got '$OUT'"

# ── a manifest entry whose directory is gone is a stale record, not a candidate ──────────────────
CFG="$TMP/d"; mk_cache "$CFG" 0.32.0; mk_manifest "$CFG" 0.32.0 0.33.0   # 0.33.0 recorded, never created
run "$CFG"
ok "skips an installPath that no longer exists" \
   "$([ "$OUT" = "$CFG/plugins/cache/claude-toolkit/bespunky-project-starter/0.32.0" ] && echo 1 || echo 0)" "got '$OUT'"

# ── THE DOWNGRADE GUARD ──────────────────────────────────────────────────────────────────────────
CFG="$TMP/e"; mk_cache "$CFG" 0.20.0 0.32.0; mk_manifest "$CFG" 0.20.0
run "$CFG" "$CFG/plugins/cache/claude-toolkit/bespunky-project-starter/0.32.0"
ok "REFUSES to resolve older than the running session" "$([ "$RC" -ne 0 ] && echo 1 || echo 0)" "rc=$RC out='$OUT'"
ok "…and says why (names both versions)" \
   "$(grep -q '0.20.0' "$TMP/err" && grep -q '0.32.0' "$TMP/err" && echo 1 || echo 0)" "$(head -1 "$TMP/err")"

# Equal versions are the steady state, not a downgrade — the common case once everything is current.
CFG="$TMP/f"; mk_cache "$CFG" 0.32.0; mk_manifest "$CFG" 0.32.0
run "$CFG" "$CFG/plugins/cache/claude-toolkit/bespunky-project-starter/0.32.0"
ok "an EQUAL version resolves normally" "$([ "$RC" -eq 0 ] && echo 1 || echo 0)" "rc=$RC"

# ── nothing installed ────────────────────────────────────────────────────────────────────────────
CFG="$TMP/g"; mkdir -p "$CFG/plugins"
run "$CFG"
ok "fails loudly when nothing is installed" "$([ "$RC" -ne 0 ] && echo 1 || echo 0)" "rc=$RC out='$OUT'"

# ── the fallback fires only when the manifest cannot answer, and announces itself ────────────────
CFG="$TMP/h"; mk_cache "$CFG" 0.30.0 0.31.0 0.32.0   # cache only; no manifest at all
run "$CFG"
ok "falls back to the newest CACHED version, sorted -V" \
   "$([ "$OUT" = "$CFG/plugins/cache/claude-toolkit/bespunky-project-starter/0.32.0" ] && echo 1 || echo 0)" "got '$OUT'"
ok "…and says it fell back (never silently)" \
   "$(grep -q 'fell back' "$TMP/err" && echo 1 || echo 0)" "$(head -1 "$TMP/err")"

# Version sort, not lexical: 0.9.0 must not beat 0.32.0.
CFG="$TMP/i"; mk_cache "$CFG" 0.9.0 0.32.0
run "$CFG"
ok "fallback sorts by VERSION, not lexically" \
   "$([ "$OUT" = "$CFG/plugins/cache/claude-toolkit/bespunky-project-starter/0.32.0" ] && echo 1 || echo 0)" "got '$OUT'"

if [ "$FAILED" = 0 ]; then echo "  resolve-plugin-root: all cases passed"; fi
exit "$FAILED"
