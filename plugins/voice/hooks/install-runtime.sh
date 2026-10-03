#!/usr/bin/env bash
# bespunky-voice — SessionStart hook: publish runtime scripts to a STABLE home.
#
# WHY THIS EXISTS. A slash command's markdown does NOT reliably get
# ${CLAUDE_PLUGIN_ROOT} expanded, and a plugin's real install path is
# unpredictable (it lives deep under ~/.claude/plugins/… or a project's
# .claude/). So the /speak command can't portably point at its own scripts.
# This hook — which DOES get ${CLAUDE_PLUGIN_ROOT} — copies them to one fixed,
# predictable location every session start, so the command can call an absolute
# path with no env var at all. Idempotent, silent, cheap.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] || exit 0

DEST="${HOME}/.claude/bespunky-voice"
mkdir -p "$DEST" 2>/dev/null || exit 0

# Copy each script via a temp name + atomic rename. A plain `cp -f` truncates and
# rewrites the SAME inode, so if a detached speak.sh (launched by the /speak
# command from $DEST) is still running when this fires, bash could read a
# half-written file. `mv` swaps in a new inode and leaves the running one intact.
published=0
for f in "$PLUGIN_ROOT"/scripts/*.sh; do
  [ -f "$f" ] || continue
  b="$(basename "$f")"
  tmp="$DEST/.$b.tmp.$$"
  if cp -f "$f" "$tmp" 2>/dev/null; then
    chmod +x "$tmp" 2>/dev/null || true
    mv -f "$tmp" "$DEST/$b" 2>/dev/null && published=$((published + 1)) || rm -f "$tmp" 2>/dev/null || true
  fi
done

# Retire what the plugin no longer ships, so a published copy of a removed script
# (e.g. speak-detached.sh, replaced by speaker.sh) can't be called by mistake.
# Only *.sh at the top level is ours to prune; piper/, voices/, whisper/ and the
# state files are never touched. Only after a publish that actually landed: an
# unreadable or vanished plugin root (a stale cache path on resume) must never
# be read as "the plugin ships nothing" and wipe the runtime.
[ "$published" -gt 0 ] || exit 0
for f in "$DEST"/*.sh; do
  [ -f "$f" ] || continue
  [ -f "$PLUGIN_ROOT/scripts/$(basename "$f")" ] || rm -f "$f" 2>/dev/null || true
done

exit 0
