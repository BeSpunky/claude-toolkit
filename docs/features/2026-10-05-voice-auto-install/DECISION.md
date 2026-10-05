---
effort: voice-auto-install
status: concluded
concluded: 2026-10-05
summary: Voice sets itself up — Claude runs scripts/install.sh when an engine is missing instead of telling the user to install it
tags: [voice, install, dx]
---

# Voice sets itself up

The user, after `/bespunky-voice:voice-conversation` answered with install instructions:

> The skill should install what's needed without asking

## Decision

- **One front door, `scripts/install.sh [speak] [listen]`.** It judges each half by the runtime's own health
  verdict (`voice-health.sh`) and installs only what fails: Piper (the espeak-ng floor only if Piper can't
  install), whisper.cpp via `install-whisper.sh`, and `parecord`/`sox`/a player/cmake through apt.
- **apt only through `sudo -n`** — Claude's shell has no TTY, so a password prompt would hang or fail
  unreadably; without passwordless sudo it names the package instead.
- **The skill and `/speak` run it themselves, without asking**, then retry. Every repair message the scripts
  print now names `install.sh`, so whatever reaches Claude points at the same door.
- **Not a SessionStart hook.** It downloads and builds for a minute or more; hooks detect, they don't execute.
- **The audio endpoint stays the human's** — it's a host fact no installer inside the container can create.

Verified from an empty `$HOME` in this container: speak half 17 s, listen half 55 s, both verdicts healthy.
