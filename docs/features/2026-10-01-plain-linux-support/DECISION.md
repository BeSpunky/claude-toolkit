# Plain-Linux support — design (DRAFT, awaiting confirmation)

## What the audit found
Only **one mechanism** is genuinely WSL-bound: the voice **audio bridge**. Everything else is wording.
- The bridge bind-mounts `/mnt/wslg`. Docker's `--mount` refuses a missing source, so off WSL the container **does not start**.
- This repo's own `.devcontainer/devcontainer.json` carries that mount **unconditionally**.
- In generated projects it is behind `--voice`, but `voice: true` is committed in `.bespunky-devcontainer.json`, so a machine fact (this host has WSLg) became a repo fact that breaks any teammate on another host.
- `post-create.sh` gates voice provisioning on `[ -d /mnt/wslg ]`; the voice scripts trust an ambient `PULSE_SERVER`; `listen.sh` always boosts the mic to 200% (tuned for WSLg's quiet mic — clips elsewhere).
- Side finding (not WSL, but host-shaped): `scaffold.sh` / `extract-tool.sh` `chown` after `docker run`, which is wrong under rootless Docker/Podman.

## The concept that was missing
**`voice` means "this project wants audio" — intent, host-neutral.** *Where the audio socket is* is a per-machine fact, resolved at container-open time on the host, never committed.

1. **Host probe** — a generator-owned `.devcontainer/host-probe.sh`, run by `initializeCommand` (on the host, every open). It finds the host's PulseAudio-protocol socket by *existence*, not by "is this WSL": `$PULSE_SERVER` → `$XDG_RUNTIME_DIR/pulse/native` (PulseAudio or PipeWire-pulse) → `/mnt/wslg/PulseServer`. It always leaves a valid bind source behind (an empty dir when there is no socket), so the mount can never fail on any host. Output is gitignored and machine-local.
2. **One fixed in-container endpoint** — the bridge always lands at `/run/bespunky/host/pulse/…`; `PULSE_SERVER` is the same constant everywhere.
3. **post-create gates on the socket being present**, not on `/mnt/wslg`.
4. **Voice scripts share one resolver** (`scripts/audio-endpoint.sh`) used by `speak.sh`, `listen.sh`, `/voice status`; mic gain becomes a property of the endpoint (boost only for WSLg; `BESPUNKY_VOICE_MIC_GAIN` still overrides).
5. **Engine probe** (rootful vs rootless Docker) shared by `scaffold.sh` and `extract-tool.sh` decides the `chown`.

## Delivery
- Generator changes (class A artifacts — every sync regenerates them for owned devcontainers).
- **Migration owed** for *adopted* devcontainers (`owned: false`) with `voice: true`: the additive merge matches mounts by target, so the old `/mnt/wslg` bind would survive beside the new one. The rung removes exactly the house-written `/mnt/wslg` mount + `PULSE_SERVER` value, reports any variant it didn't write. Payload bump + fixture case.
- This repo's own devcontainer is hand-written → fixed by hand here.
- Wording sweep: README, new-project SKILL (invocation as a per-host table, WSL one row), registry/serve-options/color comments, plugin descriptions, shared-browser Approach A.
- Releases: project-starter, voice, browser-automation (+ any other plugin touched), nx-tools payload.

## Not verifiable in this environment
No WSL box and no host audio here: socket paths (notably WSLg's `XDG_RUNTIME_DIR` contents), PulseAudio cookie / uid-match needs, and the "100% gain off WSLg" default are reasoned, not tested.
