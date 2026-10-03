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
#     floor is measured as its quietest stretch so far (which speech cannot
#     inflate), speech is only what stands clearly above it (a ratio AND an
#     absolute minimum) for a sustained run, and it ends on hysteresis — once
#     speech has started, only a return to near the floor counts as silence.
#     The details live with voice_vad_decide below.
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
#                                       be thinking. Judged on elapsed time alone, so a
#                                       muted or dead mic gives up just as early.
#                                       Before giving up, the fast recogniser checks the
#                                       take: if it hears WORDS, the user is talking under
#                                       a loud room's noise, and the take switches to
#                                       ending BY WORDS — re-transcribed every
#                                       PARTIAL_SECONDS, over once the transcript stops
#                                       growing for SILENCE_SECONDS' worth of checks
#                                       (still bounded by the cap).
#   BESPUNKY_VOICE_SPEECH_RATIO         a chunk is speech when its loudness exceeds the
#                                       noise floor × this (default 2.5, ≈ +8 dB) …
#   BESPUNKY_VOICE_SPEECH_MIN_RMS       … and this absolute level, s16 units (default
#                                       200, ≈ -44 dBFS) — so a dead-quiet room's floor
#                                       doesn't make every breath "speech"
#   BESPUNKY_VOICE_MIN_SPEECH_SECONDS   one SUSTAINED run of speech needed before
#                                       end-of-speech can trigger (default 0.5 — a click
#                                       or cough is not an answer). Too high only delays
#                                       a one-word answer to the no-speech early-out,
#                                       where it is still transcribed; too low lets a
#                                       cough end the take before the answer starts.
#   BESPUNKY_VOICE_PARTIAL_SECONDS      --stream partial cadence, and the re-check cadence
#                                       when ending by words (default 1)
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
MIN_SPEECH_SEC="${BESPUNKY_VOICE_MIN_SPEECH_SECONDS:-0.5}"
PARTIAL_SEC="${BESPUNKY_VOICE_PARTIAL_SECONDS:-1}"

# The capture format, stated once: whisper's native input.
RATE=16000
CHUNK_SEC=0.1
CHUNK_BYTES=3200        # 0.1 s × 16000 Hz × 2 bytes (s16le mono)
CALIB_CHUNKS=5          # live chunks needed before the noise floor is trusted
FLOOR_CHUNKS=3          # the floor is the quietest 0.3 s stretch (a breath-length pause)
GAP_CHUNKS=3            # gaps up to 0.3 s inside a run of speech are bridged (between words)
SHORT_CHUNKS=2          # a 0.2 s run may be a one-word answer — the recogniser decides
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
# line, oldest first), considering speech only from chunk "${2:-0}" on (0-based;
# the chunks before it were judged noise by the recogniser). Stateless: every
# call re-reads the whole take, so the floor estimate keeps improving.
# Prints one word: go | speech-ended | maybe-ended | no-speech.
#   floor   the QUIETEST stretch heard so far: the minimum, over every run of
#           FLOOR_CHUNKS consecutive live chunks, of their mean loudness. Speech
#           can't inflate it — one breath-length pause anywhere in the take pulls
#           it down to the room, however much of the take is talk (a percentile
#           over all chunks rose with the share of speech, and then cut a quieter
#           continuation off as "not speech"). The window keeps one freak-quiet
#           chunk from passing for the room.
#   speech  hysteresis: a chunk ENTERS speech above floor × RATIO (and MIN_RMS);
#           speech CONTINUES while chunks stay above that threshold ÷ √RATIO —
#           so a softer tail or a quieter sentence is still the same answer, while
#           a noise bump in silence (needs the full threshold) never restarts it.
#   heard   a SUSTAINED run: MIN_SPEECH_SECONDS of speech chunks, gaps of up to
#           GAP_CHUNKS bridged. Speech chunks are not summed across the take, so a
#           string of coughs or clicks is not an answer.
#   maybe   a SHORT run (SHORT_CHUNKS up to MIN_SPEECH_SECONDS) then silence. A
#           cough and a bare "yes" carry the same energy, so loudness can't tell
#           them apart — the caller asks the recogniser instead (see the loop).
#   no-speech  judged on elapsed time alone, before and after calibration, so a
#           dead (muted, all-zero) mic gives up as early as a silent room does.
voice_vad_decide() {
  awk -v chunk="$CHUNK_SEC" -v ratio="$RATIO" -v minrms="$MIN_RMS" \
      -v calib="$CALIB_CHUNKS" -v fwin="$FLOOR_CHUNKS" -v gap="$GAP_CHUNKS" \
      -v silence="$SILENCE_SEC" -v nospeech="$NOSPEECH_SEC" -v minspeech="$MIN_SPEECH_SEC" \
      -v short="$SHORT_CHUNKS" -v from="${2:-0}" '
    { v[NR] = $1 + 0; if (v[NR] >= 1) live[++nl] = v[NR] }
    END {
      timeout = (nospeech > 0 && NR * chunk >= nospeech - 1e-9)
      if (nl < calib || nl < fwin) { print (timeout ? "no-speech" : "go"); exit }
      floor = -1
      for (i = 1; i + fwin - 1 <= nl; i++) {
        m = 0; for (j = 0; j < fwin; j++) m += live[i + j]; m /= fwin
        if (floor < 0 || m < floor) floor = m
      }
      on = floor * ratio; if (on < minrms) on = minrms
      off = on / sqrt(ratio)
      need = int(minspeech / chunk + 0.5); if (need < 1) need = 1
      st = 0; heard = 0; maybe = 0; run = 0; since = gap + 1; trail = 0
      for (i = from + 1; i <= NR; i++) {
        st = st ? (v[i] > off) : (v[i] > on)
        if (st) { run = (since > gap) ? 1 : run + 1; since = 0; trail = 0
                  if (run >= need) heard = 1; else if (run >= short) maybe = 1 }
        else    { since++; trail++ }
      }
      ended = (trail * chunk >= silence - 1e-9)
      if (heard)      print ended ? "speech-ended" : "go"
      else if (maybe && ended) print "maybe-ended"
      else            print (timeout ? "no-speech" : "go")
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
#
# The open recording is ANNOUNCED — read by the voice band, stopped by voice.sh:
#   .listening.pid  this script's pid, exactly while it records
#   .hearing        the transcript heard so far (every partial, in both modes —
#                   the live transcript is a property of listening, not of the
#                   caller's output format)
# Both are removed on exit, only if still ours.
WORK="$(mktemp -d)"
RAW="$WORK/take.raw"; LEVELS="$WORK/levels"; : >"$LEVELS"
REC_PID=""; PART_PID=""
LISTENING="$VOICE_HOME/.listening.pid"; HEARING="$VOICE_HOME/.hearing"
mkdir -p "$VOICE_HOME" 2>/dev/null
echo "$$" >"$LISTENING" 2>/dev/null; : >"$HEARING" 2>/dev/null
cleanup() {
  local p
  if [ "$(cat "$LISTENING" 2>/dev/null)" = "$$" ]; then rm -f "$LISTENING" "$HEARING"; fi
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

# The tick clock: a builtin `read -t` on a FIFO we hold open both ways (so it
# never sees EOF) instead of a foreground `sleep` — no child per tick, and a TERM
# to our process group can't kill a foreground job and have bash print
# "Terminated" on stderr; the trap simply runs when the read is interrupted.
mkfifo "$WORK/tick" && exec {TICK_FD}<>"$WORK/tick" \
  || { echo "bespunky-voice: cannot create the tick clock" >&2; exit 1; }

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

parecord --raw --format=s16le --rate="$RATE" --channels=1 --latency-msec=50 "$RAW" 2>/dev/null {TICK_FD}>&- &
REC_PID=$!

CAP_BYTES="$(awk -v s="$MAXSEC" -v r="$RATE" 'BEGIN { printf "%d", s * r * 2 }')"
PART_TICKS="$(awk -v p="$PARTIAL_SEC" -v c="$CHUNK_SEC" 'BEGIN { t = int(p / c + 0.5); print (t < 1 ? 1 : t) }')"
# The fast recogniser, stated once: partials and the short-run check both use it.
FAST=(-m "$PMODEL" -nt -np -nf -bs 1 -bo 1)
OFF=0; TICK=0; LAST_PARTIAL=""; PART_SIZE=0; WHY="cap"
FROM=0     # chunks before this were heard as noise by the recogniser — not speech
BY_WORDS=0 # 1 once loudness gave up but the recogniser heard words (a loud room)
STILL=0; HEARD=""; MOST_WORDS=0
STILL_CHECKS="$(awk -v s="$SILENCE_SEC" -v p="$PARTIAL_SEC" 'BEGIN { n = s / p; t = int(n); if (t < n) t++; print (t < 1 ? 1 : t) }')"

# Transcribe the take so far with the fast recogniser → $HEARD (cleaned text;
# empty = no words). The in-flight partial job is stopped first (one recogniser
# at a time); this one runs as a tracked job, so a signal interrupts the wait and
# the EXIT trap reaps it. In --stream the transcript, already paid for, is
# emitted as a partial when it is new. Non-zero = the take couldn't be snapshot.
fast_check() {
  [ -n "$PART_PID" ] && { kill -TERM "$PART_PID"; wait "$PART_PID"; } 2>/dev/null
  PART_PID=""; PART_SIZE="$OFF"; HEARD=""
  snapshot_wav "$WORK/check.wav" "$OFF" || return 1
  "$CLI" "${FAST[@]}" -f "$WORK/check.wav" >"$WORK/check.txt" 2>/dev/null {TICK_FD}>&- &
  PART_PID=$!; wait "$PART_PID" 2>/dev/null; PART_PID=""
  HEARD="$(voice_clean_text <"$WORK/check.txt" 2>/dev/null)"
  if [ -n "$HEARD" ] && [ "$HEARD" != "$LAST_PARTIAL" ]; then emit partial "$HEARD"; LAST_PARTIAL="$HEARD"; fi
  return 0
}
START=$SECONDS
while :; do
  read -r -t "$CHUNK_SEC" -u "$TICK_FD" _
  TICK=$((TICK + 1))
  SIZE="$(size_of "$RAW")"

  # Measure every whole chunk that arrived since the last tick.
  N=$(((SIZE - OFF) / CHUNK_BYTES))
  if [ "$N" -gt 0 ]; then
    tail -c +"$((OFF + 1))" "$RAW" | head -c "$((N * CHUNK_BYTES))" | voice_chunk_rms >>"$LEVELS"
    OFF=$((OFF + N * CHUNK_BYTES))
    if [ "$BY_WORDS" = 0 ]; then
      D="$(voice_vad_decide "$LEVELS" "$FROM")"
      case "$D" in
        go) ;;
        maybe-ended)
          # A short burst, then silence: a one-word answer or a cough? Loudness
          # can't tell — the recogniser can. Words → the answer is complete.
          # None → it was noise: disregard it and keep listening. The no-speech
          # clock still runs from the take's start: a cough grants no extra
          # thinking time, and a room that only ever coughs should still give up.
          fast_check || { WHY="speech-ended"; break; }
          [ -n "$HEARD" ] && { WHY="speech-ended"; break; }
          FROM=$((OFF / CHUNK_BYTES)) ;;
        no-speech)
          # Nothing ever stood above the noise — but in a loud room (a vacuum, a
          # tap) speech may never clear the threshold. Words → the user IS talking
          # under the noise: stop judging by loudness and end by words instead.
          fast_check && [ -n "$HEARD" ] || { WHY="no-speech"; break; }
          BY_WORDS=1; STILL=0; MOST_WORDS=$(wc -w <<<"$HEARD") ;;
        *) WHY="$D"; break ;;
      esac
    fi
  fi

  [ "$SIZE" -ge "$CAP_BYTES" ] && break
  # The recorder died (device gone) — stop with what we have.
  kill -0 "$REC_PID" 2>/dev/null || { WHY="recorder-exited"; break; }
  # Wall-clock backstop: a recorder that runs but delivers no audio.
  [ $((SECONDS - START)) -gt $((${MAXSEC%.*} + 3)) ] && { WHY="stalled"; break; }

  if [ "$BY_WORDS" = 1 ]; then
    # Ending by words: re-transcribe on the partial cadence; the answer is over
    # once the transcript has stopped GROWING for SILENCE_SECONDS' worth of
    # checks. Growth, not change: under heavy noise each pass re-guesses words
    # it already had ("meal" → "wheel"), so the text never holds still — but
    # only new speech adds words.
    if [ $((TICK % PART_TICKS)) -eq 0 ] && [ "$OFF" -gt "$PART_SIZE" ]; then
      fast_check || { WHY="speech-ended"; break; }
      W=$(wc -w <<<"$HEARD")
      if [ "$W" -gt "$MOST_WORDS" ]; then MOST_WORDS=$W; STILL=0; else STILL=$((STILL + 1)); fi
      [ "$STILL" -ge "$STILL_CHECKS" ] && { WHY="speech-ended (by words)"; break; }
    fi
    continue
  fi
  # Partials (both modes — see .hearing above): harvest a finished job; start the next one on the cadence. One
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
      "$CLI" "${FAST[@]}" -f "$WORK/partial.wav" >"$WORK/partial.txt" 2>/dev/null {TICK_FD}>&- &
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
