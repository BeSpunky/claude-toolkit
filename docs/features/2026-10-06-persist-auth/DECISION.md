---
effort: persist-auth
summary: House containers keep Claude, gh and git logins across rebuilds, so a rebuild never asks you to log in again.
---

# Logins survive a container rebuild

> "Our gh, git, claude and other tool auth data don't survive our containers' rebuild. Make it so I can rebuild
> without reauthenticating each time" — the user

## What was actually lost (observed in this repo's container, 2026-10-06)

- **Claude** — `~/.claude` was already a persisted bind mount (`.claude/data`), and `.credentials.json` survived in it.
  The **account record `~/.claude.json` sits BESIDE the config dir**, in the container-local `$HOME`, so it died with
  every container. Confirmed: with `CLAUDE_CONFIG_DIR` set, Claude Code 2.1.291 writes `.claude.json` *inside* it.
- **gh** — `~/.config/gh` (hosts.yml) was not mounted at all.
- **git** — authenticates through `gh auth git-credential` (written into `~/.gitconfig` by `gh auth setup-git`), and
  `~/.gitconfig` is container-local too. Identity is repo-local here, so not affected.

## Decisions

- **Fixed in the generator (agent layer), not by hand in this repo** — every house container had the same hole.
- `CLAUDE_CONFIG_DIR={{home}}/.claude` as **containerEnv**, not remoteEnv: shells opened from outside (`docker exec`,
  the durable tmux sessions) never see remoteEnv, and a Claude started there would have used a different account file.
- A `prepare` post-create piece **restores `.claude.json` from Claude Code's own `backups/`** when missing — so the
  first rebuild after this change (whose record lived in the dead container) needs no login either. Never overwrites.
- A `provision` piece runs `gh auth setup-git` on every create when gh is logged in (`~/.gitconfig` stays
  container-local: VS Code rewrites it on every start, so it cannot be the persisted home of the wiring).

### Revised: one entrypoint, not one mount per tool

The first cut gave gh, firebase and gcloud a volume each. The user asked for the reduction:

> "As much possible, abstract and reduce the solution to single entrypoints. If the fix for multiple CLIs includes
> multiple files/folders in the same directory, treat that directory instead, unless that directory shouldn't be
> retained by itself. The point is, reduce specificity if possible"

So **`~/.config` (XDG config home — meant to be retained) is ONE per-project volume** in the agent layer; every tool
that logs in there persists with no per-tool declaration, and the firebase layer contributes nothing for it.

Offered: fold Claude into it too (`CLAUDE_CONFIG_DIR=~/.config/claude`, a single mount for everything, `.claude/data`
copied in on the first rebuild and retired). The user asked whether data would be lost (no — copied, then removed only
on success) and chose to keep Claude's host folder: **"B"**. So Claude stays on its `.claude/data` bind (a plain host
folder that survives a Docker volume prune), and there are exactly two persisted entrypoints: Claude's dir and `~/.config`.

- **Nothing to migrate**: the devcontainer is regenerated (owned) or additively merged (adopted) on every upgrade —
  the dogfood upgrade on this repo's adopted devcontainer added everything with no migration.

## Left as is

- The `gh` login itself cannot carry over this one time: the new `~/.config` volume starts from the image's, so `gh auth login` once after
  the first rebuild. (Copying the current token into the persisted dir was declined by the permission guard.)
- `publish.sh --dry-run` was blocked by the permission guard in-session; CI runs the real publish on `main`.
