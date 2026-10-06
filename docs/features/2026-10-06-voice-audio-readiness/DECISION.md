---
effort: voice-audio-readiness
summary: Voice readiness must check the audio link to the host, not just the engines — and say "voice is off for this project" instead of "no speech engine"
---

# Voice: the audio connection is judged first

## What happened (reported from a consumer project)

> "The voice setup told me it was 'ready' when it couldn't actually play or hear anything. Its check only confirms that the speech engines are installed. It never checks whether the container can reach your computer's audio … The first error also pointed at the wrong cause: it said 'no speech engine' when the real gap was the missing audio link. So it sent me to install engines, and that couldn't have helped."
> "the voice skill could have spotted that this project has voice turned off and said so straight away. Instead it took two failed attempts to find out."

The project's devcontainer was built without `--voice`, so there was no audio bridge.

## Root cause

- `speak.sh` / `listen.sh` checked the **engines before the audio endpoint** (speak.sh even tolerated a missing endpoint), so the first error named an engine.
- `voice-health.sh` / `install.sh` judged readiness from the engines alone, so the installer said `ready:`.
- The endpoint diagnosis listed generic fixes and never named the actual cause.

## Decision

Audio reachability is a first-class verdict, owned by `audio-endpoint.sh` (`voice_audio_verdict` → `ok | native | unreachable`), and:

- every voice tool checks it **before** any engine;
- `voice-health.sh` reports it as a third line (`audio`), the band warns *no audio connection*;
- `install.sh` exits **3 — not ready** when engines work but audio is unreachable; the installer agent maps that to `not ready:`;
- the diagnosis leads with the **cause**: in a container, the committed house marker (`.devcontainer/.bespunky-devcontainer.json` `"voice"`) says whether voice is off for the project (→ `/bespunky-house:upgrade --voice` + rebuild), on but the container predates it (→ rebuild), or the bridge is mounted but the host had no audio server (→ fix host sound, reopen);
- the skill and `/speak` never dispatch the installer for *no audio connection*.

Reading the house marker couples voice to house's committed record of intent; accepted deliberately — the plugin already names the house bridge path, and the marker is the one fact that says "voice is off for this project" rather than guessing.
