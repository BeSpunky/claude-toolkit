---
status: concluded
concluded: 2026-10-01
summary: WSL is one host among many — a host probe aims a fixed audio mount at whatever socket exists (WSLg, PulseAudio, PipeWire) or an empty dir; voice resolves its endpoint by socket; migration 0.34.0 retires the /mnt/wslg bind; the scaffolder asks the engine (rootless?) who owns output.
tags: [devcontainer, voice, wsl, linux, nx-tools-0.34.0, migration, rootless-docker]
---

# Plain-Linux support — design 

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

## Confirmed — 2026-10-01
User, asked "Shall I go ahead and implement this design?": **"yes"**

### The shared contract (fixed before fan-out so every unit agrees)
- **Host probe**: generator-owned `.devcontainer/host-probe.sh`, run by `initializeCommand` (only when voice is on). On every open it (re)creates `.devcontainer/.host/pulse` as a **symlink to the host directory holding the socket** — first that exists of: dirname of `$PULSE_SERVER` (unix: form), `${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pulse`, `/mnt/wslg/runtime-dir/pulse`, `/mnt/wslg` — else an **empty real directory**. It also writes `.devcontainer/.host/host.env` (facts, for logs). `.devcontainer/.host/` is gitignored.
  - Why a symlink: devcontainer `${localEnv:…}` resolves BEFORE `initializeCommand`, so the probe cannot choose the mount source; it can only make a fixed source point somewhere real. A bind mount follows a symlinked source.
- **Mount**: `source=${localWorkspaceFolder}/.devcontainer/.host/pulse,target=/run/bespunky/host/pulse,type=bind`.
- **remoteEnv**: `PULSE_SERVER=unix:/run/bespunky/host/pulse/native` and `BESPUNKY_HOST_WSL_DISTRO=${localEnv:WSL_DISTRO_NAME}` (a host fact passed through; empty off WSL — consumed only by the voice gain default).
- **post-create** gates voice provisioning on a socket existing in `/run/bespunky/host/pulse/` (or `$PULSE_SERVER` answering), never on `/mnt/wslg`.
- **Voice resolver** `plugins/voice/scripts/audio-endpoint.sh`: verified `$PULSE_SERVER` → `/run/bespunky/host/pulse/{native,PulseServer}` → `/mnt/wslg/PulseServer` (containers not yet rebuilt) → `${XDG_RUNTIME_DIR:-/run/user/$UID}/pulse/native` (running directly on a Linux host) → error listing every path tried. Mic gain default 200% only when the endpoint came via WSLg (`BESPUNKY_HOST_WSL_DISTRO` non-empty, or the `/mnt/wslg` path), else 100%; `BESPUNKY_VOICE_MIC_GAIN` overrides.
- **Payload**: `@bespunky/nx-tools` 0.33.2 → **0.34.0**; migration `0.34.0/retire-wslg-audio-bridge`.

## Conclusion — 2026-10-01
Merged into `development` on the user's word: **"merge the feature branch into development then promote again"**. Real-host verification (rebuild + `/voice status` on plain Linux; WSL) was taken on by the user — "I'll do it" — and had not been reported at merge time. The untested points in the 2026-10-01T2015Z baton still stand.
