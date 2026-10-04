# --- Claude Code, installed ONCE, natively (agent) ---
# The native install (~/.local/bin/claude) is the one `claude update` and Claude Code's background auto-updater
# manage, so a container installed this way stays current with nobody running anything. There is deliberately
# no second copy: the house used to install Claude Code through a devcontainer feature as well, and that build-
# time copy sat earlier on PATH — every update landed in the shadowed one, reported success, and changed
# nothing, freezing the container at its build-day version (and hiding every newer Claude Code feature the
# toolkit relies on). devcontainer.json puts ~/.local/bin first on PATH for the same reason; this script
# exports it too, because a lifecycle command may run without remoteEnv and the plugin pre-install below
# needs `claude`. Best-effort: offline, it warns and the container still comes up.
if [ -x "$HOME/.local/bin/claude" ]; then
  echo "[post-create] Claude Code already installed natively — its own updater keeps it current"
elif curl -fsSL https://claude.ai/install.sh | bash; then
  echo "[post-create] Claude Code installed natively (~/.local/bin/claude)"
else
  echo "[post-create] WARNING: Claude Code could not be installed (offline?). Run: curl -fsSL https://claude.ai/install.sh | bash"
fi
export PATH="$HOME/.local/bin:$PATH"
