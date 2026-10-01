---
status: concluded
concluded: 2026-10-01
summary: Toolkit tips rotate three at a time into Claude Code's spinner via a bespunky SessionStart hook; each plugin owns a tips.txt; /bespunky:tips off|on|list.
tags: [tips, hooks, onboarding, bespunky]
---

# Toolkit tips — decisions

## Surface: Claude Code's spinner tips

The user chose spinner tips, presented with the trade-off that a hook has to write them into their own settings file and that they outlive an uninstall (answer to "Where should the tips appear?": **"Spinner tips (Recommended)"**).

Roads not taken (see BRIEF.md for the surface table):
- **Session-start `systemMessage` line.** Fully plugin-native with a clean uninstall, but it's a line in the transcript, so it fits "can't be part of the conversation itself" less well.
- **Status line.** A single slot the user may already own, and a plugin can't set it anyway.
- **Plain SessionStart stdout.** Ruled out: it reaches the model's context.

## Shape

- **The engine lives in the `bespunky` front-door plugin** (`hooks/tips.mjs`, a `SessionStart: startup` hook). It's the toolkit-wide plugin, and one engine means one writer to the settings file. Per-plugin hooks would race each other.
- **The content lives with each plugin** (`tips.txt` at its root). A tip ships, changes and retires with the capability it describes. The engine only collects tips; it never needs to know them.
- **Only installed and enabled plugins' tips appear.** Found through Claude Code's `installed_plugins.json` (user scope, or project scope covering this project), minus any `enabledPlugins: false`. If the registry can't be read, only the front door's own tips appear: better too few than tips for commands that don't exist.
- **Occasional:** three tips per session, round-robin across plugins, with a cursor in the plugin's data dir. They mix with Claude Code's built-in tips, never replace them, and `replaceBuiltInTips` is never touched.
- **A guest in the user's settings file:** it touches only the strings it wrote (tracked in `CLAUDE_PLUGIN_DATA`). It never rewrites an unparsable file, writes through symlinks, writes atomically, skips the write when nothing changed, and withdraws when `spinnerTipsEnabled` is false. It is silent on stdout.
- **Opt-out:** `/bespunky:tips off|on|list`. With no uninstall event, `off` is also how to clean up before uninstalling.
- **Needs `node` on PATH.** Without it the hook exits silently and there are no tips. Claude Code's native install doesn't guarantee node, but every house devcontainer has it.

## Known limits

- Settings are user-wide while the installed set can be per project. The tips reflect whichever project last started a session.
- Whether Claude Code reloads spinner tips mid-session after the hook writes them is unconfirmed. At worst, a rotation shows up one session later.

## Closing

Merged on the user's "done, merge it". Their one follow-up asked how 34 tips square with three left behind on uninstall. The pool is 34, but only the current three sit in settings at any time.
