# --- git authenticates through the persisted GitHub CLI login (agent) ---
# The `gh` login lives in the persisted ~/.config (devcontainer.json mounts), so it survives a rebuild; ~/.gitconfig does not. This
# re-points git's GitHub credential helper at `gh` on every container create, so `git push` works in ANY shell —
# including one opened from outside the editor, which the editor's own forwarded credential helper never reaches.
# Not logged in yet (a fresh ~/.config) is not an error: `gh auth login` offers the same wiring when it runs.
if command -v gh > /dev/null && gh auth status > /dev/null 2>&1; then
  if gh auth setup-git; then
    echo "[post-create] git uses the persisted GitHub CLI login"
  else
    echo "[post-create] WARNING: could not wire git to the GitHub CLI login. Run: gh auth setup-git"
  fi
else
  echo "[post-create] GitHub CLI not logged in yet — run \`gh auth login\` once; it persists across rebuilds"
fi
