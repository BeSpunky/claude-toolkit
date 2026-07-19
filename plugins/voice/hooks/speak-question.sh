#!/usr/bin/env bash
# bespunky-voice — PreToolUse hook: speak questions / plan approvals aloud.
#
# Fires (per hooks.json matcher) right BEFORE an AskUserQuestion or ExitPlanMode
# tool renders — so you HEAR the question, then the picker is already on screen.
# Only speaks when you've turned auto-speak on (/voice auto on); otherwise silent.
#
# Never writes to stdout: a PreToolUse hook's stdout can be fed back into the
# model's context, and this is a pure audio side effect. All output is discarded.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -n "$PLUGIN_ROOT" ] || exit 0

# --- gate: only when the user opted into automatic speaking -------------------
STATE="$PROJECT_DIR/.claude/voice-auto"
{ [ -f "$STATE" ] && [ "$(cat "$STATE" 2>/dev/null)" = on ]; } || exit 0

# --- read the hook payload and turn it into ear-ready text --------------------
INPUT="$(cat)"
command -v node >/dev/null 2>&1 || exit 0   # need Node to parse nested tool_input
SPOKEN="$(printf '%s' "$INPUT" | node "$PLUGIN_ROOT/hooks/extract-spoken.mjs" 2>/dev/null)"
[ -n "$SPOKEN" ] || exit 0

# --- speak it, DETACHED, so the question UI renders immediately ---------------
# Text is passed as an argument (not piped) so no stdin lifetime races when the
# hook returns; setsid detaches the player so it keeps talking after we exit.
if command -v setsid >/dev/null 2>&1; then
  setsid bash "$PLUGIN_ROOT/scripts/speak.sh" "$SPOKEN" >/dev/null 2>&1 &
else
  nohup bash "$PLUGIN_ROOT/scripts/speak.sh" "$SPOKEN" >/dev/null 2>&1 &
fi

exit 0
