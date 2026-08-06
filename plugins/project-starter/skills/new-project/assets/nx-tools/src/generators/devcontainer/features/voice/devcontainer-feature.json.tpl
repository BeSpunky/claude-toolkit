{
  "id": "bespunky-voice",
  "version": "1.0.0",
  "name": "BeSpunky voice (WSLg audio)",
  "description": "Voice as ONE unit instead of two halves in two files. The bespunky-voice plugin speaks (TTS) and listens (STT) through a PulseAudio sink, which takes three things that must all be present or none of them are worth having: the apt engine (espeak-ng + pulseaudio-utils for paplay), the bind mount that exposes WSL2's WSLg PulseServer socket at /mnt/wslg, and PULSE_SERVER pointing at it. Those used to live apart — the mount and the env var hand-placed in devcontainer.json, the packages installed by post-create.sh — so nothing owned the capability and nothing could be added or removed in one move. This feature declares all three, so opting into voice is adding one line to `features`. BESPUNKY_VOICE=1 is the point of the containerEnv block: it is a DECLARATION that replaces an INFERENCE. post-create.sh currently detects voice by testing `[ -d /mnt/wslg ]` — guessing at the capability from a side effect of one host's mount, because it had no flag to read — which is both fragile (any /mnt/wslg on a non-voice container reads as voice) and mute about intent. With the flag exported by the feature itself, post-create gates on ${BESPUNKY_VOICE:-} and asks the question it actually means: was voice requested? WSL-specific, hence opt-in: on a non-WSL host (macOS, Codespaces) the /mnt/wslg bind has no source socket. install.sh is best-effort — a transient apt/DNS failure WARNS with the exact hand-recovery command and exits 0, because a non-zero exit here fails the whole container build and a container without a voice engine beats no container at all. Generator-owned (@bespunky/nx-tools:devcontainer) — regenerated on every scaffold.sh --sync; edit the template in the toolkit, not this copy.",
  "options": {},
  "mounts": [
    {
      "source": "/mnt/wslg",
      "target": "/mnt/wslg",
      "type": "bind"
    }
  ],
  "containerEnv": {
    "PULSE_SERVER": "unix:/mnt/wslg/PulseServer",
    "BESPUNKY_VOICE": "1"
  }
}
