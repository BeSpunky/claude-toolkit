#!/usr/bin/env bash
# bespunky-voice — voice-auto.sh : toggle / inspect AUTOMATIC speaking.
#
# The manual trigger (/voice say) always works. This governs only the AUTOMATIC
# half: when ON, the PreToolUse hook speaks each multiple-choice question and
# plan-approval as it appears. Default is OFF — the plugin never makes a sound
# you didn't ask for until you opt in.
#
# State = one file, "on" or absent, at ~/.claude/bespunky-voice/voice-auto. This
# is a MACHINE/session fact ("am I away from the keyboard right now?"), not a repo
# fact — so it lives with the rest of the plugin's machine-local runtime, NOT in a
# project's .claude/ (which would make you re-toggle per project and risk being
# committed into a consumer repo).
set -uo pipefail

STATE_DIR="${HOME}/.claude/bespunky-voice"
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
