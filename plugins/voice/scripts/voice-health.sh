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
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

one_line() { printf '%s' "$1" | tr '\t\n' '  '; }

# shellcheck source=tts-engine.sh
. "$HERE/tts-engine.sh"
voice_tts_verdict
tts_why=""
[ "$VOICE_TTS_HEALTH" = natural ] || tts_why="$VOICE_PIPER_PROBLEM"
printf 'tts\t%s\t%s\n' "$VOICE_TTS_HEALTH" "$(one_line "$tts_why")"

# Sourced, listen.sh resolves CLI and MODEL and returns before touching a device.
# shellcheck source=listen.sh
. "$HERE/listen.sh"
stt=ok stt_why=""
if [ ! -x "$CLI" ]; then
  stt=missing stt_why="whisper-cli is not installed"
elif [ ! -f "$MODEL" ]; then
  stt=missing stt_why="no whisper model in $WHDIR/models"
elif ! err="$("$CLI" --help 2>&1 >/dev/null)"; then
  stt=broken stt_why="whisper-cli failed: $(printf '%s\n' "$err" | grep -v '^[[:space:]]*$' | tail -n1)"
fi
printf 'stt\t%s\t%s\n' "$stt" "$(one_line "$stt_why")"
exit 0
