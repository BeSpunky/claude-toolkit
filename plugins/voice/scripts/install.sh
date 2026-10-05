#!/usr/bin/env bash
# bespunky-voice — install.sh : make this machine able to speak and listen.
#
# The one front door to the voice runtime's installation. Claude runs it itself
# the moment a voice tool reports a missing or broken engine — the person asked
# to talk by voice, so "go install X, then try again" is a hoop, not an answer.
# It decides nothing about health: each half is judged by the same verdict the
# runtime uses (voice-health.sh), and only what that verdict says is not working
# gets installed. Already-healthy pieces are left alone, so it is safe to re-run.
#
#   install.sh            both halves
#   install.sh speak      text-to-speech only: Piper (the natural voice); the
#                         espeak-ng floor only when Piper cannot be installed;
#                         an audio player
#   install.sh listen     speech-to-text only: whisper.cpp + its models
#                         (install-whisper.sh), parecord and sox
#
# OS packages come from apt-get, through `sudo -n` — never a password prompt
# nobody can answer. Where that is unavailable the missing package is NAMED.
#
# Output: progress on stdout; last, the two health lines voice-health.sh prints.
# Exit 0 when every requested half works afterwards, 1 otherwise (stderr says why).
# A whisper build takes a few minutes the first time.
#
# What it cannot install: an audio endpoint. Voice needs a reachable
# PulseAudio-protocol sink — a fact about the host, bridged by the devcontainer.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=voice-health.sh
. "$HERE/voice-health.sh"

# Not `say`: that would shadow macOS say, which the TTS verdict looks for.
note() { echo "[voice-install] $*"; }

# Install OS packages without ever prompting. 0 on success.
apt_install() {
  command -v apt-get >/dev/null 2>&1 || { note "no apt-get here — install by hand: $*" >&2; return 1; }
  local sudo=""
  [ "$(id -u)" = 0 ] || { sudo -n true 2>/dev/null && sudo="sudo -n"; } \
    || { note "no passwordless sudo — install by hand: sudo apt-get install -y $*" >&2; return 1; }
  note "installing $* (apt-get)..."
  $sudo apt-get update -qq >/dev/null 2>&1
  $sudo apt-get install -y -qq "$@" >/dev/null 2>&1 || { note "apt-get could not install: $*" >&2; return 1; }
}

# The OS packages that provide each command, installed only when it's missing.
need_commands() {  # need_commands <package> <command>...
  local pkg="$1" c; shift
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || { apt_install "$pkg"; return; }; done
}

has_player() { command -v paplay >/dev/null 2>&1 || command -v aplay >/dev/null 2>&1 || command -v afplay >/dev/null 2>&1; }

install_speak() {
  voice_tts_verdict
  if [ "$VOICE_TTS_HEALTH" != natural ]; then
    note "speech: $VOICE_TTS_HEALTH${VOICE_PIPER_PROBLEM:+ ($VOICE_PIPER_PROBLEM)} — installing the natural voice (Piper)"
    bash "$HERE/install-piper.sh" || true
    voice_tts_verdict
    # Piper unreachable (offline, unsupported arch): the robotic floor still speaks.
    if [ "$VOICE_TTS_HEALTH" = none ]; then apt_install espeak-ng; voice_tts_verdict; fi
  fi
  has_player || apt_install pulseaudio-utils
}

install_listen() {
  need_commands pulseaudio-utils parecord pactl
  need_commands sox sox
  voice_stt_verdict
  [ "$VOICE_STT_HEALTH" = ok ] && return 0
  note "listening: $VOICE_STT_HEALTH ($VOICE_STT_PROBLEM) — building whisper.cpp"
  need_commands build-essential make cc
  need_commands cmake cmake
  need_commands git git
  need_commands curl curl
  bash "$HERE/install-whisper.sh" || true
}

targets=("$@"); [ "${#targets[@]}" -gt 0 ] || targets=(speak listen)
for t in "${targets[@]}"; do
  case "$t" in
    speak)  install_speak ;;
    listen) install_listen ;;
    *) echo "usage: install.sh [speak] [listen]" >&2; exit 2 ;;
  esac
done

# The verdict after the work — the same one the band and /speak status show.
health="$(bash "$HERE/voice-health.sh")"
echo "$health"
tts="$(awk -F'\t' '$1=="tts"{print $2}' <<<"$health")"
stt="$(awk -F'\t' '$1=="stt"{print $2}' <<<"$health")"
rc=0
for t in "${targets[@]}"; do
  case "$t" in
    speak)  [ "$tts" != none ] || { echo "bespunky-voice: still no working speech engine" >&2; rc=1; }
            has_player || { echo "bespunky-voice: still no audio player (paplay, aplay or afplay)" >&2; rc=1; } ;;
    listen) [ "$stt" = ok ] || { echo "bespunky-voice: speech recognition still $stt" >&2; rc=1; }
            { command -v parecord >/dev/null 2>&1 && command -v sox >/dev/null 2>&1; } \
              || { echo "bespunky-voice: still missing parecord or sox" >&2; rc=1; } ;;
  esac
done
exit "$rc"
