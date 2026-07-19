#!/usr/bin/env bash
# bespunky-voice — SessionStart hook: publish runtime scripts to a STABLE home.
#
# WHY THIS EXISTS. A slash command's markdown does NOT reliably get
# ${CLAUDE_PLUGIN_ROOT} expanded, and a plugin's real install path is
# unpredictable (it lives deep under ~/.claude/plugins/… or a project's
# .claude/). So the /voice command can't portably point at its own scripts.
# This hook — which DOES get ${CLAUDE_PLUGIN_ROOT} — copies them to one fixed,
# predictable location every session start, so the command can call an absolute
# path with no env var at all. Idempotent, silent, cheap.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] || exit 0

DEST="${HOME}/.claude/bespunky-voice"
mkdir -p "$DEST" 2>/dev/null || exit 0
cp -f "$PLUGIN_ROOT"/scripts/*.sh "$DEST"/ 2>/dev/null || exit 0
chmod +x "$DEST"/*.sh 2>/dev/null || true

exit 0
