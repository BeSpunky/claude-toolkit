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

# --- stop any still-playing utterance so two questions don't talk over each other
# setsid puts the player in its own process group (pgid == child pid), so
# `kill -- -<pid>` takes down bash+piper+paplay together. The nohup fallback can
# only kill the direct child, which is good enough without setsid.
mkdir -p "$VOICE_HOME" 2>/dev/null || true
PIDFILE="$VOICE_HOME/.speaking.pid"
if [ -f "$PIDFILE" ]; then
  old="$(cat "$PIDFILE" 2>/dev/null)"
  case "$old" in
    ''|*[!0-9]*) : ;;
    *) kill -- "-$old" 2>/dev/null || kill "$old" 2>/dev/null || true ;;
  esac
fi

# --- speak it, DETACHED, so the question UI renders immediately ---------------
# Text is passed as an argument (extract-spoken.mjs caps its length, so no
# ARG_MAX risk) rather than piped, avoiding any stdin-lifetime race when we exit.
if command -v setsid >/dev/null 2>&1; then
  setsid bash "$PLUGIN_ROOT/scripts/speak.sh" "$SPOKEN" >/dev/null 2>&1 &
else
  nohup bash "$PLUGIN_ROOT/scripts/speak.sh" "$SPOKEN" >/dev/null 2>&1 &
fi
echo "$!" > "$PIDFILE" 2>/dev/null || true

exit 0
