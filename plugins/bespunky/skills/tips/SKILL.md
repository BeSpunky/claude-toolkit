---
name: tips
description: >-
  Control the BeSpunky toolkit tips that show up in Claude Code's "working…" spinner. Use when the user wants to turn those tips off or back on, asks to see every toolkit tip, or asks about them: "stop the bespunky tips", "turn off toolkit tips", "where do these spinner tips come from", "show me all the tips", "/bespunky:tips off|on|list".
argument-hint: "[off | on | list]"
---

# Toolkit tips

A `SessionStart` hook in this plugin puts a small rotating handful of tips into the user's spinner. Each session they rotate, and they only cover toolkit plugins installed for the project. The tips live in each plugin's `tips.txt`. The hook writes them into `spinnerTipsOverride.tips` in the user's `~/.claude/settings.json` and only ever touches the entries it wrote itself.

Run the engine with the requested command (default to `list` when none was given):

```bash
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" CLAUDE_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" node "${CLAUDE_PLUGIN_ROOT}/hooks/tips.mjs" <off|on|list>
```

- **off** removes the toolkit's tips from the spinner and keeps them off across sessions. The user's own spinner tips stay.
- **on** turns them back on and puts a fresh handful in right away.
- **list** prints every tip available for this project, grouped by plugin.

Relay the script's one-line result. For `list`, show the tips as printed. Don't edit the settings file by hand: the engine tracks which tips it owns, and a hand edit breaks that.
