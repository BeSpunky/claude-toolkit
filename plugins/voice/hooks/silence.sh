#!/usr/bin/env bash
# bespunky-voice — silence.sh : stop talking the moment the user acts.
#
# Wired to two events, both meaning "the user is back at the keyboard and has
# moved on", so whatever is still being read aloud is now noise over their move:
#   - UserPromptSubmit                         — they sent a prompt;
#   - PostToolUse on AskUserQuestion|ExitPlanMode — they answered the picker or
#     the plan approval (which submit no prompt, so the first would miss them).
# This is also the reliable half of "cancel": no hook fires on Esc, and whether
# Esc reaches the MCP ask tool is undocumented.
#
# Writes NOTHING to stdout — a UserPromptSubmit hook's stdout is added to the
# model's context. Unconditional (not gated on auto-speak): speech started by any
# path — /voice say, the ask tool, auto-speak — is stopped the same way.
set -uo pipefail
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] || exit 0
bash "$PLUGIN_ROOT/scripts/speaker.sh" stop >/dev/null 2>&1
exit 0
