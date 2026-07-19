#!/usr/bin/env bash
# bespunky-voice — voice-auto.sh : toggle / inspect AUTOMATIC speaking.
#
# The manual trigger (/voice say) always works. This governs only the AUTOMATIC
# half: when ON, the PreToolUse hook speaks each multiple-choice question and
# plan-approval as it appears. Default is OFF — the plugin never makes a sound
# you didn't ask for until you opt in.
#
# State = one file at <project>/.claude/voice-auto containing "on". Absent ⇒ off.
# Lives in .claude/ because this is deliberately LOCAL, personal, per-machine
# state (your "am I cleaning the house right now?" switch), not a repo fact to
# share — exactly what .claude/ is for.
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_DIR="$PROJECT_DIR/.claude"
STATE="$STATE_DIR/voice-auto"

case "${1:-status}" in
  on)
    mkdir -p "$STATE_DIR"
    printf 'on\n' > "$STATE"
    echo "auto-speak: ON — questions and plan approvals will be read aloud."
    ;;
  off)
    rm -f "$STATE"
    echo "auto-speak: OFF — nothing is spoken unless you run /voice say."
    ;;
  status)
    if [ -f "$STATE" ] && [ "$(cat "$STATE" 2>/dev/null)" = on ]; then
      echo on
    else
      echo off
    fi
    ;;
  *)
    echo "usage: voice-auto.sh [on|off|status]" >&2
    exit 2
    ;;
esac
