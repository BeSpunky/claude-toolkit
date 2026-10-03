#!/usr/bin/env bash
# bespunky-voice — voice.sh : control of "the voice" as a whole.
#
# The voice is two activities owned by two scripts: speaking (speaker.sh owns the
# utterance) and listening (listen.sh announces its open recording). Every way a
# person says "enough" — the band's Stop, Esc on the ask tool, typing a prompt,
# answering the picker, /speak stop — means BOTH, so they all call this one verb
# rather than each knowing the two halves.
#
#   voice.sh stop     silence speech and end any open recording
#   voice.sh replay   say the last utterance again (detached)
set -uo pipefail

VOICE_HOME="${HOME}/.claude/bespunky-voice"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# End the open recording, if any. listen.sh traps TERM: it stops its recorder and
# recogniser and removes its own announcement. The pid is checked to still BE a
# listen.sh — a stale file must never kill a stranger that inherited the number.
stop_listening() {
  local pid
  pid="$(cat "$VOICE_HOME/.listening.pid" 2>/dev/null)" || return 0
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  if ps -o args= -p "$pid" 2>/dev/null | grep -q 'listen\.sh'; then
    kill -TERM "$pid" 2>/dev/null || true
  else
    rm -f "$VOICE_HOME/.listening.pid" "$VOICE_HOME/.hearing"   # stale: the writer died
  fi
}

case "${1:-}" in
  stop)   bash "$HERE/speaker.sh" stop; stop_listening ;;
  replay) bash "$HERE/speaker.sh" replay ;;
  *)      echo "usage: voice.sh stop | replay" >&2; exit 2 ;;
esac
