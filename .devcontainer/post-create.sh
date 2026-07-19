#!/usr/bin/env bash
# claude-toolkit devcontainer post-create.
#
# Runs ONCE after the container is built (or rebuilt). This repo IS the
# BeSpunky claude-toolkit marketplace, so instead of installing the PUBLISHED
# plugins from GitHub (what the project-starter scaffold does for consumer
# projects), we register THIS working tree as a local marketplace and install
# from it — so your skill/agent edits are live the moment the container opens,
# with no publish round-trip. `.claude-plugin/marketplace.json` already uses
# relative `./plugins/...` sources, so the workspace root is a valid marketplace.
set -euo pipefail

# Devcontainer-cli runs postCreateCommand from the workspace root.
WS="$(pwd)"

# --- 0. Ensure the bind-mounted Claude config dir is writable by `node` ---
# .claude/data is bind-mounted to /home/node/.claude. If Docker created the
# mount point as root (e.g. the host dir was missing on a fresh clone), the
# `node` user can't write auth/plugin state. Reclaim it. Idempotent.
if [ -d /home/node/.claude ] && [ "$(stat -c %U /home/node/.claude)" != "node" ]; then
  echo "[post-create] reclaiming /home/node/.claude ownership for node user"
  sudo chown node:node /home/node/.claude
fi

# --- 1. Dogfood the local marketplace ---
# Register this working tree as a marketplace and enable every plugin at project
# scope, so house skills/agents load LIVE from your edits. Best-effort: if the
# CLI is unreachable (offline rebuild), don't fail the build — you can enable
# them from a session with `/plugin marketplace add .` then `/plugin`.
echo "[post-create] registering local claude-toolkit marketplace (dogfooding working tree)"
if claude plugin marketplace add "$WS" \
    && claude plugin install bespunky@claude-toolkit --scope project \
    && claude plugin install bespunky-project-starter@claude-toolkit --scope project \
    && claude plugin install bespunky-engineering@claude-toolkit --scope project \
    && claude plugin install bespunky-workflow@claude-toolkit --scope project \
    && claude plugin install bespunky-browser-automation@claude-toolkit --scope project \
    && claude plugin install bespunky-product-ux@claude-toolkit --scope project \
    && claude plugin install bespunky-voice@claude-toolkit --scope project; then
  echo "[post-create] claude-toolkit plugins installed at project scope (from working tree)"
else
  echo "[post-create] NOTE: local plugin install skipped (CLI offline?). Enable later with:"
  echo "[post-create]   /plugin marketplace add . && /plugin"
fi

# --- 2. Audio toolset (for the voice-plugin spike + future bespunky-voice) ---
# WSLg audio is bridged in via devcontainer.json (PULSE_SERVER + /mnt/wslg mount).
# Install the client tools so a process here can speak/record. Best-effort: an
# offline rebuild shouldn't fail the build. Verify the bridge with:
#   bash spikes/voice-audio-boundary/probe-audio.sh
echo "[post-create] installing audio toolset (pulseaudio-utils espeak-ng alsa-utils sox)"
if sudo apt-get update -qq && sudo apt-get install -y -qq pulseaudio-utils espeak-ng alsa-utils sox; then
  echo "[post-create] audio toolset installed"
else
  echo "[post-create] NOTE: audio toolset install skipped (offline?). Install later with:"
  echo "[post-create]   bash spikes/voice-audio-boundary/probe-audio.sh --install"
fi

echo "[post-create] done"
