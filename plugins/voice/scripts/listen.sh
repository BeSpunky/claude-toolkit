#!/usr/bin/env bash
# bespunky-voice — listen.sh
#
# Capture the microphone and transcribe it to text. This is the STT boundary —
# the input mirror of speak.sh: callers (the /voice answer command, the MCP ask
# tool) get back text and never touch an audio device or an STT engine.
#
# Output contract (status/errors always → stderr; failure = non-zero exit):
#   listen.sh            stdout carries ONLY the recognized text (one line).
#   listen.sh --stream   stdout carries line events, each flushed as it happens:
#                          partial: <text>   ~every BESPUNKY_VOICE_PARTIAL_SECONDS while
#                                            recording — the transcript so far, from the
#                                            FASTEST installed model; only when it changed
#                                            and is non-empty
#                          final: <text>     exactly once, at the end, from the BEST
#                                            installed model. Never printed on failure.
#
# It resolves the audio endpoint via audio-endpoint.sh (a reachable PulseAudio-
# protocol server — WSLg, or the host's native PulseAudio/PipeWire), sets the mic
# to that endpoint's gain (boosted only for WSLg, whose mic arrives quiet), and
# records until the speaker has finished (end-of-speech), capped at a hard limit.
#
# Capture: plain `parecord --raw` (16 kHz mono s16le — what whisper wants, so no
# resample step) into a file, killed by us when done. Raw PCM has no header to
# finalize, so the growing file can be snapshotted for partials at any moment and
# a killed recorder still leaves a complete file. Two earlier lessons still hold:
#   - a STREAMING silence-stop (parecord | sox silence) was rejected — with a
#     boosted mic (WSLg, 200%) ambient noise sits above any FIXED threshold, so it
#     never stopped. End-of-speech here is ADAPTIVE instead: the room's own noise
#     floor is measured as a low percentile of per-chunk loudness, and speech is
#     only what stands clearly above it (a ratio AND an absolute minimum).
#   - a timeout-killed sox never finalizes its WAV header (0 bytes) — so no sox
#     ever sits in the capture path; sox only wraps finished raw snapshots.
# Loudness is the DC-removed RMS (standard deviation) of each 100 ms chunk:
# capture devices can start with a large DC offset or rail-pinned samples while
# the source wakes up; "dead" chunks (no variance at all) never count as the floor.
#
# Engine: whisper.cpp from install-whisper.sh (~/.claude/bespunky-voice/whisper).
#
# Env knobs (optional):
#   BESPUNKY_VOICE_MIC_GAIN             default-source volume before recording
#                                       (default: 200% via WSLg, else 100%)
#   BESPUNKY_VOICE_LISTEN_SECONDS       HARD CAP on recording (default 20). It was a
#                                       blind 10 s window when recording never ended
#                                       early; now that end-of-speech stops it, the cap
#                                       only bounds a long answer or a noisy room, so it
#                                       can be generous without making anyone wait.
#   BESPUNKY_VOICE_SILENCE_SECONDS      trailing non-speech that ends recording once
#                                       speech was heard (default 1.3)
#   BESPUNKY_VOICE_NO_SPEECH_SECONDS    give up this long into a take in which no
#                                       speech was heard at all (default 8; 0 = never,
#                                       run to the cap). Not shorter: the user may still
#                                       be thinking.
#   BESPUNKY_VOICE_SPEECH_RATIO         a chunk is speech when its loudness exceeds the
#                                       noise floor × this (default 2.5, ≈ +8 dB) …
#   BESPUNKY_VOICE_SPEECH_MIN_RMS       … and this absolute level, s16 units (default
#                                       200, ≈ -44 dBFS) — so a dead-quiet room's floor
#                                       doesn't make every breath "speech"
#   BESPUNKY_VOICE_MIN_SPEECH_SECONDS   speech needed before end-of-speech can trigger
#                                       (default 0.3 — a click or cough is not an answer)
#   BESPUNKY_VOICE_PARTIAL_SECONDS      --stream partial cadence (default 1)
#   BESPUNKY_VOICE_WHISPER_BIN          whisper-cli path (default: the built one)
#   BESPUNKY_VOICE_WHISPER_MODEL        final ggml model (default: best installed —
#                                       medium.en, small.en, base.en, tiny.en)
#   BESPUNKY_VOICE_WHISPER_PARTIAL_MODEL  partial model (default: fastest installed —
#                                       tiny.en, base.en, else the final model)
set -uo pipefail

VOICE_HOME="${HOME}/.claude/bespunky-voice"
WHDIR="$VOICE_HOME/whisper"
CLI="${BESPUNKY_VOICE_WHISPER_BIN:-$WHDIR/src/build/bin/whisper-cli}"

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

MAXSEC="${BESPUNKY_VOICE_LISTEN_SECONDS:-20}"
SILENCE_SEC="${BESPUNKY_VOICE_SILENCE_SECONDS:-1.3}"
NOSPEECH_SEC="${BESPUNKY_VOICE_NO_SPEECH_SECONDS:-8}"
RATIO="${BESPUNKY_VOICE_SPEECH_RATIO:-2.5}"
MIN_RMS="${BESPUNKY_VOICE_SPEECH_MIN_RMS:-200}"
MIN_SPEECH_SEC="${BESPUNKY_VOICE_MIN_SPEECH_SECONDS:-0.3}"
PARTIAL_SEC="${BESPUNKY_VOICE_PARTIAL_SECONDS:-1}"

# The capture format, stated once: whisper's native input.
RATE=16000
CHUNK_SEC=0.1
CHUNK_BYTES=3200        # 0.1 s × 16000 Hz × 2 bytes (s16le mono)
CALIB_CHUNKS=5          # live chunks needed before the noise floor is trusted
SOX_RAW=(-t raw -r "$RATE" -e signed -b 16 -c 1)

# --- pure helpers (no audio device needed) -----------------------------------

# Per-chunk DC-removed RMS of raw s16le mono on stdin → one value per line.
# Only whole chunks are measured; a trailing partial chunk is ignored.
voice_chunk_rms() {
  od -An -v -td2 -w2 | awk -v n="$((CHUNK_BYTES / 2))" '
    { s += $1; q += $1 * $1; c++
      if (c == n) { m = s / c; v = q / c - m * m; if (v < 0) v = 0
                    printf "%.1f\n", sqrt(v); s = q = c = 0 } }'
}

# End-of-speech decision over the per-chunk loudness log "$1" (one value per
# line, oldest first). Stateless: every call re-reads the whole take, so the
# floor estimate can keep improving. Prints one word: go | speech-ended | no-speech.
voice_vad_decide() {
  awk -v chunk="$CHUNK_SEC" -v ratio="$RATIO" -v minrms="$MIN_RMS" \
      -v calib="$CALIB_CHUNKS" -v silence="$SILENCE_SEC" \
      -v nospeech="$NOSPEECH_SEC" -v minspeech="$MIN_SPEECH_SEC" '
    { v[NR] = $1 + 0; if (v[NR] >= 1) live[++nl] = v[NR] }
    END {
      if (nl < calib) { print "go"; exit }
      # Noise floor = 20th percentile of the live chunks (insertion sort; a take
      # is at most a few hundred chunks).
      for (i = 2; i <= nl; i++) { x = live[i]; for (j = i - 1; j >= 1 && live[j] > x; j--) live[j + 1] = live[j]; live[j + 1] = x }
      floor = live[int((nl - 1) * 0.2) + 1]
      thr = floor * ratio; if (thr < minrms) thr = minrms
      sp = 0; trail = 0
      for (i = 1; i <= NR; i++) { if (v[i] > thr) { sp++; trail = 0 } else trail++ }
      if (sp * chunk >= minspeech - 1e-9) {
        print (trail * chunk >= silence - 1e-9) ? "speech-ended" : "go"
      } else {
        print (nospeech > 0 && NR * chunk >= nospeech - 1e-9) ? "no-speech" : "go"
      }
    }' "$1"
}

# whisper-cli -nt output on stdin → plain text: drop its non-speech annotations —
# [BLANK_AUDIO], [ Silence ], and the sounds it names when it hears noise instead
# of words: (static), (gunshot), *coughs* — and collapse whitespace. Without this
# a noisy room "answers" the question with the name of a sound.
voice_clean_text() {
  sed -E 's/\[[^]]*\]//g; s/\([^)]*\)//g; s/\*[^*]*\*//g' | tr '\n' ' ' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/[[:space:]]+/ /g'
}

# Sourced (a test harness, or another script reusing the helpers) → stop here.
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

STREAM=0
case "${1:-}" in
  --stream) STREAM=1 ;;
  "") ;;
  *) echo "bespunky-voice: usage: listen.sh [--stream]" >&2; exit 2 ;;
esac

# --- preconditions -------------------------------------------------------------

[ -x "$CLI" ]    || { echo "bespunky-voice: STT engine not installed — run install-whisper.sh" >&2; exit 1; }
[ -f "$MODEL" ]  || { echo "bespunky-voice: STT model missing — run install-whisper.sh" >&2; exit 1; }
[ -f "$PMODEL" ] || PMODEL="$MODEL"
command -v parecord >/dev/null 2>&1 || { echo "bespunky-voice: no recorder (parecord)" >&2; exit 1; }
command -v sox      >/dev/null 2>&1 || { echo "bespunky-voice: sox required for capture" >&2; exit 1; }

# Resolve the endpoint (exports PULSE_SERVER, sets VOICE_MIC_GAIN). Sourced from
# this script's own dir, so it works from the plugin and the published copy.
# shellcheck source=audio-endpoint.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/audio-endpoint.sh"
voice_resolve_endpoint || { echo "$VOICE_ENDPOINT_DIAGNOSIS" >&2; exit 1; }

# Unmute the default mic and set the endpoint's gain (the gain choice — and why
# WSLg gets a boost — lives in audio-endpoint.sh, not here).
if command -v pactl >/dev/null 2>&1; then
  pactl set-source-mute   @DEFAULT_SOURCE@ 0                2>/dev/null || true
  pactl set-source-volume @DEFAULT_SOURCE@ "$VOICE_MIC_GAIN" 2>/dev/null || true
fi

# --- lifecycle: nothing outlives us -------------------------------------------
# The caller cancels by SIGTERMing our process group; we may also be signalled
# alone. Either way the EXIT trap stops the recorder and any partial job and
# removes every temp file.
WORK="$(mktemp -d)"
RAW="$WORK/take.raw"; LEVELS="$WORK/levels"; : >"$LEVELS"
REC_PID=""; PART_PID=""
cleanup() {
  local p
  for p in "$REC_PID" "$PART_PID"; do
    [ -n "$p" ] && kill -TERM "$p" 2>/dev/null
  done
  for p in "$REC_PID" "$PART_PID"; do
    [ -n "$p" ] && wait "$p" 2>/dev/null
  done
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

emit() { [ "$STREAM" = 1 ] && printf '%s: %s\n' "$1" "$2"; return 0; }
size_of() { stat -c %s "$1" 2>/dev/null || echo 0; }
# Snapshot the first "$2" bytes of the take as a WAV at "$1".
snapshot_wav() { head -c "$2" "$RAW" | sox "${SOX_RAW[@]}" - -t wav "$1" 2>/dev/null; }

# --- record until end-of-speech (or the cap) -----------------------------------

parecord --raw --format=s16le --rate="$RATE" --channels=1 --latency-msec=50 "$RAW" 2>/dev/null &
REC_PID=$!

CAP_BYTES="$(awk -v s="$MAXSEC" -v r="$RATE" 'BEGIN { printf "%d", s * r * 2 }')"
PART_TICKS="$(awk -v p="$PARTIAL_SEC" -v c="$CHUNK_SEC" 'BEGIN { t = int(p / c + 0.5); print (t < 1 ? 1 : t) }')"
OFF=0; TICK=0; LAST_PARTIAL=""; PART_SIZE=0; WHY="cap"
START=$SECONDS
while :; do
  sleep "$CHUNK_SEC"
  TICK=$((TICK + 1))
  SIZE="$(size_of "$RAW")"

  # Measure every whole chunk that arrived since the last tick.
  N=$(((SIZE - OFF) / CHUNK_BYTES))
  if [ "$N" -gt 0 ]; then
    tail -c +"$((OFF + 1))" "$RAW" | head -c "$((N * CHUNK_BYTES))" | voice_chunk_rms >>"$LEVELS"
    OFF=$((OFF + N * CHUNK_BYTES))
    D="$(voice_vad_decide "$LEVELS")"
    [ "$D" = go ] || { WHY="$D"; break; }
  fi

  [ "$SIZE" -ge "$CAP_BYTES" ] && break
  # The recorder died (device gone) — stop with what we have.
  kill -0 "$REC_PID" 2>/dev/null || { WHY="recorder-exited"; break; }
  # Wall-clock backstop: a recorder that runs but delivers no audio.
  [ $((SECONDS - START)) -gt $((${MAXSEC%.*} + 3)) ] && { WHY="stalled"; break; }

  [ "$STREAM" = 1 ] || continue
  # Partials: harvest a finished job; start the next one on the cadence. One
  # job at a time, in the background, so the end-of-speech check never waits on it.
  if [ -n "$PART_PID" ] && ! kill -0 "$PART_PID" 2>/dev/null; then
    wait "$PART_PID" 2>/dev/null
    PART_PID=""
    T="$(voice_clean_text <"$WORK/partial.txt" 2>/dev/null)"
    if [ -n "$T" ] && [ "$T" != "$LAST_PARTIAL" ]; then emit partial "$T"; LAST_PARTIAL="$T"; fi
  fi
  if [ -z "$PART_PID" ] && [ $((TICK % PART_TICKS)) -eq 0 ] && [ "$OFF" -gt "$PART_SIZE" ]; then
    PART_SIZE="$OFF"
    if snapshot_wav "$WORK/partial.wav" "$PART_SIZE"; then
      "$CLI" -m "$PMODEL" -f "$WORK/partial.wav" -nt -np -nf -bs 1 -bo 1 >"$WORK/partial.txt" 2>/dev/null &
      PART_PID=$!
    fi
  fi
done

# Stop the recorder and any in-flight partial — the final pass wants the CPU.
for p in "$REC_PID" "$PART_PID"; do [ -n "$p" ] && kill -TERM "$p" 2>/dev/null; done
for p in "$REC_PID" "$PART_PID"; do [ -n "$p" ] && wait "$p" 2>/dev/null; done
REC_PID=""; PART_PID=""
echo "bespunky-voice: recording ended ($WHY)" >&2

# --- final transcription -----------------------------------------------------

SIZE="$(size_of "$RAW")"; SIZE=$((SIZE - SIZE % 2))
[ "$SIZE" -gt 0 ] || { echo "bespunky-voice: nothing recorded (is the mic reachable?)" >&2; exit 1; }
snapshot_wav "$WORK/take.wav" "$SIZE" && [ -s "$WORK/take.wav" ] \
  || { echo "bespunky-voice: audio conversion failed" >&2; exit 1; }

TEXT="$("$CLI" -m "$MODEL" -f "$WORK/take.wav" -nt 2>/dev/null | voice_clean_text)"
[ -n "$TEXT" ] || { echo "bespunky-voice: no speech recognized" >&2; exit 1; }
if [ "$STREAM" = 1 ]; then emit final "$TEXT"; else printf '%s\n' "$TEXT"; fi
