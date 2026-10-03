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
#   STT  stt-engine.sh's voice_stt_verdict — the same check listen.sh makes before
#        it records (whisper-cli, its model and the Silero detector, each RUN).
#
# Output — two tab-separated lines, always both, exit 0 (absence is a fact):
#   tts<TAB>natural|broken|robotic|system|none<TAB>why (empty when natural)
#   stt<TAB>ok|broken|missing<TAB>why (empty when ok)
#
# Cost: one short piper synthesis (~0.3 s). Callers that poll cache it.
#
# Sourced, it defines voice_tts_verdict and voice_stt_verdict (→ VOICE_STT_HEALTH
# ok|broken|missing, VOICE_STT_PROBLEM) — what /speak status reports — and prints nothing.
set -uo pipefail

_VOICE_HEALTH_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=tts-engine.sh
. "$_VOICE_HEALTH_HERE/tts-engine.sh"

# shellcheck source=stt-engine.sh
. "$_VOICE_HEALTH_HERE/stt-engine.sh"

[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

one_line() { printf '%s' "$1" | tr '\t\n' '  '; }

voice_tts_verdict
tts_why=""
[ "$VOICE_TTS_HEALTH" = natural ] || tts_why="$VOICE_PIPER_PROBLEM"
printf 'tts\t%s\t%s\n' "$VOICE_TTS_HEALTH" "$(one_line "$tts_why")"

voice_stt_verdict
printf 'stt\t%s\t%s\n' "$VOICE_STT_HEALTH" "$(one_line "$VOICE_STT_PROBLEM")"
exit 0
