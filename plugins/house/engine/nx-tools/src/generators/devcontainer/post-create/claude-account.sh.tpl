# --- Claude Code's account record, kept inside the persisted config dir (agent) ---
# CLAUDE_CONFIG_DIR (devcontainer.json containerEnv) puts `.claude.json` — the login and onboarding record — inside
# the bind-mounted config dir, so it survives a rebuild. Exported here as well, because a lifecycle command may run
# without the container's env applied and the plugin pre-install below runs `claude`.
#
# A config dir that has NO account record yet but does have Claude Code's own backups of one (it keeps them under
# `backups/`) is restored from the newest: that is exactly a container that predates the setting — whose record
# lived in the container-local $HOME and died with the old container — so its first rebuild with the setting does
# not ask to log in either. Never overwrites a record that exists.
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ ! -f "$CLAUDE_CONFIG_DIR/.claude.json" ]; then
  claude_backup="$(ls -1t "$CLAUDE_CONFIG_DIR"/backups/.claude.json.backup.* 2>/dev/null | head -n 1 || true)"
  if [ -n "$claude_backup" ] && cp -p "$claude_backup" "$CLAUDE_CONFIG_DIR/.claude.json"; then
    echo "[post-create] restored Claude Code's account record from $(basename "$claude_backup") — no new login needed"
  fi
fi
