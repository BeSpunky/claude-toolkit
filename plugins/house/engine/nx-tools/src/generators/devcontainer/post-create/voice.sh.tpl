# --- Voice: enable the plugin when host audio arrived (the --voice intent) ---
# The bespunky-voice plugin speaks (TTS) and listens (STT) through a PulseAudio-protocol socket.
# Voice is OPT-IN (scaffold with --voice): only then does the devcontainer carry the host probe
# (initializeCommand) and the bind mount that lands the host's socket folder at ONE fixed
# endpoint, /run/bespunky/host/pulse/ — WSLg, native PulseAudio and PipeWire's pulse shim alike.
# On a host with no audio the probe mounts an empty dir instead, so the container still opens.
# Its OS packages (espeak-ng, the free speech floor, and pulseaudio-utils for `paplay`) are in the composed package
# list — installed with the image, a cached layer — so this step only enables the plugin, and only when a socket
# actually ARRIVED in that folder: without a speaker and mic to reach, the plugin has nothing to do. Piper (the
# natural voice) and whisper are the plugin's own machine-local installs, kept in ~/.claude across rebuilds.
# (`find -type s` rather than one fixed name: WSLg's own socket is called `PulseServer`, the others `native`.)
if [ -n "$(find /run/bespunky/host/pulse/ -maxdepth 1 -type s 2>/dev/null | head -n 1)" ]; then
  echo "[post-create] host audio socket detected (--voice) — enabling bespunky-voice"
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
