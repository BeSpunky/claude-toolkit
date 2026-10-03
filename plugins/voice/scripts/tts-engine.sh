#!/usr/bin/env bash
# bespunky-voice — tts-engine.sh : resolve the natural voice, and know whether it WORKS.
#
# The one place the plugin knows where Piper lives and how to tell a working
# install from a merely PRESENT one. speak.sh, install-piper.sh and
# voice-auto.sh status all source this; none of them knows Piper's layout.
#
# Why "present" is not enough: Piper ships as a binary plus bundled shared
# libraries reached through soname symlinks (libpiper_phonemize.so.1 → …so.1.2.0).
# Copy that folder with anything that drops symlinks and every file is still
# there — the binary is executable, the voice is on disk — yet piper dies in the
# dynamic linker on every call. Checking `-x piper` called that "installed", and
# speak.sh fell back to the robotic espeak-ng without a word. So health is decided
# by RUNNING piper on a real utterance, never by looking at files.
#
# Contract:
#   voice_resolve_piper   → VOICE_PIPER_BIN, VOICE_PIPER_MODEL (each may be empty),
#                           VOICE_PIPER_VOICE (the model's name, for humans).
#                           Always returns 0: absence is a fact, not an error.
#   voice_piper_synth TEXT OUT
#                         → synthesize TEXT into the WAV file OUT with the resolved
#                           piper. 0 on success; on failure VOICE_PIPER_PROBLEM holds
#                           one line saying why (missing piece, or piper's own error).
#   voice_piper_probe     → voice_piper_synth on a fixed word into a temp file: the
#                           health check. Same return/VOICE_PIPER_PROBLEM contract.
#   voice_tts_verdict     → which engine will ACTUALLY speak, as one word in
#                           VOICE_TTS_HEALTH, the same order speak.sh tries them:
#                             natural  piper works
#                             broken   piper is installed but fails (speech falls
#                                      back to the robotic voice, or to none)
#                             robotic  no piper; espeak-ng speaks
#                             system   no piper or espeak-ng; macOS say speaks
#                             none     nothing can speak
#                           VOICE_PIPER_PROBLEM says why when it isn't natural.
#                           Runs the probe (~0.3 s): callers that poll must cache it.
#
# Env overrides (all optional): BESPUNKY_VOICE_PIPER_BIN, BESPUNKY_VOICE_PIPER_MODEL.
#
# Run directly (not sourced) it prints the verdict — a one-line diagnostic.

VOICE_HOME="${VOICE_HOME:-${HOME}/.claude/bespunky-voice}"

voice_resolve_piper() {
  VOICE_PIPER_BIN="${BESPUNKY_VOICE_PIPER_BIN:-}"
  [ -z "$VOICE_PIPER_BIN" ] && command -v piper >/dev/null 2>&1 && VOICE_PIPER_BIN="$(command -v piper)"
  [ -z "$VOICE_PIPER_BIN" ] && [ -x "$VOICE_HOME/piper/piper" ] && VOICE_PIPER_BIN="$VOICE_HOME/piper/piper"

  VOICE_PIPER_MODEL="${BESPUNKY_VOICE_PIPER_MODEL:-}"
  if [ -z "$VOICE_PIPER_MODEL" ]; then
    if [ -e "$VOICE_HOME/voices/default.onnx" ]; then
      VOICE_PIPER_MODEL="$VOICE_HOME/voices/default.onnx"
    else
      VOICE_PIPER_MODEL="$(ls "$VOICE_HOME"/voices/*.onnx 2>/dev/null | head -n1)"
    fi
  fi

  # Name the voice a human would recognise: default.onnx is a symlink to it.
  VOICE_PIPER_VOICE=""
  if [ -n "$VOICE_PIPER_MODEL" ]; then
    local real
    real="$(readlink -f "$VOICE_PIPER_MODEL" 2>/dev/null || printf '%s' "$VOICE_PIPER_MODEL")"
    VOICE_PIPER_VOICE="$(basename "$real" .onnx)"
  fi
  return 0
}

voice_piper_synth() {
  local text="$1" out="$2" err
  VOICE_PIPER_PROBLEM=""
  if [ -z "${VOICE_PIPER_BIN:-}" ]; then
    VOICE_PIPER_PROBLEM="piper is not installed"; return 1
  fi
  if [ -z "${VOICE_PIPER_MODEL:-}" ] || [ ! -f "$VOICE_PIPER_MODEL" ]; then
    VOICE_PIPER_PROBLEM="no piper voice model in $VOICE_HOME/voices"; return 1
  fi
  # piper finds its bundled libs alongside itself. Its own stderr is the
  # diagnosis we want on failure (e.g. "cannot open shared object file"), so
  # keep it — but only its last line, and only when it failed.
  if err="$(printf '%s' "$text" \
      | LD_LIBRARY_PATH="$(dirname "$VOICE_PIPER_BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        "$VOICE_PIPER_BIN" --model "$VOICE_PIPER_MODEL" --output_file "$out" 2>&1 >/dev/null)" \
     && [ -s "$out" ]; then
    return 0
  fi
  err="$(printf '%s\n' "$err" | grep -v '^[[:space:]]*$' | tail -n1)"
  VOICE_PIPER_PROBLEM="piper failed: ${err:-produced no audio}"
  return 1
}

voice_piper_probe() {
  local tmp rc
  tmp="$(mktemp "${TMPDIR:-/tmp}/bespunky-voice-probe-XXXXXX")" || { VOICE_PIPER_PROBLEM="mktemp failed"; return 1; }
  voice_piper_synth "ok" "$tmp"; rc=$?
  rm -f "$tmp"
  return "$rc"
}

voice_tts_verdict() {
  voice_resolve_piper
  if voice_piper_probe; then VOICE_TTS_HEALTH=natural
  elif [ -n "$VOICE_PIPER_BIN" ]; then VOICE_TTS_HEALTH=broken
  elif command -v espeak-ng >/dev/null 2>&1; then VOICE_TTS_HEALTH=robotic
  elif command -v say >/dev/null 2>&1; then VOICE_TTS_HEALTH=system
  else VOICE_TTS_HEALTH=none
  fi
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  voice_resolve_piper
  if voice_piper_probe; then
    echo "piper: working (voice $VOICE_PIPER_VOICE)"
  else
    echo "piper: NOT working — $VOICE_PIPER_PROBLEM"
    exit 1
  fi
fi
