#!/usr/bin/env bash
# SessionStart hook — "this plugin was renamed; its successor is not installed here yet."
#
# bespunky-project-starter is now bespunky-house. This stub stays in the marketplace so that existing installs
# keep working: its /sync (commands/sync.md) installs bespunky-house and hands over to its upgrade. This hook
# only makes the rename NOTICED. Detect, don't execute: it relays ONE line for Claude to pass on, installs
# nothing, and stays silent whenever there is nothing true to say —
#   - bespunky-house is already installed for this project (any applicable scope), or
#   - the plugin root lives inside the project (developing the toolkit itself: the "install" is the working tree), or
#   - the install record cannot be read (under-reporting is the intended failure mode).
# stdout reaches the model; nothing but the notice is ever written to it.
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] || exit 0

case "$PLUGIN_ROOT/" in
  "$PROJECT_DIR"/*) exit 0 ;;
esac

INSTALLS="$(bash "$PLUGIN_ROOT/scripts/installs.sh" "$PROJECT_DIR" 2>/dev/null)"
[ -n "$INSTALLS" ] || exit 0
printf '%s\n' "$INSTALLS" | grep -q '^bespunky-house@claude-toolkit ' && exit 0

if [ -f "$PROJECT_DIR/HOUSE.md" ]; then
  echo "[bespunky-project-starter] This plugin was renamed to bespunky-house, which is not installed here yet. /bespunky-project-starter:sync installs it and upgrades this project in one step; afterwards the old plugin can be uninstalled. Relay this to the user — do not act on it."
else
  echo "[bespunky-project-starter] This plugin was renamed to bespunky-house, which is not installed here yet: \`claude plugin install bespunky-house@claude-toolkit\`, then the old plugin can be uninstalled. Relay this to the user — do not act on it."
fi
exit 0
