#!/usr/bin/env bash
# bespunky-voice — install-piper.sh
#
# Installs Piper (local neural TTS) — the natural-voice UPGRADE over the espeak-ng
# floor. Still free, still offline. We ship an INSTALLER, not the ~20 MB binary and
# ~60 MB voices: those are machine-local artifacts (they live under ~/.claude, which
# persists across rebuilds but is never committed), and any consumer can run this to
# opt in. Without it, speak.sh simply falls back to espeak-ng.
#
# Layout it produces (the convention speak.sh auto-detects):
#   ~/.claude/bespunky-voice/piper/piper        the binary + its libs + espeak-ng-data
#   ~/.claude/bespunky-voice/voices/<name>.onnx a voice model (+ .onnx.json)
#   ~/.claude/bespunky-voice/voices/default.onnx symlink → the chosen voice
#
# Usage:
#   install-piper.sh [HF_VOICE_PATH ...]
#     no args     → installs binary + a sensible default voice
#     HF paths    → e.g. en/en_US/hfc_female/medium/en_US-hfc_female-medium
#   install-piper.sh --set-default <name>   → point default.onnx at an installed voice
set -uo pipefail

HOME_DIR="${HOME}/.claude/bespunky-voice"
PIPER_DIR="$HOME_DIR/piper"
VOICES_DIR="$HOME_DIR/voices"
BIN="$PIPER_DIR/piper"
REL="${BESPUNKY_VOICE_PIPER_RELEASE:-2023.11.14-2}"
HF="https://huggingface.co/rhasspy/piper-voices/resolve/main"
mkdir -p "$PIPER_DIR" "$VOICES_DIR"

# --- --set-default <name>: just repoint the symlink and exit ------------------
if [ "${1:-}" = "--set-default" ]; then
  name="${2:?usage: install-piper.sh --set-default <voice-name>}"
  # Piper needs BOTH the .onnx and its .onnx.json sidecar — verify both so we
  # never point default.* at a half-present voice (a dangling .json symlink would
  # make a "successful" set-default produce a non-working default).
  [ -f "$VOICES_DIR/$name.onnx" ]      || { echo "no such voice: $name (in $VOICES_DIR)" >&2; exit 1; }
  [ -f "$VOICES_DIR/$name.onnx.json" ] || { echo "voice $name is missing its .onnx.json config" >&2; exit 1; }
  ln -sf "$name.onnx" "$VOICES_DIR/default.onnx"
  ln -sf "$name.onnx.json" "$VOICES_DIR/default.onnx.json"
  echo "default voice → $name"
  exit 0
fi

# --- 1. the piper binary ------------------------------------------------------
if [ ! -x "$BIN" ]; then
  url="https://github.com/rhasspy/piper/releases/download/$REL/piper_linux_$(uname -m).tar.gz"
  echo "[install-piper] downloading piper binary from $url ..."
  tmp="$(mktemp -d)"
  if curl -fsSL "$url" -o "$tmp/piper.tgz" && tar -xzf "$tmp/piper.tgz" -C "$tmp"; then
    cp -rf "$tmp/piper/." "$PIPER_DIR/"     # binary + libs + espeak-ng-data
    chmod +x "$BIN" 2>/dev/null || true
    echo "[install-piper] piper installed → $BIN"
  else
    echo "[install-piper] FAILED to download/extract piper binary" >&2
    rm -rf "$tmp"; exit 1
  fi
  rm -rf "$tmp"
else
  echo "[install-piper] piper binary already present"
fi

# --- 2. voices ----------------------------------------------------------------
VOICES=("$@")
[ "${#VOICES[@]}" -eq 0 ] && VOICES=("en/en_US/hfc_female/medium/en_US-hfc_female-medium")

for v in "${VOICES[@]}"; do
  name="$(basename "$v")"
  if [ -f "$VOICES_DIR/$name.onnx" ] && [ -f "$VOICES_DIR/$name.onnx.json" ]; then
    echo "[install-piper] voice present: $name"; continue
  fi
  echo "[install-piper] downloading voice: $name ..."
  if curl -fsSL "$HF/$v.onnx"      -o "$VOICES_DIR/$name.onnx" \
  && curl -fsSL "$HF/$v.onnx.json" -o "$VOICES_DIR/$name.onnx.json"; then
    echo "[install-piper] got $name"
  else
    echo "[install-piper] FAILED voice: $name" >&2
    rm -f "$VOICES_DIR/$name.onnx" "$VOICES_DIR/$name.onnx.json"
  fi
done

# Ensure there's a default so speak.sh has a voice to pick.
if [ ! -e "$VOICES_DIR/default.onnx" ]; then
  first="$(ls "$VOICES_DIR"/*.onnx 2>/dev/null | grep -v '/default.onnx$' | head -1)"
  if [ -n "$first" ]; then
    b="$(basename "$first" .onnx)"
    ln -sf "$b.onnx" "$VOICES_DIR/default.onnx"
    ln -sf "$b.onnx.json" "$VOICES_DIR/default.onnx.json"
    echo "[install-piper] default voice → $b"
  fi
fi

echo "[install-piper] done. Installed voices:"
ls -1 "$VOICES_DIR"/*.onnx 2>/dev/null | sed 's#.*/##;s/\.onnx$//' | grep -v '^default$' || true
exit 0
