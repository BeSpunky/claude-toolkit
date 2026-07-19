#!/usr/bin/env bash
# bespunky-voice — speak.sh
#
# Turn text into speech and play it to the user's default audio sink. This is the
# ONE place the plugin touches an audio engine — the swappable boundary. Callers
# (the /voice command, the auto-speak hook) hand it ready-to-read text; how that
# text becomes sound is entirely this script's concern, so the engine can change
# without touching a single caller.
#
# Text arrives as arguments ("$*") or, if none, on stdin. On SUCCESS it prints
# NOTHING; all errors go to stderr only.
#
# Engine selection (first that applies):
#   1. Piper (natural, local, offline) — auto-detected from the conventional
#      install scripts/install-piper.sh produces (~/.claude/bespunky-voice/piper +
#      voices/default.onnx), or from the env overrides below.
#   2. espeak-ng — the free Linux floor: robotic but clear, no model, no network.
#   3. macOS `say` — the zero-install floor on a Mac (built in; synth + play in one).
#
# Playback (for engines 1–2 that produce a WAV): paplay (PulseAudio) → aplay
# (ALSA) → afplay (macOS). Audio reaches the host via whatever PULSE_SERVER the
# environment already sets (WSLg here) — deliberately NOT hardcoded, for portability.
#
# Runtime deps: one of {piper+voice, espeak-ng, say} for synthesis, and (for the
# first two) one of {paplay, aplay, afplay} for playback. Missing everything ⇒
# a clear stderr diagnosis and exit 1 (never a silent no-op).
#
# Env knobs (all optional — the convention above usually means you set none):
#   BESPUNKY_VOICE_RATE          espeak-ng words-per-minute (default 160)
#   BESPUNKY_VOICE_PIPER_MODEL   path to a Piper .onnx voice → forces Piper
#   BESPUNKY_VOICE_PIPER_BIN     piper binary name/path (default: auto-detect)
set -uo pipefail

# --- 1. gather the text to speak ---------------------------------------------
if [ "$#" -gt 0 ]; then
  TEXT="$*"
else
  TEXT="$(cat)"
fi
[ -n "${TEXT//[[:space:]]/}" ] || exit 0   # nothing but whitespace → say nothing

# --- 2. make it LISTENABLE: strip markup so the ear hears words, not symbols --
# Collapse newlines/tabs to spaces FIRST (sed is line-based, so a fenced code
# block spanning lines would otherwise survive), then strip. The sed program is
# kept comment-free and one rule per -e, because BSD/macOS sed only accepts `#`
# comments at the start of a line, not inline.
CLEAN="$(printf '%s' "$TEXT" | tr '\n\t' '  ' | sed -E \
  -e 's/```[^`]*```/ /g' \
  -e 's/`([^`]*)`/\1/g' \
  -e 's/!?\[([^]]*)\]\([^)]*\)/\1/g' \
  -e 's/~~//g' \
  -e 's/[*_#>|`]+/ /g' \
  -e 's/[[:space:]]+/ /g' \
  -e 's/^ +//' \
  -e 's/ +$//')"
[ -n "$CLEAN" ] || exit 0

# --- 3. resolve the synthesis engine -----------------------------------------
VOICE_HOME="${HOME}/.claude/bespunky-voice"

PIPER_BIN="${BESPUNKY_VOICE_PIPER_BIN:-}"
[ -z "$PIPER_BIN" ] && command -v piper >/dev/null 2>&1 && PIPER_BIN="$(command -v piper)"
[ -z "$PIPER_BIN" ] && [ -x "$VOICE_HOME/piper/piper" ] && PIPER_BIN="$VOICE_HOME/piper/piper"

PIPER_MODEL="${BESPUNKY_VOICE_PIPER_MODEL:-}"
if [ -z "$PIPER_MODEL" ]; then
  if [ -e "$VOICE_HOME/voices/default.onnx" ]; then
    PIPER_MODEL="$VOICE_HOME/voices/default.onnx"
  else
    PIPER_MODEL="$(ls "$VOICE_HOME"/voices/*.onnx 2>/dev/null | head -n1)"
  fi
fi

play() {  # play a WAV file (arg 1) to the default sink
  if   command -v paplay >/dev/null 2>&1; then paplay "$1" 2>/dev/null
  elif command -v aplay  >/dev/null 2>&1; then aplay -q "$1" 2>/dev/null
  elif command -v afplay >/dev/null 2>&1; then afplay "$1" 2>/dev/null
  else echo "bespunky-voice: no audio player (need paplay, aplay, or afplay)" >&2; return 1
  fi
}

# macOS `say` synthesizes AND plays in one step, with no temp file or player —
# handle it before allocating a WAV. Text via stdin (no argv → no option-injection).
if [ -z "$PIPER_MODEL" ] && ! command -v espeak-ng >/dev/null 2>&1 && command -v say >/dev/null 2>&1; then
  printf '%s' "$CLEAN" | say 2>/dev/null && exit 0
  echo "bespunky-voice: macOS 'say' failed" >&2; exit 1
fi

# --- 4. synthesize to a temp WAV, then play ----------------------------------
# Portable temp file: no GNU-only --suffix; piper/espeak write WAV regardless of
# the filename, and paplay/aplay/afplay detect the format from content.
TMP="$(mktemp "${TMPDIR:-/tmp}/bespunky-voice-XXXXXX")" || { echo "bespunky-voice: mktemp failed" >&2; exit 1; }
trap 'rm -f "$TMP"' EXIT

synth_ok=0
if [ -n "$PIPER_BIN" ] && [ -n "$PIPER_MODEL" ] && [ -f "$PIPER_MODEL" ]; then
  PIPER_LIBS="$(dirname "$PIPER_BIN")"   # piper finds its bundled libs alongside itself
  if printf '%s' "$CLEAN" \
     | LD_LIBRARY_PATH="$PIPER_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
       "$PIPER_BIN" --model "$PIPER_MODEL" --output_file "$TMP" 2>/dev/null; then
    synth_ok=1
  fi
fi
if [ "$synth_ok" = 0 ] && command -v espeak-ng >/dev/null 2>&1; then
  # Text via --stdin (no argv) so a leading '-' can never be read as an option.
  if printf '%s' "$CLEAN" | espeak-ng -s "${BESPUNKY_VOICE_RATE:-160}" --stdin -w "$TMP" 2>/dev/null; then
    synth_ok=1
  fi
fi
if [ "$synth_ok" = 0 ] && command -v say >/dev/null 2>&1; then
  printf '%s' "$CLEAN" | say 2>/dev/null && exit 0
fi
if [ "$synth_ok" = 0 ]; then
  echo "bespunky-voice: no working TTS engine. Install espeak-ng (Linux), use macOS 'say', or run install-piper.sh." >&2
  exit 1
fi

play "$TMP" || { echo "bespunky-voice: playback failed — is a sink reachable (PULSE_SERVER)?" >&2; exit 1; }
