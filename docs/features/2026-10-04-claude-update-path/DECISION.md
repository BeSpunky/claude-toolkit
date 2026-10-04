---
effort: claude-update-path
summary: In house devcontainers, `claude update` installs a binary that never runs (the devcontainer feature's copy shadows it on PATH) — make the updated one the one that runs.
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

## Proposed design (awaiting confirmation)

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
