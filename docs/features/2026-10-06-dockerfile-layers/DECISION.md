---
effort: dockerfile-layers
summary: House containers build from a generated Dockerfile so OS packages are cached Docker layers, and ~/.local is persisted, so a rebuild reinstalls nothing that has not changed.
---

# Rebuilds reinstall nothing that has not changed

> "Can we make it so voice and other things we install don't need reinstalling after rebuilds?" ·
> "Can we use a dockerfile to optimize our rebuilds by relying on docker layers?" ·
> "go ahead. be thorough and complete the job end to end" — the user

## What was actually reinstalled (observed, 2026-10-06)
Voice's engines were NOT — they already live in the persisted `~/.claude` (957 MB, healthy after a rebuild). Every
rebuild did redo: every OS package (post-create apt: tmux, curl; voice's espeak-ng + pulseaudio-utils; this repo's
alsa-utils + sox from post-create.local.sh) and Claude Code's native install (~/.local, 239 MB).

## Decisions
- **The container is BUILT from a generated `.devcontainer/house.Dockerfile`** (FROM the composed image) instead of
  pulling the image; the OS packages are ONE Docker layer, reused on every rebuild until a list changes.
- **One installer, two callers** — `.devcontainer/os-packages.sh` (owned; the house list embedded with each group's
  why) installs only what is MISSING. The image build: everything, cached. post-create: nothing in a house-built
  image; the install in an adopted image of the project's own. One source of truth, no mode flag.
- **The project's list is `.devcontainer/os-packages.txt`** — seeded once, never regenerated. Package names are
  validated before they reach a root apt-get.
- **Named `house.Dockerfile`**, so it can never collide with a project's own `Dockerfile`.
- **An adopted devcontainer with its own image source gets no second one** — `build` is recorded as skipped and the
  one-line switch is printed. The merge never removes keys, so **migration 0.48.0** removes a house-written `image`.
- **Voice's packages join the composed list**, installed on the voice INTENT (a host fact can't key a cached layer);
  its post-create piece keeps only the socket-gated plugin enable.
- **`~/.local` is a persisted volume**; Claude Code is deliberately NOT baked into the image — its auto-updater updates
  it in place, and a cached layer would hand back the build-day version (the 0.40–0.44 freeze, again).
- **Trade-off accepted**: a package install that fails persistently now fails the image build (loud) instead of
  warning in post-create (quiet, container missing tools).
- This repo (adopted) was switched to the house build by hand; alsa-utils + sox moved into its os-packages.txt.

## Verified
- test-layers (90), test-generators, test-scaffold, test-migrations (6 new 0.48.0 cases) green; the installer's
  behaviour tested against stubbed dpkg/apt (all-missing, all-present, partial, de-dup, hostile names, retry+fail).
- The real installer against this container's dpkg: "all present — nothing to install".
- Dogfood upgrade --local on this repo: migration left the project's own image (adopted) and said so; the generator
  wrote the image files, the ~/.local volume and the new post-create; a second run after the switch recognised the
  house build (nothing skipped) and left devcontainer.json unchanged.
- No Docker inside the container: the real image BUILD is verified by the user's rebuild, before promotion to main.

## Not covered (raised with the user)
- The `web` layer's `playwright install --with-deps` / `shared-browser install --with-deps` still apt-install
  Chromium's system libraries in post-create on every rebuild (the browser binary itself is already a cached volume).
  Moving them into the image needs Playwright's own dependency list at image-build time — a design choice.

## Pre-landing review (five read-only agents; ledger in handoffs/)

> "Send agents to sanity check, verify, critic and ensure the next project that upgrades gets the changes without a
> problem, and without losing any data" · "Send an agent to ensure there will be no residues on the next project
> upgrading. For example, an old devcontainer file, an old script, etc." — the user

Found and fixed before landing: a one-line/minified devcontainer.json emptied by the line-based member removal; the
house build missed under `./house.Dockerfile` / `dockerFile` (state silently retargeted to /root); a project's own
`house.Dockerfile` / `os-packages.sh` overwritten (→ marked-file freeness; the installer renamed `house.packages.sh`);
unsafe switch advice for a foreign image (→ only for the house-ref image; no house.Dockerfile or ~/.local over a
foreign image); CRLF lists dropped / a CRLF script failing the build (→ CR stripped, `.gitattributes` eol=lf); a
deleted list failing COPY (→ glob); a stale parked `post-create.bespunky.sh` running old apt first (→ removed);
project apt steps silently defeating the cache and losing their `apt-get update` (→ reported by the rung); an
always-on rule so agents put packages in os-packages.txt. Confirmed safe: no volume renamed — no saved data orphaned;
project keys, comments and files untouched in every shape; idempotent.
Left, with reasons: no `.dockerignore` (would break a project using .devcontainer/ as its own build context); comments
for keys an owned merge appends (pre-existing); Claude version pruning in ~/.local (unverified need); Playwright
`--with-deps` (open decision).
