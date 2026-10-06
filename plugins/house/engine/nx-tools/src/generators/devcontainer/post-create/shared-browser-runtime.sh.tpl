# --- The shared browser's runtime: its pinned playwright-core + Chromium (web) ---
# The shared browser (tools/shared-browser — installed ALWAYS in a web project, started ON DEMAND) carries its OWN
# runtime: one pinned playwright-core in a per-user cache, independent of the project's dependencies — so a Python
# or Go project co-drives a browser exactly like an Angular one. `install` fetches that runtime and its Chromium into
# ~/.cache (a persisted volume), so only a project's first container downloads them; Chromium's system libraries are
# image packages (the OS packages step) — on an image the house knows; on a foreign one, whose distro it cannot know,
# Playwright installs them here from its own table (its own dependency install, on the install line below). Provisioning AHEAD: `shared-browser up` installs whatever is missing on first use anyway, so a
# failure here only warns — never fails the build.
if [ -f "$WS/tools/shared-browser/shared-browser" ]; then
  sb_ok=0
  for attempt in 1 2 3; do
    if bash "$WS/tools/shared-browser/shared-browser" install{{CHROMIUM_DEPS_FLAG}}; then sb_ok=1; break; fi
    if [ "$attempt" -lt 3 ]; then
      echo "[post-create] shared-browser runtime install attempt $attempt/3 failed (often transient Docker DNS); retrying in $((attempt * 10))s..."
      sleep $((attempt * 10))
    fi
  done
  if [ "$sb_ok" = 1 ]; then
    echo "[post-create] shared-browser: runtime + Chromium ready"
  else
    echo "[post-create] WARNING: the shared-browser runtime install failed after 3 attempts — likely a transient network issue."
    echo "[post-create]          The container is otherwise ready; finish this one step once the network settles with:"
    echo "[post-create]            bash tools/shared-browser/shared-browser install{{CHROMIUM_DEPS_FLAG}}"
  fi
else
  echo "[post-create] shared-browser: tools/shared-browser is not here yet (it arrives with the next upgrade) — skipping"
fi
