# Plan — dockerfile-layers

> "Can we make it so voice and other things we install don't need reinstalling after rebuilds?" ·
> "Can we use a dockerfile to optimize our rebuilds by relying on docker layers?" ·
> "go ahead. be thorough and complete the job end to end" — the user

## Findings that shaped it (2026-10-06, this repo's rebuilt container)
- Voice ENGINES already persist (~/.claude/bespunky-voice, 957 MB, in the .claude/data bind) — health ok after rebuild.
- What a rebuild redoes: every OS package (apt in post-create: tmux curl; voice espeak-ng pulseaudio-utils; this
  repo's post-create.local.sh alsa-utils sox), and Claude Code's native install (~/.local, 239 MB, not persisted).

## Design (confirmed by the user)
1. Generator writes an OWNED `.devcontainer/Dockerfile`: FROM the composed image, then ONE apt layer installing
   `.devcontainer/os-packages.house.txt` (owned, composed from the layers' osPackages with their whys as comments)
   + `.devcontainer/os-packages.txt` (SEEDED, the project's own list). Docker caches the layer until a list changes.
2. devcontainer.json: `build: { dockerfile, context }` instead of `image` (owned). Adopted devcontainers keep their own
   `image`/`build` (never overwritten) — reported with how to switch.
3. post-create keeps ONE mode-agnostic step: install only the listed packages that are MISSING (dpkg). In a container
   built from the house Dockerfile it installs nothing; in an adopted image it installs as before. One source of
   truth (the two lists), no flag.
4. Voice's packages join the composed list (voice intent); its piece keeps only the socket-gated plugin install.
5. `~/.local` (XDG data/state/bin) persisted whole — one volume in `agent` (Claude Code stops re-downloading; it is NOT
   baked into the image: the auto-updater would be reset to the build-day version by a cached layer).
6. This repo (adopted): switch devcontainer.json to `build` by hand; move alsa-utils/sox into os-packages.txt.

## Units / status
- [ ] U1 map generator internals (Explore agent, read-only) — running
- [ ] U2 implement composer/generator/fragments
- [ ] U3 tests (test-layers, test-generators)
- [ ] U4 migration question (owned file keeps a stale `image`?)
- [ ] U5 docs sweep (CLAUDE.md, README, HOUSE.md.tpl, skills, tips)
- [ ] U6 dogfood: upgrade --local on this repo + hand switch; read whole diff
- [ ] U7 bump nx-tools + bespunky-house; invariants
- [ ] U8 user rebuild from development BEFORE promoting to main; observe
