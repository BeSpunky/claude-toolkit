#!/usr/bin/env bash
# bespunky-voice — voice-health.sh : the voice engines' health, for a machine to read.
#
# The voice band (hooks/band.tsx) shows a warning when an engine will let the
# person down — Piper broken and speech about to come out robotic, or no speech
# recognition for ask_by_voice — so they are never surprised by it. It must not
# decide that itself: what "works" means is owned by the scripts that use the
# engines, so this only REPORTS their verdicts:
#   TTS  tts-engine.sh's voice_tts_verdict — the same probe /speak status and
#        speak.sh rely on (piper is RUN, never judged by its files).
#   STT  listen.sh's own resolution of whisper-cli and its model (sourced, so the
#        paths can't drift), then whisper-cli is RUN: like piper, whisper.cpp
#        ships shared libraries behind soname links, so a present binary can still
#        die in the dynamic linker. `--help` loads every linked library and costs
#        milliseconds.
#
# Output — two tab-separated lines, always both, exit 0 (absence is a fact):
#   tts<TAB>natural|broken|robotic|system|none<TAB>why (empty when natural)
#   stt<TAB>ok|broken|missing<TAB>why (empty when ok)
#
# Cost: one short piper synthesis (~0.3 s). Callers that poll cache it.
#
# Sourced, it defines voice_stt_verdict (→ VOICE_STT_HEALTH ok|broken|missing,
# VOICE_STT_PROBLEM) — what /speak status reports for listening — and prints nothing.
set -uo pipefail

_VOICE_HEALTH_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=tts-engine.sh
. "$_VOICE_HEALTH_HERE/tts-engine.sh"

voice_stt_verdict() {
  # Sourced, listen.sh resolves CLI and MODEL and returns before touching a device.
  # shellcheck source=listen.sh
  . "$_VOICE_HEALTH_HERE/listen.sh"
  local err
  VOICE_STT_HEALTH=ok VOICE_STT_PROBLEM=""
  if [ ! -x "$CLI" ]; then
    VOICE_STT_HEALTH=missing VOICE_STT_PROBLEM="whisper-cli is not installed"
  elif [ ! -f "$MODEL" ]; then
    VOICE_STT_HEALTH=missing VOICE_STT_PROBLEM="no whisper model in $WHDIR/models"
  elif ! err="$("$CLI" --help 2>&1 >/dev/null)"; then
    VOICE_STT_HEALTH=broken
    VOICE_STT_PROBLEM="whisper-cli failed: $(printf '%s\n' "$err" | grep -v '^[[:space:]]*$' | tail -n1)"
  fi
  return 0
}

[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

one_line() { printf '%s' "$1" | tr '\t\n' '  '; }

voice_tts_verdict
tts_why=""
[ "$VOICE_TTS_HEALTH" = natural ] || tts_why="$VOICE_PIPER_PROBLEM"
printf 'tts\t%s\t%s\n' "$VOICE_TTS_HEALTH" "$(one_line "$tts_why")"

voice_stt_verdict
printf 'stt\t%s\t%s\n' "$VOICE_STT_HEALTH" "$(one_line "$VOICE_STT_PROBLEM")"
exit 0
