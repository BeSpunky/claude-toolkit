# Spike: audio boundary for `bespunky-voice`

**Question this spike answers (and nothing else):** can a process *inside this
devcontainer* both **speak to your speakers** and **hear your mic**? Every tier
of the planned voice plugin depends on a yes. If audio can't cross the container
boundary, no amount of clever plugin code matters — so we prove it first.

This is throwaway R&D, not product. Delete `spikes/` once the boundary is
settled and the finding is folded into the plugin's devcontainer requirements.

**Retained on purpose (as of 2026-07-19):** the *output* half is settled and
folded into `.devcontainer/`, but the *mic input* half is NOT — WSLg delivers a
silent `RDPSource`, and `probe-audio.sh` is the live test harness for fixing that
(the gate for answering-by-voice). Bin this whole folder once the mic path works
or is abandoned.

## Run it

```bash
bash spikes/voice-audio-boundary/probe-audio.sh            # diagnose + test
bash spikes/voice-audio-boundary/probe-audio.sh --install  # first apt-get audio tools
```

On a **stock devcontainer it will say FAIL** — that's correct. The container
ships with no audio socket, no `/dev/snd`, and no audio tools (verified). The
fix is at the devcontainer layer, below.

## The fix to try — bridge WSLg audio into the container

WSL2 already runs a PulseAudio server (via WSLg) that owns your real speaker and
mic. The container just can't see its socket. Mount it in and point PulseAudio
at it.

Edit `.devcontainer/devcontainer.json`:

```jsonc
  // add PULSE_SERVER alongside the existing CLAUDE_CODE_BYPASS_ALL_PERMISSIONS
  "remoteEnv": {
    "CLAUDE_CODE_BYPASS_ALL_PERMISSIONS": "1",
    "PULSE_SERVER": "unix:/mnt/wslg/PulseServer"
  },

  // add the WSLg mount to the existing "mounts" array
  "mounts": [
    "source=${localWorkspaceFolder}/.claude/data,target=/home/node/.claude,type=bind,consistency=cached",
    "source=/mnt/wslg,target=/mnt/wslg,type=bind"
  ]
```

Then **rebuild the container** and run `probe-audio.sh --install`.

### If the socket still isn't there after rebuild

The mount *source* depends on how Docker sees the WSL host:

- **Docker running natively inside your WSL distro:** `source=/mnt/wslg` (above).
- **Docker Desktop (WSL2 backend):** the host is exposed under
  `/run/desktop/mnt/host`, so try
  `source=/run/desktop/mnt/host/wslg,target=/mnt/wslg,type=bind` instead.

Rebuild and re-run the spike after each variant. The spike auto-probes several
socket paths (`/mnt/wslg/PulseServer`, the XDG runtime socket, `/tmp/pulse/...`),
so once *any* of them is reachable it will find it and flip to PASS/PARTIAL.

### To make it stick across rebuilds

Once a variant passes, add the tool install to `.devcontainer/post-create.sh` so
you don't need `--install` every rebuild:

```bash
sudo apt-get update -qq && sudo apt-get install -y -qq pulseaudio-utils espeak-ng alsa-utils sox
```

## Reading the verdict

- **PASS** — speaker + mic both cross. All three plugin tiers are buildable.
- **PARTIAL** — speaker only. Auto-speak (hook) and "read me the question"
  (command) are buildable now; voice-*answer* (the mic half) needs more work.
- **FAIL** — nothing bridged yet. Apply the patch above and rebuild.

## What the free-tier stack proves

`espeak-ng` (robotic TTS) and raw `parecord` are deliberately the *floor* — if
they cross the boundary, so will a cloud voice and a real speech-to-text engine
later, because they sit behind the same socket. The spike tests the **boundary**,
not the eventual voice quality (your "start free, allow upgrade" choice lives
above this line).
