#!/usr/bin/env bash
# bespunky-voice — SessionStart hook: publish runtime scripts to a STABLE home.
#
# WHY THIS EXISTS. A slash command's markdown does NOT reliably get
# ${CLAUDE_PLUGIN_ROOT} expanded, and a plugin's real install path is
# unpredictable (it lives deep under ~/.claude/plugins/… or a project's
# .claude/). So the /voice command can't portably point at its own scripts.
# This hook — which DOES get ${CLAUDE_PLUGIN_ROOT} — copies them to one fixed,
# predictable location every session start, so the command can call an absolute
# path with no env var at all. Idempotent, silent, cheap.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] || exit 0

DEST="${HOME}/.claude/bespunky-voice"
mkdir -p "$DEST" 2>/dev/null || exit 0

# Copy each script via a temp name + atomic rename. A plain `cp -f` truncates and
# rewrites the SAME inode, so if a detached speak.sh (launched by the /voice
# command from $DEST) is still running when this fires, bash could read a
# half-written file. `mv` swaps in a new inode and leaves the running one intact.
for f in "$PLUGIN_ROOT"/scripts/*.sh; do
  [ -f "$f" ] || continue
  b="$(basename "$f")"
  tmp="$DEST/.$b.tmp.$$"
  if cp -f "$f" "$tmp" 2>/dev/null; then
    chmod +x "$tmp" 2>/dev/null || true
    mv -f "$tmp" "$DEST/$b" 2>/dev/null || rm -f "$tmp" 2>/dev/null || true
  fi
done

exit 0
