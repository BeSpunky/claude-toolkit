// tools/shared-browser/attach.mjs — Claude's attach/detach ergonomics for the shared browser.
//
// The shared Chromium is a PERSISTENT object the human watches over noVNC. Claude
// attaches to it over loopback CDP (127.0.0.1:9223), drives it, then detaches — WITHOUT
// disturbing the human's session.
//
// IMPORTANT: `browser.close()` on a CDP-attached browser only DETACHES the CDP session.
// It does NOT kill the shared browser — the human keeps their tabs, scroll and state.
// So detaching is always safe and is the correct cleanup. `withPage()` is the leak-proof
// default: it guarantees a detach even if your callback throws. Raw `attach()` is the
// escape hatch for multi-step driving where you manage the detach yourself.
//
// Playwright is resolved from whichever package the workspace installed
// (playwright / playwright-core / @playwright/test), so this file has no hard dependency.

import { existsSync } from 'node:fs';

const CDP_URL = 'http://127.0.0.1:9223';

// observe-only: while this lock exists (set by `shared-browser observe`), the human is driving the
// shared window over noVNC. Attaching to DRIVE it is refused so automation can't fight the human —
// e.g. Claude yields for an OAuth/captcha step, then runs `shared-browser resume`. The lock lives in
// SB_RUNTIME (the CLI exports it); resolve the SAME base so an override never splits the stack.
const SB_RUNTIME = process.env.SB_RUNTIME || `${process.env.XDG_RUNTIME_DIR || '/tmp'}/shared-browser`;
const OBSERVE_LOCK = `${SB_RUNTIME}/observe-only`;

/** Throw (and log) when observe-only is set, so attach/withPage refuse to hand back a drivable page. */
function assertNotObserving() {
  if (existsSync(OBSERVE_LOCK)) {
    const msg = 'observe-only — human is driving';
    console.error(`[shared-browser] ${msg} (refusing to attach; run \`shared-browser resume\` to hand back to Claude)`);
    throw new Error(msg);
  }
}

/** Resolve the Playwright `chromium` object from whichever package is installed. */
async function loadChromium() {
  for (const pkg of ['playwright', 'playwright-core', '@playwright/test']) {
    try {
      const mod = await import(pkg);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      // Not installed — try the next candidate.
    }
  }
  throw new Error(
    'Playwright not found. Install one of: playwright, playwright-core, @playwright/test.',
  );
}

/** Turn a glob (`*`, `?`) into an anchored RegExp; plain strings use substring matching. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + re + '$');
}

/** Does `url` match `pattern`? Glob (contains * ? [ ]) → anchored match; else substring. */
function matchesUrl(url, pattern) {
  if (!pattern) return true;
  if (/[*?[\]]/.test(pattern)) return globToRegExp(pattern).test(url);
  return url.includes(pattern);
}

/**
 * Attach to the shared browser and return { browser, context, page }.
 *
 * Picks the first existing CDP context, then selects a page whose URL matches `pageUrl`
 * (substring or glob) if given, otherwise the first open page (creating one if none).
 * On failure the CDP session is detached before throwing, so no session leaks.
 */
export async function attach({ cdp = CDP_URL, pageUrl } = {}) {
  assertNotObserving();                          // observe-only → the human is driving; don't take the window
  const chromium = await loadChromium();
  const browser = await chromium.connectOverCDP(cdp);

  try {
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error(`No browser context at ${cdp} — is the shared browser up? (shared-browser up)`);
    }

    const open = context.pages();
    let page;
    if (pageUrl) {
      page = open.find((p) => matchesUrl(p.url(), pageUrl));
      if (!page) {
        const listed = open.map((p) => p.url()).join(', ') || 'none';
        throw new Error(`No open page matching "${pageUrl}". Open pages: ${listed}.`);
      }
    } else {
      page = open[0] ?? (await context.newPage());
    }

    return { browser, context, page };
  } catch (err) {
    // Detach before propagating so a failed attach never leaks a CDP session.
    await browser.close().catch(() => {});
    throw err;
  }
}

/** List every open tab across all contexts as [{ url, title }]. Always detaches. */
export async function pages({ cdp = CDP_URL } = {}) {
  const chromium = await loadChromium();
  const browser = await chromium.connectOverCDP(cdp);
  try {
    const list = [];
    for (const context of browser.contexts()) {
      for (const p of context.pages()) {
        list.push({ url: p.url(), title: await p.title().catch(() => '') });
      }
    }
    return list;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Attach, run `fn(page)`, and ALWAYS detach in a `finally` (even if `fn` throws).
 * The leak-proof default for ad-hoc driving. Returns whatever `fn` returns.
 */
export async function withPage(fn, { cdp = CDP_URL, pageUrl } = {}) {
  const { browser, page } = await attach({ cdp, pageUrl });
  try {
    return await fn(page);
  } finally {
    await browser.close().catch(() => {}); // detach only — shared browser stays up
  }
}
