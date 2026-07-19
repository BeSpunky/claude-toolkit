#!/usr/bin/env bash
# bespunky-voice — Stop hook: speak a PLAIN-TEXT question that ended the turn.
#
# Covers the questions the PreToolUse hook can't: the ones Claude asks as prose
# (ending in "?") rather than via the AskUserQuestion / ExitPlanMode tools. The
# extractor prints nothing when the turn ended on a tool call, so the two hooks
# never speak the same question. Only active when auto-speak is on; writes nothing
# to stdout (a Stop hook's stdout would be added to context).
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] || exit 0
VOICE_HOME="${HOME}/.claude/bespunky-voice"

# gate: only when the user opted into automatic speaking (global toggle)
STATE="$VOICE_HOME/voice-auto"
{ [ -f "$STATE" ] && [ "$(cat "$STATE" 2>/dev/null)" = on ]; } || exit 0

INPUT="$(cat)"
command -v node >/dev/null 2>&1 || exit 0
SPOKEN="$(printf '%s' "$INPUT" | node "$PLUGIN_ROOT/hooks/extract-turn-question.mjs" 2>/dev/null)"
[ -n "$SPOKEN" ] || exit 0

bash "$PLUGIN_ROOT/scripts/speak-detached.sh" "$SPOKEN"
exit 0
