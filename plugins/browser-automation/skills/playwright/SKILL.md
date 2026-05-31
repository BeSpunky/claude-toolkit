---
name: playwright
description: Drive a real browser via Playwright (Chromium, pre-installed in the BeSpunky devcontainer) — load pages, click, type, capture screenshots, scrape the rendered DOM, watch console + network. Use whenever you need to OBSERVE or DRIVE the running app instead of reasoning about source: verify a UI change end-to-end, reproduce a user-reported bug in the actual browser, capture before/after visual evidence, scrape Angular-rendered output, generate a test scaffold via codegen, or script any repeatable browser interaction you want as a file artifact. Triggers — "verify in the browser", "open the app and check X", "click that and see what happens", "screenshot the page", "reproduce the bug in chrome", "automate this flow", "playwright test", "codegen", "scrape the rendered page", any request to confirm runtime behavior of a frontend.
---

# Playwright — browser automation in the BeSpunky devcontainer

This devcontainer ships with **Chromium + Playwright system deps pre-installed** (via `.devcontainer/post-create.sh`). `@playwright/test` is in `package.json` as a devDep. You can launch a browser from a Bash script today — no `playwright install`, no apt, no `sudo`.

## Use Playwright when…

- You need to **observe** real browser behavior — rendered DOM, JS-driven UI, network calls, console errors.
- You need to **drive** the browser — click, type, navigate, scroll, hover — and capture the result.
- A bug is reproducible only in the running app, not in unit tests.
- The user asks to verify a UI change actually works end-to-end.
- You want a **reusable script artifact** (not a one-off interactive check).

## Choose between Playwright and the browser MCPs

| Tool | Best for |
|---|---|
| `mcp__Claude_Preview__*` | Quick check of the current Angular dev server inside VS Code. Auto-connected, takes screenshots and inspects with zero setup. **Prefer this for "does this page render?"** |
| `mcp__Claude_in_Chrome__*` | Cross-app flows in real Chrome with the user's session (logging into a SaaS, filling a form on a third-party site). |
| **Playwright (this skill)** | Repeatable scripts, headless runs in CI shape, multi-step flows, generating test code, scraping at scale, anything you want to keep as a file. |

If the preview MCP is connected and the question is "does the local app look right?", use that. Use Playwright when you need a **script artifact** or the preview can't drive the flow you need.

## Headless only

There's no display inside the devcontainer. Always launch headless. Never set `headless: false` — it will throw or silently hang.

## Running a one-off check

Write a Node script to `/tmp`, run it, then `Read` the screenshot it produces.

```bash
cat > /tmp/check.mjs <<'EOF'
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

page.on('console', m => console.log('[console]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('http://localhost:4200', { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/app.png', fullPage: true });
console.log('title:', await page.title());

await browser.close();
EOF
node /tmp/check.mjs
```

Then `Read /tmp/app.png` to see what the user sees. Inline image rendering shows the screenshot directly in your context.

## Codegen — record a flow into a test

```bash
yarn playwright codegen http://localhost:4200
```

(Won't work headless — only useful when the user runs it themselves locally and shares the generated code.)

## Patterns that come up a lot

- **Reproduce a bug** → script the exact steps → screenshot the broken state → fix → re-run → screenshot the fix. The two PNGs are your evidence.
- **Verify a route works** → `goto` → assert title or wait for a known selector (`page.waitForSelector('app-root [data-ready]')`).
- **Catch a runtime error** → register `page.on('pageerror', …)` and `page.on('console', …)` BEFORE goto.
- **Wait for Angular** → `waitForLoadState('networkidle')` is usually enough; if the app sets a sentinel attribute when ready, prefer that (`page.waitForSelector('[data-app-ready]')`).
- **Inspect the DOM** → `await page.locator('main').innerText()` / `innerHTML()` and log it.
- **Capture network** → `page.on('request', …)` / `page.on('response', …)` for traffic.

## Things to avoid

- Don't `playwright install` or `npx playwright install` — Chromium is already on disk in `/home/node/.cache/ms-playwright`. Re-running re-downloads.
- Don't launch non-headless. No display in the container.
- Don't write e2e tests into the app's `src/`. If the user wants a real e2e suite, **scaffold `@nx/playwright` as its own Nx project** and follow that plugin's structure — that's a separate, deliberate decision.
- Don't leave browsers running. Always `await browser.close()` (or use a `try/finally`).
- Don't poll with `waitForTimeout`. Wait for a state — `waitForSelector`, `waitForLoadState`, `waitForResponse` — never an arbitrary sleep.

## When the dev server isn't running

Playwright needs something to drive. If `nx serve <app>` isn't up, start it first (or use the `serve-and-share` skill which handles the dev-server lifecycle), then point Playwright at `http://localhost:4200`.
