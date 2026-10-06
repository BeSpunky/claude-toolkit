#!/usr/bin/env bash
# bespunky-voice — listen.sh
#
# Capture the microphone and transcribe it to text. This is the STT boundary —
# the input mirror of speak.sh: callers (the /speak answer command, the MCP ask
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
# finalize, so the growing file can be snapshotted at any moment and a killed
# recorder still leaves a complete file. (A timeout-killed sox never finalizes its
# WAV header — so no sox ever sits in the capture path; sox only wraps finished
# raw snapshots.)
#
# End-of-speech: a SPEECH DETECTOR decides, the recogniser only transcribes.
#   Whisper cannot be the judge of whether anyone spoke: trained on subtitled
#   video, it fills non-speech with words — real room noise comes back as "you",
#   "Next time.", "Thank you for watching" — so any rule that asks it "did you hear
#   words?" ends a take on a cough or keeps one alive in an empty room, and any
#   partial it is shown of a silent stretch displays a phantom transcript. Loudness
#   can't be the judge either: a boosted mic puts ambient noise above any fixed
#   threshold, a cough and a bare "yes" carry the same energy, and a loud room
#   drowns the floor an adaptive rule measures (the hand-tuned energy VAD this
#   replaced needed the recogniser as a tie-breaker for exactly those cases).
#   So the arbiter is Silero VAD (whisper.cpp's whisper-vad-speech-segments, from
#   install-whisper.sh), a model trained to tell speech from everything else:
#     - every VAD_EVERY of the tick clock, the take so far is run through it →
#       its speech segments (voice_vad_segments, voice_speech_decide below);
#     - heard  = at least one speech segment;
#     - ended  = heard, and the last segment ended ≥ SILENCE_SECONDS before the
#                take's end;
#     - no-speech = NO_SPEECH_SECONDS into the take with no segment at all.
#   And the recogniser only ever SEES speech: partials and the final pass run
#   whisper-cli with --vad (the same detector, the same model), so silence and
#   noise before, after and between words are cut out before it transcribes, and
#   no partial is attempted until the detector has heard a segment.
#   A missing detector fails like a missing STT model — never a silent fallback to
#   guessing by loudness.
#
# Engine: whisper.cpp from install-whisper.sh (~/.claude/bespunky-voice/whisper).
#
# Env knobs (optional):
#   BESPUNKY_VOICE_MIC_GAIN             default-source volume before recording
#                                       (default: 200% via WSLg, else 100%)
#   BESPUNKY_VOICE_LISTEN_SECONDS       HARD CAP on recording (default 20). It only
#                                       bounds a long answer or a talkative room —
#                                       end-of-speech stops a normal take — so it can be
#                                       generous without making anyone wait.
#   BESPUNKY_VOICE_SILENCE_SECONDS      trailing non-speech that ends recording once
#                                       speech was heard (default 1.3)
#   BESPUNKY_VOICE_NO_SPEECH_SECONDS    give up this long into a take in which the
#                                       detector found no speech at all (default 8;
#                                       0 = never, run to the cap). Not shorter: the user
#                                       may still be thinking. Judged on the take's
#                                       length, so a muted or dead mic gives up as early.
#   BESPUNKY_VOICE_PARTIAL_SECONDS      --stream partial cadence (default 1)
#   BESPUNKY_VOICE_WHISPER_BIN, _WHISPER_MODEL, _WHISPER_PARTIAL_MODEL, _VAD_BIN,
#   _VAD_MODEL                          which engine and models — see stt-engine.sh
set -uo pipefail

# The engine — whisper-cli, its models, the Silero detector — and whether it works:
# one module, shared with voice-health.sh, so listening and the band never disagree.
# shellcheck source=stt-engine.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stt-engine.sh"

MAXSEC="${BESPUNKY_VOICE_LISTEN_SECONDS:-20}"
SILENCE_SEC="${BESPUNKY_VOICE_SILENCE_SECONDS:-1.3}"
NOSPEECH_SEC="${BESPUNKY_VOICE_NO_SPEECH_SECONDS:-8}"
PARTIAL_SEC="${BESPUNKY_VOICE_PARTIAL_SECONDS:-1}"

# The capture format, stated once: whisper's native input.
RATE=16000
BYTES_PER_SEC=$((RATE * 2))   # s16le mono
TICK_SEC=0.1
# The detector runs every VAD_EVERY ticks (0.3 s): a pass over the take costs
# ~5 ms per second of audio on one thread (~110 ms at the 20 s cap), so this keeps
# it well under a core while adding at most 0.3 s to the end-of-speech latency.
VAD_EVERY=3
SOX_RAW=(-t raw -r "$RATE" -e signed -b 16 -c 1)
# The detector, stated once. One thread is FASTER than several for a take this
# short (thread start-up outweighs the work). Its defaults (threshold 0.5, 250 ms
# minimum speech, 100 ms minimum silence) are whisper-cli --vad's too, so "heard"
# means the same thing to the end-of-speech rule and to the recogniser.
VAD_CMD=(-t 1 -np -vm "$VAD_MODEL")
# What the recogniser sees: only the detected speech, padded 0.2 s each side so
# the edges of the first and last word are never clipped.
RECOGNISE_SPEECH=(--vad -vm "$VAD_MODEL" -vp 200)

# --- pure helpers (no audio device needed) -----------------------------------

# whisper-vad-speech-segments output on stdin → one "start end" line per speech
# segment, in seconds (it prints centiseconds: "Speech segment 0: start = 96.00,
# end = 137.00"). Fails when the output carries no "Detected N speech segments"
# line — the detector did not run — so a broken detector never reads as silence.
voice_vad_segments() {
  awk '/^Detected [0-9]+ speech segments/ { ok = 1 }
       /^Speech segment [0-9]+:/ { gsub(",", ""); s = e = ""
         for (i = 1; i < NF; i++) { if ($i == "start") s = $(i + 2); if ($i == "end") e = $(i + 2) }
         printf "%.2f %.2f\n", s / 100, e / 100 }
       END { exit !ok }'
}

# End-of-speech decision over the segment list "$1" (voice_vad_segments output)
# for a take "$2" seconds long. Stateless: every pass re-reads the whole take.
# Prints one word: go | speech-ended | no-speech.
voice_speech_decide() {
  awk -v take="$2" -v silence="$SILENCE_SEC" -v nospeech="$NOSPEECH_SEC" '
    NF >= 2 { n++; last = $2 + 0 }
    END {
      if (n) print (take - last >= silence - 1e-9 ? "speech-ended" : "go")
      else   print (nospeech > 0 && take >= nospeech - 1e-9 ? "no-speech" : "go")
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

# The audio endpoint FIRST (exports PULSE_SERVER, sets VOICE_MIC_GAIN): it is the
# one precondition no install can satisfy, so a missing engine must never be
# reported in its place. Sourced from this script's own dir, so it works from the
# plugin and the published copy.
# shellcheck source=audio-endpoint.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/audio-endpoint.sh"
voice_resolve_endpoint || { echo "$VOICE_ENDPOINT_DIAGNOSIS" >&2; exit 1; }

voice_stt_verdict
[ "$VOICE_STT_HEALTH" = ok ] \
  || { echo "bespunky-voice: speech recognition $VOICE_STT_HEALTH: $VOICE_STT_PROBLEM — install it: bash ~/.claude/bespunky-voice/install.sh listen" >&2; exit 1; }
command -v parecord >/dev/null 2>&1 || { echo "bespunky-voice: no recorder (parecord) — install it: bash ~/.claude/bespunky-voice/install.sh listen" >&2; exit 1; }
command -v sox      >/dev/null 2>&1 || { echo "bespunky-voice: sox required for capture — install it: bash ~/.claude/bespunky-voice/install.sh listen" >&2; exit 1; }

# Unmute the default mic and set the endpoint's gain (the gain choice — and why
# WSLg gets a boost — lives in audio-endpoint.sh, not here).
if command -v pactl >/dev/null 2>&1; then
  pactl set-source-mute   @DEFAULT_SOURCE@ 0                2>/dev/null || true
  pactl set-source-volume @DEFAULT_SOURCE@ "$VOICE_MIC_GAIN" 2>/dev/null || true
fi

# --- lifecycle: nothing outlives us -------------------------------------------
# The caller cancels by SIGTERMing our process group; we may also be signalled
# alone. Either way the EXIT trap stops the recorder, any detector pass and any
# partial job, and removes every temp file.
#
# The open recording is ANNOUNCED — read by the voice band, stopped by voice.sh:
#   .listening.pid  this script's pid, exactly while it records
#   .hearing        the transcript heard so far (every partial, in both modes —
#                   the live transcript is a property of listening, not of the
#                   caller's output format)
# Both are removed on exit, only if still ours.
WORK="$(mktemp -d)"
RAW="$WORK/take.raw"
REC_PID=""; VAD_PID=""; PART_PID=""; TICK_PID=""
LISTENING="$VOICE_HOME/.listening.pid"; HEARING="$VOICE_HOME/.hearing"
mkdir -p "$VOICE_HOME" 2>/dev/null
echo "$$" >"$LISTENING" 2>/dev/null; : >"$HEARING" 2>/dev/null
cleanup() {
  local p
  # A second stop arriving mid-cleanup must not re-enter it.
  trap '' TERM INT HUP
  if [ "$(cat "$LISTENING" 2>/dev/null)" = "$$" ]; then rm -f "$LISTENING" "$HEARING"; fi
  for p in "$REC_PID" "$VAD_PID" "$PART_PID" "$TICK_PID"; do
    [ -n "$p" ] && kill -TERM "$p" 2>/dev/null
  done
  for p in "$REC_PID" "$VAD_PID" "$PART_PID" "$TICK_PID"; do
    [ -n "$p" ] && wait "$p" 2>/dev/null
  done
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# The tick clock: a BACKGROUND sleep we `wait` on. `wait` is the one blocking
# builtin bash interrupts cleanly for a trapped signal, so a stop runs the trap
# at once. Two rejected clocks, for the record: a foreground `sleep` (a TERM to
# our process group kills it and bash prints "Terminated"), and a builtin
# `read -t` on a FIFO (a TERM landing inside it crashed or hung bash in cleanup
# ~1 run in 14, leaving the recorder running and the announcement up).
tick() { sleep "$TICK_SEC" & TICK_PID=$!; wait "$TICK_PID" 2>/dev/null; TICK_PID=""; }

# A transcript event: always to .hearing (the band), and to stdout in --stream.
emit() {
  [ "$(cat "$LISTENING" 2>/dev/null)" = "$$" ] && printf '%s' "$2" >"$HEARING.$$" 2>/dev/null && mv -f "$HEARING.$$" "$HEARING" 2>/dev/null
  [ "$STREAM" = 1 ] && printf '%s: %s\n' "$1" "$2"
  return 0
}
size_of() { stat -c %s "$1" 2>/dev/null || echo 0; }
# Snapshot the first "$2" bytes of the take as a WAV at "$1".
snapshot_wav() { head -c "$2" "$RAW" | sox "${SOX_RAW[@]}" - -t wav "$1" 2>/dev/null; }

# --- record until end-of-speech (or the cap) -----------------------------------

parecord --raw --format=s16le --rate="$RATE" --channels=1 --latency-msec=50 "$RAW" 2>/dev/null &
REC_PID=$!

CAP_BYTES="$(awk -v s="$MAXSEC" -v r="$BYTES_PER_SEC" 'BEGIN { printf "%d", s * r }')"
PART_TICKS="$(awk -v p="$PARTIAL_SEC" -v c="$TICK_SEC" 'BEGIN { t = int(p / c + 0.5); print (t < 1 ? 1 : t) }')"
FAST=(-m "$PMODEL" -nt -np -nf -bs 1 -bo 1 "${RECOGNISE_SPEECH[@]}")
OFF=0; TICK=0; VAD_SIZE=0; HEARD=0; LAST_PARTIAL=""; PART_SIZE=0; WHY="cap"

# One detector pass over the first "$1" bytes of the take → its decision in
# $DECISION, and HEARD=1 once any speech segment exists. The detector
# runs as a tracked job (not inside a command substitution), so a signal
# interrupts the wait and the EXIT trap reaps it. Non-zero = the detector failed.
detect() {
  local rc
  snapshot_wav "$WORK/vad.wav" "$1" || return 1
  "$VAD_BIN" "${VAD_CMD[@]}" -f "$WORK/vad.wav" >"$WORK/vad.out" 2>/dev/null &
  VAD_PID=$!; wait "$VAD_PID" 2>/dev/null; rc=$?; VAD_PID=""
  [ "$rc" = 0 ] && voice_vad_segments <"$WORK/vad.out" >"$WORK/segments" || return 1
  [ -s "$WORK/segments" ] && HEARD=1
  DECISION="$(voice_speech_decide "$WORK/segments" "$(awk -v b="$1" -v r="$BYTES_PER_SEC" 'BEGIN { printf "%.2f", b / r }')")"
}
START=$SECONDS
while :; do
  tick
  TICK=$((TICK + 1))
  SIZE="$(size_of "$RAW")"
  OFF=$((SIZE - SIZE % 2))   # whole samples only

  if [ $((TICK % VAD_EVERY)) -eq 0 ] && [ "$OFF" -gt "$VAD_SIZE" ]; then
    VAD_SIZE="$OFF"
    detect "$VAD_SIZE" || { echo "bespunky-voice: speech detector failed — repair: bash ~/.claude/bespunky-voice/install.sh listen" >&2; exit 1; }
    case "$DECISION" in
      go) ;;
      *) WHY="$DECISION"; break ;;
    esac
  fi

  [ "$SIZE" -ge "$CAP_BYTES" ] && break
  # The recorder died (device gone) — stop with what we have.
  kill -0 "$REC_PID" 2>/dev/null || { WHY="recorder-exited"; break; }
  # Wall-clock backstop: a recorder that runs but delivers no audio.
  [ $((SECONDS - START)) -gt $((${MAXSEC%.*} + 3)) ] && { WHY="stalled"; break; }

  # Partials (both modes — see .hearing above), only once the detector has heard
  # speech: harvest a finished job; start the next one on the cadence. One job at
  # a time, in the background, so the end-of-speech check never waits on it.
  if [ -n "$PART_PID" ] && ! kill -0 "$PART_PID" 2>/dev/null; then
    wait "$PART_PID" 2>/dev/null
    PART_PID=""
    T="$(voice_clean_text <"$WORK/partial.txt" 2>/dev/null)"
    if [ -n "$T" ] && [ "$T" != "$LAST_PARTIAL" ]; then emit partial "$T"; LAST_PARTIAL="$T"; fi
  fi
  if [ "$HEARD" = 1 ] && [ -z "$PART_PID" ] && [ $((TICK % PART_TICKS)) -eq 0 ] && [ "$OFF" -gt "$PART_SIZE" ]; then
    PART_SIZE="$OFF"
    if snapshot_wav "$WORK/partial.wav" "$PART_SIZE"; then
      "$CLI" "${FAST[@]}" -f "$WORK/partial.wav" >"$WORK/partial.txt" 2>/dev/null &
      PART_PID=$!
    fi
  fi
done

# Stop the recorder and any in-flight partial — the final pass wants the CPU.
for p in "$REC_PID" "$PART_PID"; do [ -n "$p" ] && kill -TERM "$p" 2>/dev/null; done
for p in "$REC_PID" "$PART_PID"; do [ -n "$p" ] && wait "$p" 2>/dev/null; done
REC_PID=""; PART_PID=""
echo "bespunky-voice: recording ended ($WHY)" >&2
# The detector just judged the whole take and found no one speaking: there is
# nothing to transcribe, and nothing the recogniser could add but a hallucination.
[ "$WHY" = no-speech ] && { echo "bespunky-voice: no speech recognized" >&2; exit 1; }

# --- final transcription -----------------------------------------------------

SIZE="$(size_of "$RAW")"; SIZE=$((SIZE - SIZE % 2))
[ "$SIZE" -gt 0 ] || { echo "bespunky-voice: nothing recorded (is the mic reachable?)" >&2; exit 1; }
snapshot_wav "$WORK/take.wav" "$SIZE" && [ -s "$WORK/take.wav" ] \
  || { echo "bespunky-voice: audio conversion failed" >&2; exit 1; }

TEXT="$("$CLI" -m "$MODEL" "${RECOGNISE_SPEECH[@]}" -f "$WORK/take.wav" -nt 2>/dev/null | voice_clean_text)"
[ -n "$TEXT" ] || { echo "bespunky-voice: no speech recognized" >&2; exit 1; }
if [ "$STREAM" = 1 ]; then emit final "$TEXT"; else printf '%s\n' "$TEXT"; fi
