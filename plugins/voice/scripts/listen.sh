#!/usr/bin/env bash
# bespunky-voice — listen.sh
#
# Capture the microphone and transcribe it to text. This is the STT boundary —
# the input mirror of speak.sh: callers (the /voice answer command, later the MCP
# ask tool) get back plain text and never touch an audio device or an STT engine.
# On success it prints ONLY the recognized text on stdout; status/errors → stderr.
#
# It absorbs WSLg's weak microphone gain itself (boosts the default source before
# recording), and records with natural push-to-talk: it waits for you to start,
# then stops ~1.6s after you stop talking, capped by a max window. So a caller just
# runs it and gets the sentence.
#
# Engine: whisper.cpp from install-whisper.sh (~/.claude/bespunky-voice/whisper).
#
# Env knobs (optional):
#   BESPUNKY_VOICE_MIC_GAIN         default-source volume before recording (default 200%)
#   BESPUNKY_VOICE_LISTEN_SECONDS   length of the listen window (default 10)
#   BESPUNKY_VOICE_WHISPER_BIN      whisper-cli path (default: the built one)
#   BESPUNKY_VOICE_WHISPER_MODEL    ggml model path (default: base.en)
set -uo pipefail

VOICE_HOME="${HOME}/.claude/bespunky-voice"
WHDIR="$VOICE_HOME/whisper"
CLI="${BESPUNKY_VOICE_WHISPER_BIN:-$WHDIR/src/build/bin/whisper-cli}"
# Model: explicit override, else the best-accuracy one installed (bigger = better).
MODEL="${BESPUNKY_VOICE_WHISPER_MODEL:-}"
if [ -z "$MODEL" ]; then
  for m in medium.en small.en base.en tiny.en; do
    [ -f "$WHDIR/models/ggml-$m.bin" ] && { MODEL="$WHDIR/models/ggml-$m.bin"; break; }
  done
  [ -n "$MODEL" ] || MODEL="$WHDIR/models/ggml-base.en.bin"
fi
GAIN="${BESPUNKY_VOICE_MIC_GAIN:-200%}"
MAXSEC="${BESPUNKY_VOICE_LISTEN_SECONDS:-10}"

[ -x "$CLI" ]   || { echo "bespunky-voice: STT engine not installed — run install-whisper.sh" >&2; exit 1; }
[ -f "$MODEL" ] || { echo "bespunky-voice: STT model missing — run install-whisper.sh" >&2; exit 1; }
command -v parecord >/dev/null 2>&1 || { echo "bespunky-voice: no recorder (parecord)" >&2; exit 1; }
command -v sox      >/dev/null 2>&1 || { echo "bespunky-voice: sox required for capture" >&2; exit 1; }

# Boost + unmute the default mic. WSLg's RDPSource arrives near-silent at unity
# gain; this is the one place that knows to compensate.
if command -v pactl >/dev/null 2>&1; then
  pactl set-source-mute   @DEFAULT_SOURCE@ 0      2>/dev/null || true
  pactl set-source-volume @DEFAULT_SOURCE@ "$GAIN" 2>/dev/null || true
fi

W16="$(mktemp)"
RAW="$(mktemp)"
trap 'rm -f "$W16" "$RAW"' EXIT

# Record a fixed window, then resample to 16 kHz for whisper. A streaming
# silence-stop (parecord | sox) is deliberately NOT used: under WSLg the mic gain
# is hot enough that ambient noise sits above any silence threshold, so it never
# self-terminates — and a timeout-killed sox never finalizes its WAV header (0
# bytes). A plain capture always produces a clean file; whisper handles the
# leading/trailing silence and room noise fine.
timeout "$MAXSEC" parecord --channels=1 --file-format=wav "$RAW" 2>/dev/null || true
[ -s "$RAW" ] || { echo "bespunky-voice: nothing recorded (is the mic reachable?)" >&2; exit 1; }
# -t wav on the OUTPUT: the temp files have no extension, so sox can't otherwise
# infer the output type. Input type is auto-detected from the WAV content.
sox "$RAW" -t wav -r 16000 -c 1 -b 16 "$W16" 2>/dev/null || { echo "bespunky-voice: resample failed" >&2; exit 1; }
[ -s "$W16" ] || { echo "bespunky-voice: resample produced no audio" >&2; exit 1; }

# Transcribe → plain text. Drop whisper's bracketed annotations ([BLANK_AUDIO],
# [ Silence ]) and collapse whitespace.
TEXT="$("$CLI" -m "$MODEL" -f "$W16" -nt 2>/dev/null \
  | sed -E 's/\[[^]]*\]//g' \
  | tr '\n' ' ' \
  | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/[[:space:]]+/ /g')"

[ -n "$TEXT" ] || { echo "bespunky-voice: no speech recognized" >&2; exit 1; }
printf '%s\n' "$TEXT"
