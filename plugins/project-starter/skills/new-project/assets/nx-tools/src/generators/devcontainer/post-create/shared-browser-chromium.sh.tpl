# --- The shared browser's Chromium (web) ---
# The shared browser (tools/shared-browser — installed ALWAYS in a web project, started ON DEMAND) launches a
# Playwright Chromium on the virtual display the OS packages above provide. The Playwright step already
# fetched it when @playwright/test is declared — so here we only install it if it is still MISSING, avoiding
# a redundant ~150 MB download. Best-effort + retry; a failure only warns (the shared-browser CLI also runs
# `npx playwright install chromium` on its first `up` if it is absent, so this is provisioning-ahead).
if [ -d "$HOME/.cache/ms-playwright" ] && \
   find "$HOME/.cache/ms-playwright" -maxdepth 1 -type d -name 'chromium-*' 2>/dev/null | grep -q .; then
  echo "[post-create] shared-browser: Playwright Chromium already present — skipping install"
else
  echo "[post-create] shared-browser: Playwright Chromium not found — installing"
  sb_pw_ok=0
  for attempt in 1 2 3; do
    if npx --yes playwright install chromium; then sb_pw_ok=1; break; fi
    if [ "$attempt" -lt 3 ]; then
      echo "[post-create] shared-browser Chromium install attempt $attempt/3 failed (often transient DNS); retrying in $((attempt * 10))s..."
      sleep $((attempt * 10))
    fi
  done
  if [ "$sb_pw_ok" = 1 ]; then
    echo "[post-create] shared-browser: Playwright Chromium ready"
  else
    echo "[post-create] WARNING: shared-browser Chromium install failed after 3 attempts — likely a transient network issue."
    echo "[post-create]          The container is otherwise ready; finish this one step once the network settles with:"
    echo "[post-create]            npx playwright install chromium"
  fi
fi
