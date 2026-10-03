# --- The Nx wrapper's installation (nx) ---
# A repo that hosts Nx through the wrapper (`./nx`, `.nx/nxw.js` — the house's choice for a repo with no
# package.json) keeps Nx, @nx/devkit and @bespunky/nx-tools in the GITIGNORED `.nx/installation`, pinned
# exactly in nx.json `installation`. Any `./nx` invocation installs it to match the pins; doing it HERE means
# the first `./nx g …` in the new container doesn't pay for it, and an offline rebuild says so now rather than
# mid-task. Self-adapting: a repo without the wrapper (Nx in node_modules) skips this — its package-manager
# install below brings Nx.
if [ -f "$WS/.nx/nxw.js" ] && [ -x "$WS/nx" ]; then
  echo "[post-create] installing the Nx wrapper's pinned packages (.nx/installation)"
  if "$WS/nx" --version > /dev/null; then
    echo "[post-create] Nx wrapper ready"
  else
    echo "[post-create] WARNING: the Nx wrapper could not install its packages (offline?). The next ./nx call retries."
  fi
fi
