# --- Playwright: Chromium + its system deps for the project's OWN browser tests (js; when @playwright/test is declared) ---
# `playwright install --with-deps chromium` downloads the browser into ~/.cache/ms-playwright and runs the apt
# step for Chromium's libs itself, through sudo — the house images grant the remote user passwordless sudo.
# Self-adapting: fires only when the workspace declares @playwright/test (the `@bespunky/nx-tools:playwright`
# generator adds it, pinned to the shared browser's runtime version — so in a web project this is the SAME
# browser build the shared-browser step fetches, and whichever runs second finds it present).
if grep -q '"@playwright/test"' "$WS/package.json" 2>/dev/null; then
  echo "[post-create] @playwright/test detected — installing Chromium + system deps"
  PW_EXEC="${PM_EXEC:-npx --no-install}"
  # A large download from cdn.playwright.dev; Docker DNS is intermittently flaky and Playwright's own retries
  # fire too fast to outlast the blip. Retry with backoff, and WARN (never fail the build) if it still fails.
  pw_ok=0
  for attempt in 1 2 3; do
    if $PW_EXEC playwright install --with-deps chromium; then pw_ok=1; break; fi
    if [ "$attempt" -lt 3 ]; then
      echo "[post-create] Playwright browser install attempt $attempt/3 failed (often transient Docker DNS); retrying in $((attempt * 10))s..."
      sleep $((attempt * 10))
    fi
  done
  if [ "$pw_ok" = 1 ]; then
    echo "[post-create] Playwright prerequisites ready"
  else
    echo "[post-create] WARNING: Playwright browser install failed after 3 attempts — likely a transient network/DNS issue."
    echo "[post-create]          The container is otherwise ready; finish this one step once the network settles with:"
    echo "[post-create]            $PW_EXEC playwright install --with-deps chromium"
  fi
fi
