#!/usr/bin/env bash
# bespunky-voice — voice-auto.sh : toggle / inspect AUTOMATIC speaking.
#
# The manual trigger (/speak say) always works. This governs only the AUTOMATIC
# half: when ON, the PreToolUse hook speaks each multiple-choice question and
# plan-approval as it appears. Default is OFF — the plugin never makes a sound
# you didn't ask for until you opt in.
#
# State = one file, "on" or absent, at ~/.claude/bespunky-voice/voice-auto. This
# is a MACHINE/session fact ("am I away from the keyboard right now?"), not a repo
# fact — so it lives with the rest of the plugin's machine-local runtime, NOT in a
# project's .claude/ (which would make you re-toggle per project and risk being
# committed into a consumer repo).
set -uo pipefail

STATE_DIR="${HOME}/.claude/bespunky-voice"
STATE="$STATE_DIR/voice-auto"

case "${1:-status}" in
  on)
    mkdir -p "$STATE_DIR"
    printf 'on\n' > "$STATE"
    echo "auto-speak: ON — questions and plan approvals will be read aloud."
    ;;
  off)
    rm -f "$STATE"
    echo "auto-speak: OFF — nothing is spoken unless you run /speak say."
    ;;
  status)
    if [ -f "$STATE" ] && [ "$(cat "$STATE" 2>/dev/null)" = on ]; then
      echo "auto-speak: on"
    else
      echo "auto-speak: off"
    fi
    # Where the audio would go right now, and at what mic gain — resolved by the
    # same helper speak.sh/listen.sh use, sourced from this script's own dir.
    # shellcheck source=audio-endpoint.sh
    . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/audio-endpoint.sh"
    if voice_resolve_endpoint; then
      echo "audio endpoint: $VOICE_ENDPOINT (via $VOICE_ENDPOINT_VIA)"
      echo "mic gain: $VOICE_MIC_GAIN ($VOICE_MIC_GAIN_WHY)"
    else
      echo "$VOICE_ENDPOINT_DIAGNOSIS"
    fi
    # Which voice will ACTUALLY speak — decided by running piper, not by finding
    # its files, because a present-but-broken piper is exactly the case that
    # otherwise only shows up as "why does it sound robotic?".
    # shellcheck source=tts-engine.sh
    . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tts-engine.sh"
    voice_tts_verdict
    case "$VOICE_TTS_HEALTH" in
      natural) echo "speech engine: piper, natural (voice $VOICE_PIPER_VOICE)" ;;
      broken)  echo "speech engine: robotic fallback — piper is installed but $VOICE_PIPER_PROBLEM. Repair: bash ~/.claude/bespunky-voice/install-piper.sh" ;;
      robotic) echo "speech engine: espeak-ng, robotic ($VOICE_PIPER_PROBLEM). Natural voice: bash ~/.claude/bespunky-voice/install-piper.sh" ;;
      system)  echo "speech engine: macOS say" ;;
      none)    echo "speech engine: none — install espeak-ng, or run bash ~/.claude/bespunky-voice/install-piper.sh" ;;
    esac
    ;;
  *)
    echo "usage: voice-auto.sh [on|off|status]" >&2
    exit 2
    ;;
esac
