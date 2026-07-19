#!/usr/bin/env bash
# spikes/voice-audio-boundary/probe-audio.sh
#
# AUDIO BOUNDARY SPIKE for the (future) bespunky-voice plugin.
#
# The one question that gates the whole plugin: can a process INSIDE this
# devcontainer BOTH
#   (1) speak a sentence to your real speakers, and
#   (2) capture a spoken word from your real mic?
#
# If yes -> every tier of the voice design (manual commands, auto-speak hook,
#           hands-free MCP tool) is buildable; audio is just an implementation
#           detail behind the tool boundary.
# If no  -> this script tells you exactly what to add to
#           .devcontainer/devcontainer.json and rebuild (see README.md).
#
# Safe to run repeatedly. READ-ONLY unless you pass --install (which apt-gets a
# minimal audio toolset). Never touches your project files.
#
# Usage:
#   bash probe-audio.sh                 # diagnose, then test if audio is reachable
#   bash probe-audio.sh --install       # first: apt-get the minimal audio toolset
#   bash probe-audio.sh --seconds 5     # mic record window (default 4)
#   bash probe-audio.sh --no-playback   # don't replay your recording back at you
#   bash probe-audio.sh --text "hello"  # what to speak in the output test

set -uo pipefail

SECONDS_REC=4
DO_INSTALL=0
DO_PLAYBACK=1
SAY_TEXT="Voice plugin audio test. If you can hear this, output works."
TMPDIR_SPIKE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SPIKE"' EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --install)      DO_INSTALL=1 ;;
    --no-playback)  DO_PLAYBACK=0 ;;
    --seconds)      SECONDS_REC="${2:?}"; shift ;;
    --text)         SAY_TEXT="${2:?}"; shift ;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

have()  { command -v "$1" >/dev/null 2>&1; }
rule()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no()    { printf '  \033[31m✗\033[0m %s\n' "$*"; }
info()  { printf '  · %s\n' "$*"; }

# --------------------------------------------------------------------------
rule "0. Environment"
[ -f /.dockerenv ] && info "in a container" || info "NOT in a container"
grep -qi microsoft /proc/version 2>/dev/null && info "WSL kernel" || info "non-WSL kernel"
info "user=$(id -un)  uid=$(id -u)  XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-<unset>}"

# --------------------------------------------------------------------------
if [ "$DO_INSTALL" = 1 ]; then
  rule "1. Installing minimal audio toolset (sudo apt-get)"
  # pulseaudio-utils: pactl/paplay/parecord · espeak-ng: TTS · alsa-utils: aplay/arecord fallback · sox: level metering
  if sudo apt-get update -qq && \
     sudo apt-get install -y -qq pulseaudio-utils espeak-ng alsa-utils sox; then
    ok "installed pulseaudio-utils espeak-ng alsa-utils sox"
  else
    no "apt-get failed — you may be offline, or need to run with sudo available"
  fi
fi

# --------------------------------------------------------------------------
rule "2. Tools present"
MISSING=0
for t in pactl paplay parecord espeak-ng sox; do
  if have "$t"; then ok "$t"; else no "$t (MISSING)"; MISSING=1; fi
done
if [ "$MISSING" = 1 ]; then
  info "Re-run with --install to apt-get the missing tools, then run again."
fi

# --------------------------------------------------------------------------
rule "3. Reaching a PulseAudio server (the host-audio bridge)"
# Try each candidate socket; the first that answers `pactl info` wins.
FOUND_PULSE=""
CANDIDATES=(
  "${PULSE_SERVER:-}"
  "unix:/mnt/wslg/PulseServer"
  "unix:${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pulse/native"
  "unix:/run/user/$(id -u)/pulse/native"
  "unix:/tmp/pulse/native"
)
if have pactl; then
  for c in "${CANDIDATES[@]}"; do
    [ -z "$c" ] && continue
    if PULSE_SERVER="$c" pactl info >/dev/null 2>&1; then
      FOUND_PULSE="$c"; export PULSE_SERVER="$c"
      ok "PulseAudio reachable at: $c"
      break
    else
      info "no server at: $c"
    fi
  done
  if [ -z "$FOUND_PULSE" ]; then
    no "no PulseAudio server reachable from inside the container"
  fi
else
  no "pactl not installed — cannot probe PulseAudio (run with --install)"
fi

SINK_OK=0
SOURCE_OK=0

# --------------------------------------------------------------------------
rule "4. OUTPUT test — can I reach your speakers?"
if [ -n "$FOUND_PULSE" ] && have espeak-ng && have paplay; then
  if espeak-ng -w "$TMPDIR_SPIKE/say.wav" "$SAY_TEXT" 2>/dev/null; then
    ok "synthesized speech to wav (espeak-ng works)"
    info "playing it to the default sink now — LISTEN..."
    if paplay "$TMPDIR_SPIKE/say.wav" 2>/dev/null; then
      ok "paplay returned success — you should have heard it"
      SINK_OK=1
    else
      no "paplay failed — server reachable but no usable sink"
    fi
  else
    no "espeak-ng could not synthesize (unexpected)"
  fi
else
  no "skipped (need a reachable PulseAudio server + espeak-ng + paplay)"
fi

# --------------------------------------------------------------------------
rule "5. INPUT test — can I hear your mic?"
if [ -n "$FOUND_PULSE" ] && have parecord && have sox; then
  info "Recording ${SECONDS_REC}s. SPEAK A WORD NOW..."
  timeout "$((SECONDS_REC + 1))" parecord --channels=1 --file-format=wav "$TMPDIR_SPIKE/rec.wav" 2>/dev/null
  if [ -s "$TMPDIR_SPIKE/rec.wav" ]; then
    ok "captured a recording ($(stat -c %s "$TMPDIR_SPIKE/rec.wav") bytes)"
    RMS="$(sox "$TMPDIR_SPIKE/rec.wav" -n stat 2>&1 | awk -F: '/RMS +amplitude/ {gsub(/ /,"",$2); print $2}')"
    info "RMS amplitude: ${RMS:-unknown}  (silence ≈ 0.000x; speech is usually > 0.01)"
    # crude signal check: RMS above a small floor means we captured real audio
    if [ -n "${RMS:-}" ] && awk "BEGIN{exit !($RMS > 0.005)}"; then
      ok "signal detected — the mic is reaching the container"
      SOURCE_OK=1
    else
      no "level near-silent — mic may be muted, unpermitted, or not bridged"
    fi
    if [ "$DO_PLAYBACK" = 1 ] && [ "$SINK_OK" = 1 ] && have paplay; then
      info "playing your recording back..."
      paplay "$TMPDIR_SPIKE/rec.wav" 2>/dev/null || true
    fi
  else
    no "recording is empty — no source available"
  fi
else
  no "skipped (need a reachable PulseAudio server + parecord + sox)"
fi

# --------------------------------------------------------------------------
rule "VERDICT"
if [ "$SINK_OK" = 1 ] && [ "$SOURCE_OK" = 1 ]; then
  printf '  \033[1;32mPASS\033[0m — speaker AND mic both cross the boundary. Build the plugin.\n'
  exit 0
elif [ "$SINK_OK" = 1 ]; then
  printf '  \033[1;33mPARTIAL\033[0m — speaker works, mic does not. Tiers 1–2 (speak) are buildable;\n'
  printf '  voice-ANSWER (tiers 1-answer & 3) needs the mic bridged. See README.md.\n'
  exit 1
else
  printf '  \033[1;31mFAIL\033[0m — no audio reaches the container yet. This is expected on a\n'
  printf '  stock devcontainer. Bridge host audio, then re-run:\n\n'
  printf '    1) Edit .devcontainer/devcontainer.json — add the WSLg mount + PULSE_SERVER\n'
  printf '       env (see spikes/voice-audio-boundary/README.md for the exact patch).\n'
  printf '    2) Rebuild the container.\n'
  printf '    3) bash spikes/voice-audio-boundary/probe-audio.sh --install\n'
  exit 1
fi
