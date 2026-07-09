// tools/shared-browser/verify.mjs — the in-place CSS/DOM verify-loop helpers.
//
// These turn the crown-jewel loop — reproduce a visual/CSS bug in the live running view,
// patch it via CDP, and PROVE the fix objectively (measurements + before/after shots) —
// into a handful of calls instead of boilerplate. They all operate on a Playwright `page`
// you already attached (see attach.mjs).
//
// Live edits here are EPHEMERAL scaffolding to *find* the fix — the deliverable is still
// the source change, confirmed after a reload. injectStyle().remove() and pseudo().reset()
// let you leave the human's view exactly as you found it.

import fs from 'node:fs';

// Screenshots land beside the recorder logs, under the shared-browser runtime dir. Honor
// SB_RUNTIME (the CLI exports it) so an override never splits the stack — the CLI, the
// recorder, and these screenshots all resolve the SAME base; fall back to the XDG default.
const RUNTIME = process.env.SB_RUNTIME || `${process.env.XDG_RUNTIME_DIR || '/tmp'}/shared-browser`;
const SCREENSHOTS = `${RUNTIME}/logs/screenshots`;

// observe-only: while this lock exists (set by `shared-browser observe`), the human is driving the
// shared window over noVNC. The verify helpers that MUTATE the page (inject styles, set vars/theme,
// resize, force pseudo-states, run a mutate callback) stand down so automation can't fight the human;
// the pure-read helpers (measure) stay available. Cleared by `shared-browser resume`.
const OBSERVE_LOCK = `${RUNTIME}/observe-only`;
function assertNotObserving() {
  if (fs.existsSync(OBSERVE_LOCK)) {
    const msg = 'observe-only — human is driving';
    console.error(`[shared-browser] ${msg} (refusing to drive the page; run \`shared-browser resume\` to hand back to Claude)`);
    throw new Error(msg);
  }
}

const VIEWPORTS = {
  mobile: { w: 390, h: 844 },
  tablet: { w: 820, h: 1180 },
  desktop: { w: 1440, h: 900 },
};

/** Inject an ephemeral <style> and return a handle whose remove() deletes it. */
export async function injectStyle(page, css) {
  assertNotObserving();
  const handle = await page.addStyleTag({ content: css });
  return {
    async remove() {
      await handle.evaluate((el) => el.remove()).catch(() => {});
    },
  };
}

/** Set a CSS custom property on `selector` (default :root). `name` may omit the -- prefix. */
export async function setCssVar(page, name, value, selector = ':root') {
  assertNotObserving();
  const prop = name.startsWith('--') ? name : `--${name}`;
  await page.evaluate(
    ({ selector, prop, value }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`setCssVar: no element matches "${selector}".`);
      el.style.setProperty(prop, value);
    },
    { selector, prop, value },
  );
}

/**
 * Measure an element: { rect, computed, overflow }.
 * - rect     — getBoundingClientRect (x/y/width/height/top/right/bottom/left)
 * - computed — a useful getComputedStyle subset (box, typography, layout, paint)
 * - overflow — { scrollWidth, clientWidth, overflowing } for a zero-overflow check
 * Throws a clear error if the selector matches nothing.
 */
export async function measure(page, selector) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`measure: no element matches "${selector}".`);

    const r = el.getBoundingClientRect();
    const rect = {
      x: r.x, y: r.y, width: r.width, height: r.height,
      top: r.top, right: r.right, bottom: r.bottom, left: r.left,
    };

    const cs = getComputedStyle(el);
    const keys = [
      'display', 'position', 'boxSizing', 'width', 'height', 'margin', 'padding', 'border',
      'color', 'backgroundColor', 'opacity', 'visibility', 'zIndex',
      'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'textAlign',
      'overflow', 'overflowX', 'overflowY',
      'flexDirection', 'justifyContent', 'alignItems', 'gap', 'gridTemplateColumns',
      'transform',
    ];
    const computed = {};
    for (const k of keys) computed[k] = cs[k];

    const overflow = {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowing: el.scrollWidth > el.clientWidth,
    };

    return { rect, computed, overflow };
  }, selector);
}

/**
 * Screenshot before, run `await mutate()`, screenshot after. Writes both PNGs to
 * `${SB_RUNTIME}/logs/screenshots/` with predictable timestamped names and returns
 * { before, after } absolute paths. Read the PNGs back by those paths.
 */
export async function screenshotPair(page, name, mutate) {
  if (typeof mutate === 'function') assertNotObserving();   // the before/after shots are reads; the mutate drives
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = String(name).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'shot';
  const before = `${SCREENSHOTS}/${stamp}__${safe}__before.png`;
  const after = `${SCREENSHOTS}/${stamp}__${safe}__after.png`;

  await page.screenshot({ path: before });
  if (typeof mutate === 'function') await mutate();
  await page.screenshot({ path: after });

  return { before, after };
}

/** Emulate prefers-color-scheme AND set document.documentElement.dataset.theme. */
export async function theme(page, mode) {
  assertNotObserving();
  if (mode !== 'dark' && mode !== 'light') {
    throw new Error(`theme: mode must be 'dark' or 'light', got "${mode}".`);
  }
  await page.emulateMedia({ colorScheme: mode });
  await page.evaluate((mode) => {
    document.documentElement.dataset.theme = mode;
  }, mode);
}

/** Resize the viewport by preset (mobile|tablet|desktop) or explicit { w, h }. */
export async function viewport(page, preset) {
  assertNotObserving();
  const size = typeof preset === 'string' ? VIEWPORTS[preset] : preset;
  if (!size || typeof size.w !== 'number' || typeof size.h !== 'number') {
    throw new Error(`viewport: expected 'mobile'|'tablet'|'desktop' or { w, h }, got ${JSON.stringify(preset)}.`);
  }
  await page.setViewportSize({ width: size.w, height: size.h });
}

/**
 * Force a pseudo-state (:hover / :focus / :active) on an element via CDP
 * `CSS.forcePseudoState`, so you can screenshot/measure hover styles without a real cursor.
 *
 * Uses a dedicated CDP session and ENABLES the DOM + CSS domains itself. The forced state
 * persists only while the session lives, so call `reset()` on the returned handle when done
 * (it clears the state and detaches the session). Cleared automatically on navigation.
 */
export async function pseudo(page, selector, state) {
  assertNotObserving();
  const pseudoClass = String(state).replace(/^:/, '');
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('CSS.enable');

  const { root } = await session.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) {
    await session.detach().catch(() => {});
    throw new Error(`pseudo: no element matches "${selector}".`);
  }

  await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [pseudoClass] });

  return {
    async reset() {
      await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => {});
      await session.detach().catch(() => {});
    },
  };
}

/**
 * Zero-CLS check: measure the element's rect, run `mutate`, measure again, and return
 * per-edge deltas. All-zero deltas mean the mutation caused no layout shift.
 */
export async function layoutShift(page, selector, mutate) {
  if (typeof mutate === 'function') assertNotObserving();   // the measurements are reads; the mutate drives
  const before = (await measure(page, selector)).rect;
  if (typeof mutate === 'function') await mutate();
  const after = (await measure(page, selector)).rect;

  const deltas = {
    top: after.top - before.top,
    right: after.right - before.right,
    bottom: after.bottom - before.bottom,
    left: after.left - before.left,
    width: after.width - before.width,
    height: after.height - before.height,
  };

  return { deltas };
}
