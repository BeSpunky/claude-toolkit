#!/usr/bin/env bash
# bespunky-voice — stt-engine.sh : resolve speech recognition, and know whether it WORKS.
#
# The input mirror of tts-engine.sh: the one place the plugin knows where
# whisper.cpp lives (install-whisper.sh builds it under ~/.claude/bespunky-voice/
# whisper), which models to use, and how to tell a working install from a merely
# PRESENT one. listen.sh sources it before it touches a device; voice-health.sh
# (the voice band, /speak status) sources it to report the same verdict — so
# "can this machine listen?" has exactly one answer.
#
# Why "present" is not enough: like Piper, whisper.cpp ships binaries behind
# shared libraries reached through soname links, so an executable whisper-cli can
# still die in the dynamic linker. Health RUNS the binaries (`--help` loads every
# linked library and costs milliseconds), never judges them by their files.
#
# Contract (sourcing defines these; nothing runs, nothing prints):
#   VOICE_HOME, WHDIR       where the runtime and whisper.cpp live
#   CLI                     whisper-cli
#   MODEL                   final model — the best-accuracy one installed
#   PMODEL                  partial (live transcript) model — the fastest installed,
#                           else MODEL
#   VAD_BIN, VAD_MODEL      Silero speech detector (whisper-vad-speech-segments)
#   voice_stt_verdict     → VOICE_STT_HEALTH ok|broken|missing and VOICE_STT_PROBLEM
#                           (one line saying why; empty when ok). Covers everything
#                           listen.sh needs from whisper.cpp: recogniser, model and
#                           speech detector. Always returns 0: absence is a fact.
#
# Env overrides (all optional):
#   BESPUNKY_VOICE_WHISPER_BIN            whisper-cli path (default: the built one)
#   BESPUNKY_VOICE_WHISPER_MODEL          final ggml model (default: best installed —
#                                         medium.en, small.en, base.en, tiny.en)
#   BESPUNKY_VOICE_WHISPER_PARTIAL_MODEL  partial model (default: fastest installed —
#                                         tiny.en, base.en, else the final model)
#   BESPUNKY_VOICE_VAD_BIN                speech-detector path (default: the built
#                                         whisper-vad-speech-segments)
#   BESPUNKY_VOICE_VAD_MODEL              Silero ggml model (default: newest installed)

VOICE_HOME="${HOME}/.claude/bespunky-voice"
WHDIR="$VOICE_HOME/whisper"
CLI="${BESPUNKY_VOICE_WHISPER_BIN:-$WHDIR/src/build/bin/whisper-cli}"
VAD_BIN="${BESPUNKY_VOICE_VAD_BIN:-$WHDIR/src/build/bin/whisper-vad-speech-segments}"

# First installed model of the given names (bigger = better, smaller = faster).
_first_model() {
  local m
  for m in "$@"; do
    [ -f "$WHDIR/models/ggml-$m.bin" ] && { echo "$WHDIR/models/ggml-$m.bin"; return 0; }
  done
  return 1
}
# Final model: explicit override, else the best-accuracy one installed.
MODEL="${BESPUNKY_VOICE_WHISPER_MODEL:-}"
[ -n "$MODEL" ] || MODEL="$(_first_model medium.en small.en base.en tiny.en)" || MODEL="$WHDIR/models/ggml-base.en.bin"
# Partial model: explicit override, else the fastest installed, else the final one.
PMODEL="${BESPUNKY_VOICE_WHISPER_PARTIAL_MODEL:-}"
[ -n "$PMODEL" ] || PMODEL="$(_first_model tiny.en base.en)" || PMODEL="$MODEL"
[ -f "$PMODEL" ] || PMODEL="$MODEL"
# Speech detector model: explicit override, else the newest Silero installed.
VAD_MODEL="${BESPUNKY_VOICE_VAD_MODEL:-}"
[ -n "$VAD_MODEL" ] || VAD_MODEL="$(_first_model silero-v6.2.0 silero-v5.1.2)" || VAD_MODEL="$WHDIR/models/ggml-silero-v6.2.0.bin"

# The last non-blank line a failing binary printed: the dynamic linker's error, usually.
_stt_last_error() { printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | tail -n1; }

voice_stt_verdict() {
  local err
  VOICE_STT_HEALTH=ok VOICE_STT_PROBLEM=""
  if [ ! -x "$CLI" ]; then
    VOICE_STT_HEALTH=missing VOICE_STT_PROBLEM="whisper-cli is not installed"
  elif [ ! -f "$MODEL" ]; then
    VOICE_STT_HEALTH=missing VOICE_STT_PROBLEM="no whisper model in $WHDIR/models"
  elif [ ! -x "$VAD_BIN" ] || [ ! -f "$VAD_MODEL" ]; then
    VOICE_STT_HEALTH=missing VOICE_STT_PROBLEM="the speech detector (Silero) is not installed"
  elif ! err="$("$CLI" --help 2>&1 >/dev/null)"; then
    VOICE_STT_HEALTH=broken VOICE_STT_PROBLEM="whisper-cli failed: $(_stt_last_error "$err")"
  elif ! err="$("$VAD_BIN" --help 2>&1 >/dev/null)"; then
    VOICE_STT_HEALTH=broken VOICE_STT_PROBLEM="the speech detector failed: $(_stt_last_error "$err")"
  fi
  return 0
}
