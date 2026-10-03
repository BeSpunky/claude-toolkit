---
description: Renamed — installs bespunky-house (this plugin's successor) and runs its upgrade on this project, which is what /sync became. Adding a layer is now /bespunky-house:add-layer.
argument-hint: "[--ensure=<layers>] [--preset=<id>] [--firebase] [--voice] [--staging] [--local] [--docker] [--no-backup]"
allowed-tools: Bash, Read
---

**`bespunky-project-starter` was renamed to `bespunky-house`**, and `/sync` with it: bringing a project current
is now `/bespunky-house:upgrade`, and `--ensure=<layers>` is now its own command, `/bespunky-house:add-layer
<layers>`. This plugin no longer carries an engine. What this file does is install the successor and hand the
run over to it — so the user's request (an upgrade of this project, explicitly asked for in this conversation,
which is what authorises the `--yes` the successor's step 4 passes) is honoured in this same run.

**Two ways in, one procedure.** Either the user ran `/bespunky-project-starter:sync` (or `/sync`) and you are
reading this from the top, or an older `/sync` sent you here: its step 2 found this file differed from its own
and told you to follow this one *from step 3 onward*. Either way, keep the user's original arguments — the
`$ARGUMENTS` of the command they actually ran — and keep the root of **this** plugin, called `$STUB` below:
`${CLAUDE_PLUGIN_ROOT}` when you invoked this command directly, or the `$PLUGIN_NOW` the older `/sync`
resolved when it sent you here.

## 1. Update the toolkit listing (entered from the top only)

```
claude plugin marketplace update claude-toolkit
claude plugin update bespunky-project-starter
```

Marketplace not configured, offline, or a step fails? Say so plainly. The marketplace is needed for step 3,
so stop there and offer `claude plugin marketplace add BeSpunky/claude-toolkit` — adding a marketplace is the
user's call.

## 2. Follow the newest copy of this file (entered from the top only)

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/installs.sh" "$PWD"
```

It lists, from `installed_plugins.json`, where this plugin and `bespunky-house` are installed for this project
(`<plugin-id> <scope> <version> <installPath>`, newest first). Take the newest `bespunky-project-starter` line's
path as `$STUB`; if its `commands/sync.md` differs from `${CLAUDE_PLUGIN_ROOT}/commands/sync.md`, read that one
and follow it from step 3 instead. Never fall back to a directory scan of the plugin cache.

## 3. Install `bespunky-house` at the scope the old plugin was installed at

```
bash "$STUB/scripts/installs.sh" "$PWD"
```

Read the `bespunky-project-starter` lines — these are the scopes this project gets it from — and install the
successor once for each, **unless a `bespunky-house` line already covers that scope** (then just
`claude plugin update bespunky-house`):

| old plugin's scope | install `bespunky-house` with | why |
| --- | --- | --- |
| `user` | `claude plugin install bespunky-house@claude-toolkit --scope user` | same scope |
| `local` | `claude plugin install bespunky-house@claude-toolkit --scope local` | same scope |
| `project` | `claude plugin install bespunky-house@claude-toolkit --scope local` | see below |

**Why `project` becomes `local` here.** A project-scope install writes `enabledPlugins` into the committed
`.claude/settings.json`, which would leave the tree dirty — and the upgrade refuses a dirty tree before it
writes anything. It would also be redundant: the upgrade's own migration renames
`bespunky-project-starter@claude-toolkit` to `bespunky-house@claude-toolkit` in that file, as a reviewable
commit that lands with the rest of the upgrade. So the machine gets the plugin now (`local`, this project, not
committed), and the team gets the project-scope switch through the upgrade. Say this in one line.

**No `bespunky-project-starter` line at all** (the record is unreadable, or the plugin is loaded some other
way) — ask the user which scope to install at; don't guess.

## 4. Resolve the installed `bespunky-house` root

Run that plugin's own resolver from the path `installs.sh` now reports for `bespunky-house` (re-run step 3's
command to see it):

```
PLUGIN_NOW="$(bash "<bespunky-house installPath>/scripts/resolve-plugin-root.sh" bespunky-house@claude-toolkit)" && echo "$PLUGIN_NOW"
```

It reads the same record and **exits non-zero rather than guess**; if it does, report what it printed and stop.

## 5. Hand over to the upgrade

Translate the user's original arguments, then **Read the resolved root's command file and follow it from its
step 3 onward**, with `$PLUGIN_NOW` set to the root step 4 printed and the translated arguments as its
`$ARGUMENTS`:

- **No `--ensure`, `--preset` or `--firebase`** → `$PLUGIN_NOW/commands/upgrade.md`, with the remaining flags
  unchanged.
- **`--ensure=<layers>`** → `$PLUGIN_NOW/commands/add-layer.md`, with `<layers>` as its layer list (plus
  `firebase` when `--firebase` was given) and every other flag, `--preset` included, unchanged.
- **`--preset` or `--firebase` without `--ensure`** → also `add-layer.md` (those flags add layers, which a
  plain upgrade no longer does); its step 0 says how a preset alone is passed. `--firebase` alone is the layer
  list `firebase`.

Say in one line that `/sync` is now `/bespunky-house:upgrade` (and, if it applies, that `--ensure` is now
`/bespunky-house:add-layer`), so the user knows what to type next time.

## 6. Afterwards

Once the upgrade has reported, tell the user they can remove the old plugin themselves — **never run it for
them**:

```
claude plugin uninstall bespunky-project-starter --scope <each scope it was installed at>
```

If it was installed at `project` scope, the uninstall is best left until the upgrade's commits have landed: the
migration has already moved `.claude/settings.json` to the new name, so nothing in the project will ask for the
old plugin again.
