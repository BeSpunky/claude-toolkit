---
effort: claude-update-path
status: concluded
concluded: 2026-10-04
summary: House devcontainers install Claude Code once, natively, with ~/.local/bin first on PATH — the claude-code feature's build-time copy had shadowed every `claude update`, freezing containers (and hiding the toolkit's mods); payload 0.40.0 migrates existing projects.
tags: [house, devcontainer, claude-code, path, migration, agent-layer]
---

# Claude Code in house devcontainers — one install, the one that updates

## The bug, as met

> "I upgraded a project to the latest toolkit version and its not picking up on the mods. Why?"

The toolkit was current on that machine (bespunky-workflow 0.10.2, marketplace at `87bd036`); Claude Code was
2.1.266, too old to load the mods. `claude update` reported success every time and changed nothing:

> "It doesn't seem to update"

Root cause, reproduced in this repo's own container: TWO Claude Code installs.

| Copy | Put there by | PATH position |
| --- | --- | --- |
| `/usr/local/bin/claude` | the `ghcr.io/devcontainers-extra/features/claude-code` feature (agent layer), at build | early — wins |
| `~/.local/bin/claude` | `claude update` / the native auto-updater | last — never runs |

Every update lands in the shadowed copy. The build-time copy is frozen at whatever version the image was built
with, so every house project silently pins Claude Code until the container is rebuilt — and hides every
Claude Code feature the toolkit depends on (here: mods).

## Design — confirmed

> "yes, go ahead"

1. **One install, owned by the house.** Drop the third-party feature; install natively for the remote user
   (`claude.ai/install.sh`) as an agent-layer post-create piece in `prepare` — before `plugins`, which needs
   the CLI. The native install is exactly what `claude update` and the background auto-updater manage, so the
   project stays current with nobody running anything.
2. **`~/.local/bin` first on PATH**, so the managed copy wins over any other `claude` an image or a user's own
   feature brings (and over the leftover feature in an *adopted* devcontainer, which the additive merge never
   removes).
3. **Model the missing concept: PATH entries.** `node` already sets `remoteEnv.PATH`; a second layer setting
   `PATH` would collide in the composer. Fragments contribute `path: [...]` prepends; the composer emits ONE
   `PATH` = all prepends (registry order) + `${containerEnv:PATH}`. `node`'s `node_modules/.bin` moves to it.

Migrations: the devcontainer is an owned template artifact (class A), regenerated on every upgrade — nothing
to migrate for owned ones. Adopted ones keep the old feature (removing it is a guess — the project may have
added it itself); point 2 makes it harmless, and the generator reports it.

## Found while building

- **The migration was owed after all.** The first draft said "owned artifact, nothing to migrate" — wrong: the
  devcontainer generator merges IN PLACE on owned devcontainers too and never removes a key it stopped
  rendering, so the feature would have stayed in every existing project. Payload 0.40.0 ships
  `retire-claude-code-feature`: removes the feature (and the house comment above it) when owned, reports it when
  adopted, and retargets the one `remoteEnv.PATH` value the house ever wrote — on both paths, since the adopted
  merge would otherwise keep the old PATH forever.
- **The removal is a text cut, not `jsonc-parser` `modify`**: `modify(…, undefined)` re-serializes the
  neighbouring member (`{ "version": "22" }` came back over three lines) — caught by the fixture.
- **`${containerEnv:HOME}`, not the `{{home}}` token**, in the PATH entry: it follows whatever user an adopted
  image really runs as, and the migration can write the same value without knowing the user.
- The native install runs in the `install` phase, not `prepare`: it needs curl, which the OS-package step brings.

## Shipped

bespunky-house 0.41.0, @bespunky/nx-tools 0.40.0 (CI publishes on the push to main). A consumer gets it with
`/bespunky-house:upgrade` + a container rebuild. This repo's own devcontainer is ADOPTED, so its upgrade will
retarget PATH and *report* the feature rather than remove it.
