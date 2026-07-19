#!/usr/bin/env bash
# bespunky-voice — speak.sh
#
# Turn text into speech and play it to the user's default audio sink. This is the
# ONE place the plugin touches an audio engine — the swappable boundary. Callers
# (the /voice command, the auto-speak hook) hand it ready-to-read text; how that
# text becomes sound is entirely this script's concern, so the engine can change
# (espeak-ng → Piper → a cloud voice) without touching a single caller.
#
# Text arrives as arguments ("$*") or, if none, on stdin. On SUCCESS it prints
# NOTHING: this is called from a hook, and a hook's stdout is injected into
# Claude's context — so a chatty TTS script would feed spoken text back into the
# model. Errors go to stderr only.
#
# Engine selection (first that applies):
#   1. Piper (natural, local, offline) — auto-detected from the conventional
#      install that scripts/install-piper.sh produces (~/.claude/bespunky-voice/
#      piper/piper + voices/default.onnx), or from the env overrides below. This
#      is the "free upgrade": drop the binary + a voice in place and it takes over
#      with ZERO config threading through hooks.
#   2. espeak-ng — the free floor: robotic but clear, no model, no network.
#
# Env knobs (all optional — the convention above usually means you set none):
#   BESPUNKY_VOICE_RATE          espeak-ng words-per-minute (default 160)
#   BESPUNKY_VOICE_PIPER_MODEL   path to a Piper .onnx voice → forces Piper
#   BESPUNKY_VOICE_PIPER_BIN     piper binary name/path (default: auto-detect)
#
# Audio reaches the host via whatever PULSE_SERVER the environment already sets
# (in this devcontainer, WSLg's socket) — deliberately NOT hardcoded here, so the
# plugin stays portable to a Mac/native-Linux consumer.
set -uo pipefail

# --- 1. gather the text to speak ---------------------------------------------
if [ "$#" -gt 0 ]; then
  TEXT="$*"
else
  TEXT="$(cat)"
fi
# Nothing but whitespace? Say nothing, succeed quietly.
[ -n "${TEXT//[[:space:]]/}" ] || exit 0

# --- 2. make it LISTENABLE: strip markup so the ear hears words, not symbols --
# The callers usually pre-summarize for the ear; this is the safety net that
# guarantees no stray backtick, asterisk, pipe or link-URL ever gets read aloud.
CLEAN="$(printf '%s' "$TEXT" | sed -E '
    s/```[^`]*```/ /g;               # fenced code blocks → drop
    s/`([^`]*)`/\1/g;                # inline code → its text
    s/!?\[([^]]*)\]\([^)]*\)/\1/g;   # [text](url) / ![alt](src) → text/alt
    s/[*_#>|]+/ /g;                  # emphasis, headings, blockquote, table pipes
    s/~~//g;                         # strikethrough markers
    s/[[:space:]]+/ /g;              # collapse newlines/runs of space
    s/^ +| +$//g;                    # trim
  ')"
[ -n "$CLEAN" ] || exit 0

# --- 3. synthesize to a temp wav, then play it -------------------------------
TMP="$(mktemp --suffix=.wav)" || { echo "bespunky-voice: mktemp failed" >&2; exit 1; }
trap 'rm -f "$TMP"' EXIT

# Resolve Piper by convention (with env override), so no config threads through hooks.
VOICE_HOME="${HOME}/.claude/bespunky-voice"
PIPER_BIN="${BESPUNKY_VOICE_PIPER_BIN:-}"
[ -z "$PIPER_BIN" ] && command -v piper >/dev/null 2>&1 && PIPER_BIN="$(command -v piper)"
[ -z "$PIPER_BIN" ] && [ -x "$VOICE_HOME/piper/piper" ] && PIPER_BIN="$VOICE_HOME/piper/piper"

PIPER_MODEL="${BESPUNKY_VOICE_PIPER_MODEL:-}"
if [ -z "$PIPER_MODEL" ]; then
  if [ -e "$VOICE_HOME/voices/default.onnx" ]; then
    PIPER_MODEL="$VOICE_HOME/voices/default.onnx"
  else
    PIPER_MODEL="$(ls "$VOICE_HOME"/voices/*.onnx 2>/dev/null | head -1)"
  fi
fi

if [ -n "$PIPER_BIN" ] && [ -n "$PIPER_MODEL" ] && [ -f "$PIPER_MODEL" ]; then
  # Piper's binary finds its bundled libs alongside itself.
  PIPER_LIBS="$(dirname "$PIPER_BIN")"
  if ! printf '%s' "$CLEAN" | LD_LIBRARY_PATH="$PIPER_LIBS:${LD_LIBRARY_PATH:-}" \
       "$PIPER_BIN" --model "$PIPER_MODEL" --output_file "$TMP" 2>/dev/null; then
    # Piper present but failed — fall back to the floor rather than going silent.
    if command -v espeak-ng >/dev/null 2>&1; then
      espeak-ng -s "${BESPUNKY_VOICE_RATE:-160}" -w "$TMP" "$CLEAN" 2>/dev/null \
        || { echo "bespunky-voice: piper AND espeak-ng failed" >&2; exit 1; }
    else
      echo "bespunky-voice: piper synthesis failed and no espeak-ng fallback" >&2; exit 1
    fi
  fi
elif command -v espeak-ng >/dev/null 2>&1; then
  espeak-ng -s "${BESPUNKY_VOICE_RATE:-160}" -w "$TMP" "$CLEAN" 2>/dev/null \
    || { echo "bespunky-voice: espeak-ng synthesis failed" >&2; exit 1; }
else
  echo "bespunky-voice: no TTS engine — install espeak-ng, or set BESPUNKY_VOICE_PIPER_MODEL" >&2
  exit 1
fi

# --- 4. play to the default sink ---------------------------------------------
if command -v paplay >/dev/null 2>&1; then
  paplay "$TMP" 2>/dev/null || { echo "bespunky-voice: paplay failed (is PULSE_SERVER reachable?)" >&2; exit 1; }
elif command -v aplay >/dev/null 2>&1; then
  aplay -q "$TMP" 2>/dev/null || { echo "bespunky-voice: aplay failed" >&2; exit 1; }
else
  echo "bespunky-voice: no audio player (paplay/aplay)" >&2
  exit 1
fi
