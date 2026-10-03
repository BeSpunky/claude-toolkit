#!/usr/bin/env bash
# bespunky-voice — speaker.sh : the ONE controller of what is being said.
#
# speak.sh turns text into sound; this script owns the UTTERANCE — the process
# that is speaking right now, and what was said last — so speech can be stopped
# and replayed from anywhere: a hook, the /speak command, the MCP ask tool. Every
# caller that speaks goes through here; none of them keeps its own pid.
#
#   speaker.sh say [--wait] <text…>   stop whatever is speaking, remember <text>,
#                                     speak it. Detached by default (a hook must
#                                     not block the UI); --wait blocks until done
#                                     and passes speak.sh's stderr + exit through —
#                                     143 when the utterance was STOPPED (by
#                                     stop, a newer say, or the user), so a caller
#                                     can tell "nobody heard it" from "it played".
#   speaker.sh replay [--wait]        say the last utterance again.
#   speaker.sh stop                   silence the current utterance, if any.
#
# State (machine-local, beside the published runtime) — also read by the voice
# band, so it must stay TRUE, not merely written:
#   .speaking.pid       pgid of the utterance in flight (setsid → pgid == pid);
#                       exists exactly while something is being said — the
#                       utterance removes it itself when it ends, stop() when it
#                       is cut short.
#   last-utterance.txt  the text most recently said (mtime = when it started)
set -uo pipefail

VOICE_HOME="${HOME}/.claude/bespunky-voice"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPEAK="$HERE/speak.sh"
PIDFILE="$VOICE_HOME/.speaking.pid"
LAST="$VOICE_HOME/last-utterance.txt"
mkdir -p "$VOICE_HOME" 2>/dev/null || true

# stop → launch → record-the-pid is ONE step. Two callers interleaving it (two
# hooks firing at once) would both speak, and only the last pid could ever be
# stopped. flock where it exists; elsewhere (macOS) an atomic mkdir, given up
# after ~2 s so a holder that died mid-step can never wedge speech for good.
LOCK="$VOICE_HOME/.speaker.lock"
lock() {
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK" && flock -w 5 9
  else
    local i
    for i in $(seq 40); do mkdir "$LOCK.d" 2>/dev/null && return 0; sleep 0.05; done
  fi
  return 0
}
unlock() {
  if command -v flock >/dev/null 2>&1; then flock -u 9 2>/dev/null; exec 9>&-
  else rmdir "$LOCK.d" 2>/dev/null; fi
  return 0
}

# Speech runs in its OWN process group, so stop() takes down bash + piper +
# paplay together. setsid where it exists; perl's setpgrp elsewhere (macOS ships
# perl, not setsid) — without either, stop would reach only speak.sh's shell
# while its player kept talking.
if command -v setsid >/dev/null 2>&1; then OWN_GROUP=(setsid)
elif command -v perl >/dev/null 2>&1; then OWN_GROUP=(perl -e 'setpgrp(0, 0); exec @ARGV or die "exec: $!"')
else OWN_GROUP=()
fi

# Stop the utterance in flight. The pid is checked to still BE a speak.sh before
# its group is signalled — a stale pidfile must never kill a stranger that
# inherited the number.
stop() {
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null)" || return 0
  rm -f "$PIDFILE"
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  # speak.sh — or, for an instant after launch, still our own fork (speaker.sh)
  # on its way to exec'ing it.
  ps -o args= -p "$pid" 2>/dev/null | grep -Eq 'speak(er)?\.sh' || return 0
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

say() {
  local wait=0
  [ "${1:-}" = --wait ] && { wait=1; shift; }
  local text="$*"
  [ -n "${text//[[:space:]]/}" ] || return 0
  lock
  stop
  printf '%s' "$text" > "$LAST" 2>/dev/null || true

  # The utterance runs as `speaker.sh _utter`, not speak.sh directly, so it can
  # clear its own pidfile when it finishes on its own (see _utter below).
  local launch=("${OWN_GROUP[@]}" bash "$HERE/speaker.sh" _utter "$text")
  if [ "$wait" = 1 ]; then
    "${launch[@]}" 9>&- &
  else
    nohup "${launch[@]}" >/dev/null 2>&1 9>&- &
  fi
  local pid=$!
  echo "$pid" > "$PIDFILE" 2>/dev/null || true
  unlock
  [ "$wait" = 1 ] || return 0

  wait "$pid"; local rc=$?
  # Cut short by a signal → the one "stopped" code, whatever the signal was.
  [ "$rc" -ge 128 ] && return 143
  return "$rc"
}

# The utterance itself: speak, then — if the pidfile still names THIS utterance
# (a newer say or a stop may have replaced or removed it) — clear it, so
# ".speaking.pid exists" stays true to "something is being said".
utter() {
  bash "$SPEAK" "$@"; local rc=$?
  lock
  [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ] && rm -f "$PIDFILE"
  unlock
  return "$rc"
}

case "${1:-}" in
  say)    shift; say "$@" ;;
  replay) shift
          [ -s "$LAST" ] || { echo "bespunky-voice: nothing has been said yet" >&2; exit 1; }
          say "$@" "$(cat "$LAST")" ;;
  stop)   lock; stop; unlock ;;
  _utter) shift; utter "$@" ;;   # internal: how say() launches an utterance
  *)      echo "usage: speaker.sh say [--wait] <text> | replay [--wait] | stop" >&2; exit 2 ;;
esac
