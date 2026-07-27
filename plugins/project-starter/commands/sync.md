---
description: Bring this project up to the current house standard — update the claude-toolkit plugins, then run the layered sync on this repo.
argument-hint: "[--ensure=<layers>] [--firebase] [--voice]"
allowed-tools: Bash
---

The user ran `/sync $ARGUMENTS`, which means **they have explicitly asked for this sync, in this
conversation, right now**. That matters for step 3 — it is the one thing that authorises `--yes`.

Do these in order, stopping at the first that genuinely fails.

## 1. Update the toolkit

The sync applies whatever generators are **on disk**, so updating first is what makes it a sync to the
*current* standard rather than to the copy this machine happens to have.

```
claude plugin marketplace update claude-toolkit
```

- Not configured here (the command errors saying so)? Say so and offer
  `claude plugin marketplace add BeSpunky/claude-toolkit`, then stop — adding a marketplace is the user's
  call, not yours.
- Offline or the update fails? Say so plainly and **ask whether to sync anyway** with the version already
  installed. Do not decide that for them: syncing from a stale toolkit is a legitimate choice, but it is
  theirs, and it quietly writes an older stamp into the project.

The plugin FILES are now current, which is what the sync reads. This *session's* loaded skills may still be
the old ones — that only matters if the user is about to rely on changed skill text, so mention
`/reload-plugins` only if the update actually reported a new version.

## 2. Locate the scaffolder

```
ls "${CLAUDE_PLUGIN_ROOT}/skills/new-project/assets/scaffold.sh"
```

If that path doesn't resolve, find it before guessing:
`find ~/.claude -path '*project-starter*/assets/scaffold.sh' 2>/dev/null | head -1`.

## 3. Run the sync

```
bash "${CLAUDE_PLUGIN_ROOT}/skills/new-project/assets/scaffold.sh" --sync --yes $ARGUMENTS .
```

**About `--yes`.** The sync refuses to run unattended because it rewrites generated files, and your shell
has no TTY to ask through. `--yes` asserts a human explicitly agreed *in this conversation* — which is
exactly what invoking `/sync` is. **This is the only situation in which you may pass it.** Never carry that
reasoning to a sync you decided to run yourself, one suggested by the SessionStart hook, or one in a
scripted or headless run.

**Do not add `--no-backup`.** The sync tags a restore point first; that is the safety net for a command
that rewrites files.

**Pass `$ARGUMENTS` through, and add nothing of your own.** In particular do not invent `--ensure`:
ensuring a layer CREATES capability the project did not ask for.

## 4. Handle the two outcomes that aren't plain success

- **"not an Nx workspace (no nx.json)"** — expected on a repo that has never had house tooling. Relay it and
  **offer** `/sync --ensure=agent`, explaining what that does: creates an Nx workspace in place and applies
  the stack-agnostic DX layer (devcontainer, Claude settings, window identity, `HOUSE.md`) — no framework
  opinion, but it does add `nx.json`, a root `package.json`, a lockfile and `node_modules`. Wait for a yes.

- **`--sync cannot ENSURE the '<layer>' layer`** — relay the message verbatim. It already names the native
  command to add that layer, after which a plain sync detects it. Don't work around it.

## 5. Report

On `SYNC_OK`, summarise from the output, not from assumption:

- the layers it reported active, and the package manager it detected;
- whether `.devcontainer/*` changed — if so, tell the user to run **Dev Containers: Rebuild Container**, and
  **never attempt the rebuild yourself**;
- if it printed an `[devcontainer] Adopted the existing …` line, read `.devcontainer/.bespunky-devcontainer.json`
  and tell them which keys were left as theirs — that is the divergence the sync will never fix on its own;
- the backup ref from the `BACKUP_OK` line, so they know how to undo it.
