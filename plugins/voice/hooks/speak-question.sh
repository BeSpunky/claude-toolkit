#!/usr/bin/env bash
# bespunky-voice — PreToolUse hook: speak questions / plan approvals aloud.
#
# Fires (per hooks.json matcher) right BEFORE an AskUserQuestion or ExitPlanMode
# tool renders — so you HEAR the question, then the picker is already on screen.
# Only speaks when you've turned auto-speak on (/voice auto on); otherwise silent.
#
# Writes nothing to stdout. A PreToolUse hook's stdout goes to the debug log (not
# the model context, and not the transcript), so this is purely to keep that log
# clean — the work here is an audio side effect, never a message to anyone.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] || exit 0
VOICE_HOME="${HOME}/.claude/bespunky-voice"

# --- gate: only when the user opted into automatic speaking (global toggle) ----
STATE="$VOICE_HOME/voice-auto"
{ [ -f "$STATE" ] && [ "$(cat "$STATE" 2>/dev/null)" = on ]; } || exit 0

# --- read the hook payload and turn it into ear-ready text --------------------
INPUT="$(cat)"
command -v node >/dev/null 2>&1 || exit 0   # need Node to parse nested tool_input
SPOKEN="$(printf '%s' "$INPUT" | node "$PLUGIN_ROOT/hooks/extract-spoken.mjs" 2>/dev/null)"
[ -n "$SPOKEN" ] || exit 0

# --- speak it, detached (cancelling any in-flight utterance), so the question UI
# renders immediately. Shared with the Stop hook via speak-detached.sh.
bash "$PLUGIN_ROOT/scripts/speak-detached.sh" "$SPOKEN"

exit 0
