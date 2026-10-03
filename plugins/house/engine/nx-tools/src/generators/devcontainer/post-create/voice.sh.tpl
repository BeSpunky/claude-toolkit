# --- Voice prerequisites (the --voice intent; self-adapts on the host audio bridge) ---
# The bespunky-voice plugin speaks (TTS) and listens (STT) through a PulseAudio-protocol socket.
# Voice is OPT-IN (scaffold with --voice): only then does the devcontainer carry the host probe
# (initializeCommand) and the bind mount that lands the host's socket folder at ONE fixed
# endpoint, /run/bespunky/host/pulse/ — WSLg, native PulseAudio and PipeWire's pulse shim alike.
# On a host with no audio the probe mounts an empty dir instead, so the container still opens.
# So this step self-adapts on what actually ARRIVED: a socket in that folder means there is a
# speaker + mic to reach. When there is, install the free espeak-ng TTS floor (+ pulseaudio-utils
# for `paplay`) and pre-install the plugin, so `/speak` works the moment the container opens.
# Piper (the natural-voice upgrade) stays a manual, machine-local opt-in via the plugin's
# install-piper.sh — same stance as the claude-toolkit repo's own devcontainer. Best-effort +
# retry: a transient apt blip only warns, never aborts post-create (set -e) and leaves the
# container half-provisioned (same stance as every other best-effort step here).
# (`find -type s` rather than one fixed name: WSLg's own socket is called `PulseServer`, the
# others `native`. pactl isn't installed yet — this step installs it — so it can't be the probe.)
if [ -n "$(find /run/bespunky/host/pulse/ -maxdepth 1 -type s 2>/dev/null | head -n 1)" ]; then
  echo "[post-create] host audio socket detected (--voice) — provisioning bespunky-voice (espeak-ng + pulseaudio-utils)"
  voice_apt_ok=0
  for attempt in 1 2 3; do
    if sudo apt-get update && sudo apt-get install -y pulseaudio-utils espeak-ng; then
      voice_apt_ok=1; break
    fi
    if [ "$attempt" -lt 3 ]; then
      echo "[post-create] voice apt install attempt $attempt/3 failed (often transient Docker DNS); retrying in $((attempt * 10))s..."
      sleep $((attempt * 10))
    fi
  done
  if [ "$voice_apt_ok" = 1 ]; then
    echo "[post-create] voice engine ready (espeak-ng floor; run the plugin's install-piper.sh for the neural-voice upgrade)"
  else
    echo "[post-create] WARNING: voice engine install failed after 3 attempts — likely a transient network issue."
    echo "[post-create]          The container is otherwise ready; finish this one step once the network settles with:"
    echo "[post-create]            sudo apt-get update && sudo apt-get install -y pulseaudio-utils espeak-ng"
  fi
  # Pre-install the voice plugin at project scope so /speak is live on open. Best-effort:
  # the marketplace was added by the plugin pre-install; if that was offline, .claude/settings.json offers
  # install on first run. (The other house plugins are pre-installed by the plugin step;
  # bespunky-voice is gated here because without a host audio socket it can't play audio.)
  if claude plugin install bespunky-voice@claude-toolkit --scope project; then
    echo "[post-create] bespunky-voice plugin installed at project scope"
  else
    echo "[post-create] NOTE: bespunky-voice plugin install skipped (CLI offline?) — enable later with /plugin"
  fi
fi
