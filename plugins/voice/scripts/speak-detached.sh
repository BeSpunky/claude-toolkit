#!/usr/bin/env bash
# bespunky-voice — speak-detached.sh
#
# Speak text ("$1") as a fire-and-forget side effect, cancelling any utterance
# still playing first so two auto-speak hooks never talk over each other. Shared
# by the PreToolUse hook (speak-question.sh) and the Stop hook (speak-turn.sh) —
# the one place the "kill previous, detach, record pid" dance lives.
set -uo pipefail

[ -n "${1:-}" ] || exit 0
TEXT="$1"

VOICE_HOME="${HOME}/.claude/bespunky-voice"
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
SPEAK="$HERE/speak.sh"
[ -f "$SPEAK" ] || SPEAK="$VOICE_HOME/speak.sh"   # fall back to the published copy
[ -f "$SPEAK" ] || exit 0

mkdir -p "$VOICE_HOME" 2>/dev/null || true
PIDFILE="$VOICE_HOME/.speaking.pid"

# Cancel a still-playing utterance. setsid made it a process-group leader
# (pgid == pid), so -pid takes down bash+piper+paplay together.
if [ -f "$PIDFILE" ]; then
  old="$(cat "$PIDFILE" 2>/dev/null)"
  case "$old" in
    ''|*[!0-9]*) : ;;
    *) kill -- "-$old" 2>/dev/null || kill "$old" 2>/dev/null || true ;;
  esac
fi

if command -v setsid >/dev/null 2>&1; then
  setsid bash "$SPEAK" "$TEXT" >/dev/null 2>&1 &
else
  nohup bash "$SPEAK" "$TEXT" >/dev/null 2>&1 &
fi
echo "$!" > "$PIDFILE" 2>/dev/null || true
exit 0
