#!/usr/bin/env bash
# bespunky-voice — install-whisper.sh
#
# Local speech-to-text for /speak answer — the input mirror of install-piper.sh.
# Builds whisper.cpp and downloads a model into ~/.claude/bespunky-voice/whisper
# (machine-local, persists across rebuilds, never committed — we ship the
# installer, not the ~140 MB model or the compiled binary). Idempotent: an
# install from before a piece was added gets just that piece by re-running it.
#
# Two engines, two models:
#   whisper-cli + ggml-<model>.bin            the recogniser (speech → text)
#   whisper-vad-speech-segments + Silero VAD  the speech detector (is anyone
#                                             talking, and when did they stop?) —
#                                             listen.sh's end-of-speech arbiter
#
# Usage: install-whisper.sh [model]     model default: base.en
#   (tiny.en fastest/least accurate · base.en balanced · small.en most accurate)
set -uo pipefail

WHDIR="${HOME}/.claude/bespunky-voice/whisper"
MODEL_NAME="${1:-base.en}"
CLI="$WHDIR/src/build/bin/whisper-cli"
VAD="$WHDIR/src/build/bin/whisper-vad-speech-segments"
MODEL="$WHDIR/models/ggml-$MODEL_NAME.bin"
VAD_NAME="silero-v6.2.0"   # one of whisper.cpp's models/download-vad-model.sh list
VAD_MODEL="$WHDIR/models/ggml-$VAD_NAME.bin"
mkdir -p "$WHDIR/models"

# --- build toolchain ----------------------------------------------------------
for t in git make cc curl; do
  command -v "$t" >/dev/null 2>&1 || { echo "[install-whisper] missing required tool: $t" >&2; exit 1; }
done
if ! command -v cmake >/dev/null 2>&1; then
  echo "[install-whisper] installing cmake (sudo apt-get)..."
  sudo apt-get update -qq && sudo apt-get install -y -qq cmake || { echo "[install-whisper] could not install cmake" >&2; exit 1; }
fi

# --- build whisper-cli + the speech detector ---------------------------------
if [ ! -x "$CLI" ] || [ ! -x "$VAD" ]; then
  if [ ! -d "$WHDIR/src" ]; then
    echo "[install-whisper] cloning whisper.cpp..."
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp "$WHDIR/src" || { echo "[install-whisper] clone failed" >&2; exit 1; }
  fi
  echo "[install-whisper] building whisper-cli + whisper-vad-speech-segments (a minute or two)..."
  cd "$WHDIR/src"
  cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >/dev/null 2>&1
  cmake --build build --target whisper-cli whisper-vad-speech-segments -j"$(nproc)" >/dev/null 2>&1
fi
[ -x "$CLI" ] || { echo "[install-whisper] build failed — no whisper-cli" >&2; exit 1; }
[ -x "$VAD" ] || { echo "[install-whisper] build failed — no whisper-vad-speech-segments (an old whisper.cpp checkout? remove $WHDIR/src and re-run)" >&2; exit 1; }
echo "[install-whisper] whisper-cli ready → $CLI"
echo "[install-whisper] speech detector ready → $VAD"

# --- model --------------------------------------------------------------------
if [ ! -f "$MODEL" ]; then
  echo "[install-whisper] downloading model $MODEL_NAME (~140 MB for base.en)..."
  curl -fsSL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL_NAME.bin" -o "$MODEL" \
    || { echo "[install-whisper] model download failed" >&2; rm -f "$MODEL"; exit 1; }
fi
if [ ! -f "$VAD_MODEL" ]; then
  echo "[install-whisper] downloading speech detector $VAD_NAME (~1 MB)..."
  curl -fsSL "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-$VAD_NAME.bin" -o "$VAD_MODEL" \
    || { echo "[install-whisper] speech detector download failed" >&2; rm -f "$VAD_MODEL"; exit 1; }
fi
echo "[install-whisper] done. model → $MODEL · speech detector → $VAD_MODEL"
exit 0
