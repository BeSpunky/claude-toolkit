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
- [x] U1 map generator internals (Explore agent) — done; distillation below
- [x] U2 implement composer/generator/fragments
- [x] U3 tests (test-layers, test-generators)
- [x] U4 migration question (owned file keeps a stale `image`?)
- [x] U5 docs sweep (CLAUDE.md, README, HOUSE.md.tpl, skills, tips)
- [x] U6 dogfood: upgrade --local on this repo + hand switch; read whole diff
- [ ] U7 bump nx-tools + bespunky-house; invariants
- [ ] U8 user rebuild from development BEFORE promoting to main; observe

## U1 distillation (Explore agent) — and what it changed in the design
- The merge (owned 'assert' AND adopted 'adopt') NEVER removes a key: an owned devcontainer.json would keep a stale
  `image` next to the new `build` → **a migration (0.48.0) is owed**: drop the house-written `image` (houseWrote).
- Adopt mode ADDS any key the project lacks: a project with its own `image` would get `build` beside it → the composer
  must not emit `build` when the project declares its own image source (image/build/dockerFile/dockerComposeFile);
  report the one-line switch instead.
- A project may own `.devcontainer/Dockerfile` → the house file is `house.Dockerfile` (no collision, no parking logic).
- `adoptedImageUser` (generator.ts) treats `image === houseImage` as house → must also treat `build.dockerfile ===
  'house.Dockerfile'` as house.
- Voice has no osPackages; its piece runs its own socket-gated apt → packages move to the composed list (installed on
  voice INTENT, not on a socket — small, and a host fact can't key a cached build layer).
- Tests depending on post-create apt text: test-layers :541 :632 :651 :667, the `reclaimed` helper's cut marker
  ('\n# --- The OS packages' — keep that header so the cut stays meaningful), plus negative regexes :540 :613 :718.
- No test-generators devcontainer case; all coverage in test-layers.
- Docs to sweep: CLAUDE.md:61,63,152 · README.md:478,554,563,565 · skills/new/SKILL.md:27,66,152 · house.sh:25-27,1032 ·
  HOUSE.md.tpl:14 · header.sh.tpl:5 · firebase-banner.sh.tpl:2 · generator.ts:8,403 · descriptor.ts:290 · web.ts:117 ·
  this repo's post-create.local.sh:27,32.
- ONE installer, used by both the image build and post-create: `.devcontainer/os-packages.sh` (owned; the house list
  embedded, the project list `.devcontainer/os-packages.txt` seeded) installs only what is MISSING. Image build:
  everything (cached layer). post-create: a no-op in a house-built image; the install for an adopted image.
