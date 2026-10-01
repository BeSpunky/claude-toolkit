---
name: playwright
description: >-
  Drive a real browser via Playwright (headless Chromium; pre-installed in BeSpunky devcontainers that wear the web layer) — load pages, click, type, capture screenshots, scrape the rendered DOM, watch console + network. Use whenever you need to OBSERVE or DRIVE the running app instead of reasoning about source: verify a UI change end-to-end, reproduce a user-reported bug in the actual browser, capture before/after visual evidence, scrape client-rendered output (any framework - Angular, React, Vue, Svelte, server-rendered), generate a test scaffold via codegen, or script any repeatable browser interaction you want as a file artifact. Triggers — "verify in the browser", "open the app and check X", "click that and see what happens", "screenshot the page", "reproduce the bug in chrome", "automate this flow", "playwright test", "codegen", "scrape the rendered page", any request to confirm runtime behavior of a frontend.
---

# Playwright — headless browser automation

**First, find out what this environment already has — don't assume.** In a BeSpunky devcontainer whose project wears the `web` layer (its `HOUSE.md` stamp lists `web` in `layers=`), **Chromium + Playwright system deps are pre-installed** (via `.devcontainer/post-create.sh`) and you can launch a browser from a script today — no `playwright install`, no apt, no `sudo`. Elsewhere, check before you reach for it: a Node project may already carry `@playwright/test` / `playwright` as a devDependency (use the project's package manager to run it); a Python project may have the `playwright` package; a cached browser lives under `~/.cache/ms-playwright`. If none is present, **ask before installing** — it downloads a browser of a few hundred MB.

**Where's the app?** Never assume a port. Read it from wherever *this* project says: the URL its dev server printed, the project's `HOUSE.md`/README, the dev declaration (`.bespunky/dev.json` in a house project with the `web` layer), or the server you just started yourself on a random port (`bespunky-workflow:local-server-isolation`). The examples below use `$APP_URL`.

## Use Playwright when…

- You need to **observe** real browser behavior — rendered DOM, JS-driven UI, network calls, console errors.
- You need to **drive** the browser — click, type, navigate, scroll, hover — and capture the result.
- A bug is reproducible only in the running app, not in unit tests.
- The user asks to verify a UI change actually works end-to-end.
- You want a **reusable script artifact** (not a one-off interactive check).

## Choose between Playwright and the browser MCPs

| Tool | Best for |
|---|---|
| `mcp__Claude_Preview__*` | Quick check of the current dev server inside VS Code. Auto-connected, takes screenshots and inspects with zero setup. **Prefer this for "does this page render?"** |
| `mcp__Claude_in_Chrome__*` | Cross-app flows in real Chrome with the user's session (logging into a SaaS, filling a form on a third-party site). |
| **`shared-browser` skill** | The human wants to **watch / co-drive**, OR in-place **visual / CSS-DOM verification with measured proof** (getComputedStyle/overflow, before/after) on one live browser you both drive. |
| **Playwright (this skill)** | **Solo automated checks** — repeatable scripts, headless runs in CI shape, multi-step flows, generating test code, scraping at scale, anything you want to keep as a file. |

If the preview MCP is connected and the question is "does the local app look right?", use that. Use Playwright when you need a **script artifact** or the preview can't drive the flow you need. **For co-driving with a human present, or in-place visual verification, use the `shared-browser` skill; use this (headless Playwright) for solo automated checks.**

## Headless only

There's no display inside the devcontainer. Always launch headless. Never set `headless: false` — it will throw or silently hang.

## Running a one-off check

Write a script to a scratch location, run it, then `Read` the screenshot it produces. (Node shown; the Python API is the same shape — `from playwright.sync_api import sync_playwright`.) Run it from the project root so `@playwright/test` resolves from the project's `node_modules`.

```bash
cat > /tmp/check.mjs <<'EOF'
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

page.on('console', m => console.log('[console]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto(process.env.APP_URL, { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/app.png', fullPage: true });
console.log('title:', await page.title());

await browser.close();
EOF
APP_URL=http://localhost:<port> node /tmp/check.mjs
```

Then `Read /tmp/app.png` to see what the user sees. Inline image rendering shows the screenshot directly in your context.

## Codegen — record a flow into a test

```bash
<pm> playwright codegen "$APP_URL"     # <pm> = the project's runner: npx / yarn / pnpm exec
```

(Won't work headless — only useful when the user runs it themselves locally and shares the generated code.)

## Patterns that come up a lot

- **Reproduce a bug** → script the exact steps → screenshot the broken state → fix → re-run → screenshot the fix. The two PNGs are your evidence.
- **Verify a route works** → `goto` → assert title or wait for a known selector (`page.waitForSelector('[data-ready]')`).
- **Catch a runtime error** → register `page.on('pageerror', …)` and `page.on('console', …)` BEFORE goto.
- **Wait for the app to settle** (any client-rendered framework) → `waitForLoadState('networkidle')` is usually enough; if the app sets a sentinel attribute when ready, prefer that (`page.waitForSelector('[data-app-ready]')`).
- **Inspect the DOM** → `await page.locator('main').innerText()` / `innerHTML()` and log it.
- **Capture network** → `page.on('request', …)` / `page.on('response', …)` for traffic.

## Things to avoid

- Don't `playwright install` when a browser is already on disk (`~/.cache/ms-playwright` — pre-populated in a house `web` devcontainer). Re-running re-downloads.
- Don't launch non-headless. No display in the container.
- Don't write e2e tests into the app's source tree. If the user wants a real e2e suite, that's a separate, deliberate decision — give it its own project (in a house project, Nx is the floor: **scaffold it with `@nx/playwright`** as its own Nx project and follow that plugin's structure).
- Don't leave browsers running. Always `await browser.close()` (or use a `try/finally`).
- Don't poll with `waitForTimeout`. Wait for a state — `waitForSelector`, `waitForLoadState`, `waitForResponse` — never an arbitrary sleep.

## When the dev server isn't running

Playwright needs something to drive. If the app isn't up, start it yourself **on a random free port** per `bespunky-workflow:local-server-isolation` (never the default/forwarded port — that belongs to the user's own server), read the bound URL from the server's startup output, and point `$APP_URL` there. In a house project with the `web` layer, `<pm> nx serve <app> --port-offset=auto` (the stack-free `tools/dev/dev serve`) starts the whole declared stack on an isolated port block and prints the URL. Tear it down when you're done. If a human wants to watch, use `bespunky-browser-automation:shared-browser` instead.
