#!/usr/bin/env bash
# bespunky-voice — speaker.sh : the ONE controller of what is being said.
#
# speak.sh turns text into sound; this script owns the UTTERANCE — the process
# that is speaking right now, and what was said last — so speech can be stopped
# and replayed from anywhere: a hook, the /voice command, the MCP ask tool. Every
# caller that speaks goes through here; none of them keeps its own pid.
#
#   speaker.sh say [--wait] <text…>   stop whatever is speaking, remember <text>,
#                                     speak it. Detached by default (a hook must
#                                     not block the UI); --wait blocks until done
#                                     and passes speak.sh's stderr + exit through.
#   speaker.sh replay [--wait]        say the last utterance again.
#   speaker.sh stop                   silence the current utterance, if any.
#
# State (machine-local, beside the published runtime):
#   .speaking.pid       pgid of the utterance in flight (setsid → pgid == pid)
#   last-utterance.txt  the text most recently said
set -uo pipefail

VOICE_HOME="${HOME}/.claude/bespunky-voice"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPEAK="$HERE/speak.sh"
PIDFILE="$VOICE_HOME/.speaking.pid"
LAST="$VOICE_HOME/last-utterance.txt"
mkdir -p "$VOICE_HOME" 2>/dev/null || true

# Stop the utterance in flight. The pid is checked to still BE a speak.sh before
# its group is signalled — a stale pidfile must never kill a stranger that
# inherited the number.
stop() {
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null)" || return 0
  rm -f "$PIDFILE"
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  ps -o args= -p "$pid" 2>/dev/null | grep -q 'speak\.sh' || return 0
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

say() {
  local wait=0
  [ "${1:-}" = --wait ] && { wait=1; shift; }
  local text="$*"
  [ -n "${text//[[:space:]]/}" ] || return 0
  stop
  printf '%s' "$text" > "$LAST" 2>/dev/null || true

  # Its own process group, so stop() takes down bash + piper + paplay together.
  local launch=(bash "$SPEAK" "$text")
  command -v setsid >/dev/null 2>&1 && launch=(setsid "${launch[@]}")
  if [ "$wait" = 1 ]; then
    "${launch[@]}" &
  else
    nohup "${launch[@]}" >/dev/null 2>&1 &
  fi
  local pid=$!
  echo "$pid" > "$PIDFILE" 2>/dev/null || true
  [ "$wait" = 1 ] || return 0

  wait "$pid"; local rc=$?
  # Clear the pidfile only if it is still ours (a newer say may have replaced it).
  [ "$(cat "$PIDFILE" 2>/dev/null)" = "$pid" ] && rm -f "$PIDFILE"
  # Killed by stop() is not a failure of speech.
  [ "$rc" -ge 128 ] && return 0
  return "$rc"
}

case "${1:-}" in
  say)    shift; say "$@" ;;
  replay) shift
          [ -s "$LAST" ] || { echo "bespunky-voice: nothing has been said yet" >&2; exit 1; }
          say "$@" "$(cat "$LAST")" ;;
  stop)   stop ;;
  *)      echo "usage: speaker.sh say [--wait] <text> | replay [--wait] | stop" >&2; exit 2 ;;
esac
