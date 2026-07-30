---
description: Bring this project up to the current house standard — update the claude-toolkit plugins, then run the layered sync on this repo.
argument-hint: "[--ensure=<layers>] [--firebase] [--voice] [--staging] [--local] [--docker] [--no-backup]"
allowed-tools: Bash, Read
---

The user ran `/sync $ARGUMENTS`, which means **they have explicitly asked for this sync, in this
conversation, right now**. That matters for step 3 — it is the one thing that authorises `--yes`.

Do these in order, stopping at the first that genuinely fails.

## 1. Update the toolkit — BOTH steps, and they are not the same thing

The generators come from **npm** (`@bespunky/nx-tools`). What lives on disk in the plugin is the **version
number** the sync installs and migrates to, plus the `scaffold.sh` that drives the sequence. Updating first is
what raises that target: without it the sync faithfully installs and migrates to whatever version this
machine's plugin still names, and stamps the project with it.

**Updating the marketplace is not updating the plugin.** `marketplace update` refreshes the *listing*; the
installed plugin stays where it was, and `${CLAUDE_PLUGIN_ROOT}` keeps pointing at the old cached version. A
sync run in that state executes an OLDER scaffolder — which, on a project that is already current, walks it
BACKWARDS: an older stamp, an older dependency, and none of the guards that exist to prevent exactly that.
So run both:

```
claude plugin marketplace update claude-toolkit
claude plugin update bespunky-project-starter
```

- Marketplace not configured here (the command errors saying so)? Say so and offer
  `claude plugin marketplace add BeSpunky/claude-toolkit`, then stop — adding a marketplace is the user's
  call, not yours.
- Offline or either step fails? Say so plainly and **ask whether to sync anyway** with the version already
  installed. Do not decide that for them: syncing from a stale toolkit is a legitimate choice, but it is
  theirs, and it quietly writes an older stamp into the project.

**If `claude plugin update` reports a NEW version, STOP and ask the user to restart Claude Code.** The CLI
says so itself — *"restart required to apply"* — and it matters here more than usual: `${CLAUDE_PLUGIN_ROOT}`
is fixed for the life of this session, so every path below would still run the version you just replaced.
Continuing is the case that produced a silent downgrade. Tell them what was updated, that a restart is needed
for it to take effect, and that `/sync` will pick it up next session. Do not work around this by hunting for
the new version's directory yourself.

If it reports that the plugin is already up to date, carry on — nothing moved, and this session's plugin root
is the current one.

## 2. Locate the scaffolder, and check it is the one you just updated to

```
ls "${CLAUDE_PLUGIN_ROOT}/skills/new-project/assets/scaffold.sh"
grep -m1 '"version"' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
```

Compare that version against what `claude plugin list` reports as installed. They should match. **If the
plugin root is older, stop** — you are about to run a scaffolder the update above was meant to replace, and
that is the downgrade path. Report both versions and ask the user to restart.

If the path doesn't resolve at all, find it — but sort, don't guess:

```
find ~/.claude -path '*project-starter*/assets/scaffold.sh' 2>/dev/null | sort -V | tail -1
```

An unsorted `head -1` picks an arbitrary cached version — on a machine with several, that has handed back a
scaffolder ten releases old.

## 3. Run the sync

```
bash "${CLAUDE_PLUGIN_ROOT}/skills/new-project/assets/scaffold.sh" --sync --yes $ARGUMENTS .
```

**The trailing `.` is the target, and only flags may come before it.** `scaffold.sh` takes flags first and
positionals last, so the first non-flag token it sees *is* the project path. Read what `$ARGUMENTS` actually
expanded to above **before you run this**: if any token there does not start with `--`, that token lands in
the project slot, the `.` behind it is silently absorbed as an *app name*, and the sync runs against a
different repo than the one this command promises. In that case **do not run it** — say what happened, and
point at the raw script (the `bespunky-project-starter:new-project` skill, §1a) for syncing a project other
than this one. Never reorder the `.` to the front either: a flag after the path is rejected outright.

**About `--yes`.** The sync refuses to run unattended because it rewrites generated files, and your shell
has no TTY to ask through. `--yes` asserts a human explicitly agreed *in this conversation* — which is
exactly what invoking `/sync` is. **This is the only situation in which you may pass it.** Never carry that
reasoning to a sync you decided to run yourself, one suggested by the SessionStart hook, or one in a
scripted or headless run.

**Do not add `--no-backup`.** The sync tags a restore point first; that is the safety net for a command
that rewrites files.

**Pass `$ARGUMENTS` through, and add nothing of your own.** In particular do not invent `--ensure`:
ensuring a layer CREATES capability the project did not ask for.

## 4. Handle the outcomes that aren't plain success

### The `[migrate]` line — read it, it is the most consequential thing the sync prints

Before any generator runs, the sync hands `nx migrate` the house tooling's **versioned one-way migrations**
(see the `new-project` skill, §1d). It works out where the project actually is with a **probe** taken before
anything is written — the older of the version installed in `node_modules` and the one stamped in `HOUSE.md`
— and passes that as an explicit `--from`. Exactly one `[migrate]` outcome line appears. **Match it by
meaning, not by its exact wording** (it is prose, and it gets tuned):

- **the ladder ran**, naming the two versions it walked between. **Relay this loudly.** These are one-way
  deltas, not idempotent re-assertions: they rewrite **every project in the workspace**, not just the one app
  the per-app generators target, and there is no reverse. Name the two versions and point at the backup ref
  from `BACKUP_OK`, because that tag is the only way back.
- **the baseline line**, saying the toolkit was not installed here before this run — normal on a first
  retrofit. There is no applied version to migrate *from*; the project is simply being brought to baseline.
- **the steady-state line**, saying the project is already at the version being installed, so there is
  nothing to run — the ordinary case.

A **fourth** `[migrate]` line may accompany the first: when the installed version and the `HOUSE.md` stamp
disagree, the sync reports both and says which it migrated from. Relay it — that disagreement is the
caret-float case (a plain install floated `node_modules` ahead with no migration behind it), and the line is
the proof the ladder was run from the honest floor rather than silently skipped.

**Migrations land as commits, one per migration** (`chore: [nx migration] <name>`), preceded by a
`checkpoint before running migrations` commit. So `git log --oneline` after a migrating sync is the honest
account of what changed, and a single bad migration can be reverted on its own rather than unpicked out of
one large diff. Two consequences worth relaying:

- Every one of those commits is built with `git add -A`, and the **checkpoint** commit is the first of them —
  created *before* any migration runs. So **work that was uncommitted when the sync started ends up committed,
  in that checkpoint**, cleanly separated from the migration commits that follow rather than tangled into the
  first one. The sync warns before it happens, and the backup tag is how to lift that work back out
  (`git -C . diff <backup-ref>`) if it needs to go back to being uncommitted.
- On a repo with no git, the sync says so and runs the migrations **without** commits rather than failing —
  `--create-commits` is a hard error outside a repository.
- **If `node_modules` is not git-ignored, the sync also drops the commits** and says so. That same `git add -A`
  would otherwise commit thousands of vendored files as a side effect of a version bump, which is far worse
  than losing the per-migration granularity. This fires on exactly the repos `--ensure=agent` exists to
  retrofit. Relay it and suggest adding `node_modules` to `.gitignore` — the migrations still ran; only the
  commit ladder was skipped, so `git diff` is the record for this run instead of `git log`.

Do not offer to squash, amend or reword these commits unless the user asks. They are the record.

**If a migration fails mid-ladder, STOP.** Do not re-run the sync to "get past it": the package.json bump and
the install have already happened, the project is half-migrated, and Nx leaves its `migrations.json` sitting
in the workspace root. Re-running restarts the ladder against a tree that is partly through it. Surface the
failing migration's name, the backup ref, and the leftover `migrations.json`, and let the user decide between
fixing forward and restoring from the tag.

### The rest

- **An `ERROR` saying this project has been on house tooling NEWER than this checkout's version** — the sync
  **refused before installing anything**, which is the last moment nothing had been touched. The probe found
  the project (in `node_modules`, or in the `HOUSE.md` stamp — the message names both) above the version this
  machine's plugin carries: a teammate synced from a newer toolkit, or step 1's update didn't land. Continuing
  would install a **downgrade**, run older generators over a newer shape, and re-stamp `HOUSE.md` backwards —
  and since migrations do not walk backwards there is no repair path. Relay it, and check that step 1 actually
  updated the plugin (if it reported nothing new, this machine is genuinely the older one — say so plainly).
  **There is no flag to override this, by design; don't look for one.**

- **`BACKUP_ABORT: … is not a git repository`** — very common on a first retrofit. The sync **refused to
  change anything** rather than rewrite files with no restore point. Relay the two ways out it printed:
  `git init && git add -A && git commit` in the project, or `--no-backup`. Prefer the first, and only pass
  `--no-backup` if the user asks for it — see the rule above.

- **`BACKUP_ABORT: could not create the git snapshot`** — same refusal, different cause (a broken or
  unwritable repo state). Relay it; don't retry with `--no-backup` on your own initiative.

- **"not an Nx workspace (no nx.json)"** — expected on a repo that has never had house tooling. Relay it and
  **offer** `/sync --ensure=agent`, explaining what that does: creates an Nx workspace in place and applies
  the stack-agnostic DX layer (devcontainer, Claude settings, window identity, `HOUSE.rules.md` + `HOUSE.md`) — no framework
  opinion, but it does add `nx.json`, a root `package.json`, a lockfile and `node_modules`. Wait for a yes.

- **`--sync cannot ENSURE the '<layer>' layer`** — relay the message verbatim. It already names the native
  command to add that layer, after which a plain sync detects it. Don't work around it.

- **`ERROR: node_modules/.bin/nx not found`** — the project's dependencies were never installed (a fresh
  clone). Relay the install command the message names, and offer to re-run the sync after it. The sync needs
  the workspace's own `nx` both to migrate and to generate; there is nothing to work around.

- **`ERROR: could not read this workspace layers`** — the layer registry failed to load, so the sync stopped
  rather than guess. This is a **refusal, not a crash**: a failed detection is indistinguishable from an empty
  project, and continuing would skip the house tooling for every layer the project actually has. Relay it as a
  toolkit-side fault (usually a broken or partial `node_modules/@bespunky/nx-tools`); a reinstall and re-run is
  the fix, not a different flag.

## 5. Report

On `SYNC_OK`, summarise from the output, not from assumption:

- **whether migrations ran** (the `[migrate]` line) and between which versions — first, because it's the only
  irreversible part;
- the layers it reported active, and the package manager it detected;
- whether `.devcontainer/*` changed — if so, tell the user to run **Dev Containers: Rebuild Container**, and
  **never attempt the rebuild yourself**;
- if it printed an `[devcontainer] Adopted the existing …` line, read `.devcontainer/.bespunky-devcontainer.json`
  and tell them which keys were left as theirs — that is the divergence the sync will never fix on its own;
- the backup ref from the `BACKUP_OK` line, so they know how to undo it.
