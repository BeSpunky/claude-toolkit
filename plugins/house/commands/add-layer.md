---
description: Add a house layer to this project (agent, node, js, web, firebase, …) — an upgrade that also brings the named layers into being. Updates the claude-toolkit plugins first.
argument-hint: "<layers> [--preset=<id>] [--firebase] [--voice] [--staging] [--local] [--docker] [--no-backup]"
allowed-tools: Bash, Read
---

The user ran `/bespunky-house:add-layer $ARGUMENTS`, which means **they have explicitly asked, in this
conversation, right now, for these layers to be added to this project** — and that is the one thing that
authorises `--yes` in the command below.

**Adding a layer is an upgrade that CREATES capability.** It does everything `/bespunky-house:upgrade` does —
update the toolkit, migrate the project to the current version, regenerate the house files of every layer it
wears — and on top of that brings the named layers into being (closed under `requires`, so a layer's
prerequisites come with it and are announced). That is why it is its own command: refreshing the house tooling
and turning someone's library into a Node workspace or a Firebase app are different requests. **Add exactly
the layers the user named — never one of your own, never a "while we're at it".**

## 0. Check the arguments before anything else

The **first** argument is the layer list: comma-separated layer ids, no spaces, no leading `--` (for example
`agent`, `firebase`, `node,js`). Everything after it is a flag. If the first argument is missing, or starts with
`--`, or is not a comma-separated list of lowercase ids, **stop and ask** which layers they want — say what each
command does: `/bespunky-house:upgrade` brings the project current and adds nothing;
`/bespunky-house:add-layer <layers>` also adds layers. Don't guess a layer from context.

- `--preset=<id>` is a named layer set and is accepted here (it unions with the list). `--firebase` is the
  same as putting `firebase` in the list.
- Which layers can be added this way, and which have to be brought in by their own native command first, is the
  engine's knowledge, not this file's: `bash "$PLUGIN_NOW/engine/house.sh" help` lists them (once step 2 below
  has resolved `$PLUGIN_NOW` — the engine of the toolkit you are about to run, not the one this session
  started with). When the engine refuses a layer it cannot add, it names the native command — relay it
  verbatim (see `upgrade.md`, *The rest*).
- If the user gave only a `--preset` and no list, read the engine's `help` for how `add-layer` takes a preset
  alone, and follow it; do not make up a list.

## 1–6. Follow the upgrade procedure, with one different command

**Read `${CLAUDE_PLUGIN_ROOT}/commands/upgrade.md` and follow it from step 1**, with these differences:

- **Step 2's self-check** diffs this file as well:
  `diff -q "${CLAUDE_PLUGIN_ROOT}/commands/add-layer.md" "$PLUGIN_NOW/commands/add-layer.md"`. If either file
  differs, read the `$PLUGIN_NOW` copies of **both** — this one first — and follow those from step 3 onward.
- **Step 3** is unchanged (an added layer is a change like any other, and runs in the same worktree an upgrade
  would).
- **Step 4 runs `add-layer` instead of `upgrade`.** Flags come before positionals, and the layer list is the
  first positional, so the flags from `$ARGUMENTS` go before it and the trailing `.` stays last:

  ```
  NX_DAEMON=false NX_WORKSPACE_ROOT_PATH="$PWD" bash "$PLUGIN_NOW/engine/house.sh" add-layer --yes [flags] <layers> .
  ```

  Every rule in upgrade.md's step 4 still holds — the `.` is the target and only the layer list may sit between
  the flags and it, `--yes` is authorised only by this invocation, no `--no-backup` you weren't asked for, and
  nothing of your own added.
- **Steps 5 and 6** read the same `UPGRADE_*` lines. In the report, name the layers that were added (and any
  prerequisite that came with them), alongside the migrations and the one `UPGRADE_NEXT` boundary — a new
  layer often brings a devcontainer fragment, so `rebuild-container` is common here.
