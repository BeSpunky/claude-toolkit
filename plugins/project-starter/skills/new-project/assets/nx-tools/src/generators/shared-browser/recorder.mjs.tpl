#!/usr/bin/env node
// tools/shared-browser/recorder.mjs — the persistent live-stream recorder.
//
// Console and network are a LIVE STREAM: only events captured while attached are seen.
// This long-lived process stays connected to the shared browser over CDP the whole session
// so nothing is missed while the *human* drives — Claude tails logs/events.jsonl on demand.
//
// Per page it records: console (level+text), response (method+url+status+timing),
// requestfailed (method+url+reason), pageerror (message+stack) and main-frame navigations
// (so Claude sees where the human went, not just side-effects). One timestamped JSON object
// per event, appended as JSONL. It STREAMS to disk (fs write stream — no in-memory arrays),
// AUTO-RECONNECTS if Chromium restarts, and SIZE-CAPS the log (rotate at ~20MB, keep the
// previous file as events.jsonl.1).
//
// Safety: metadata only by default (response BODIES only with --bodies); Authorization
// request headers and common token query params are REDACTED before anything is written.
// Never share or commit events.jsonl.
//
// Usage:  node recorder.mjs [--cdp=http://127.0.0.1:9223] [--bodies]
// Exits cleanly on SIGTERM/SIGINT.

import fs from 'node:fs';

// ── Config ──────────────────────────────────────────────────────────────────────
const DEFAULT_CDP = 'http://127.0.0.1:9223';
const RUNTIME = process.env.SB_RUNTIME || `${process.env.XDG_RUNTIME_DIR || '/tmp'}/shared-browser`;
const LOG_DIR = `${RUNTIME}/logs`;
const EVENTS = `${LOG_DIR}/events.jsonl`;
const EVENTS_ROTATED = `${EVENTS}.1`;
const STATUS_LOG = `${LOG_DIR}/recorder.log`;
const MAX_BYTES = 20 * 1024 * 1024; // ~20MB rotation cap
const RECONNECT_MS = 1000;
const MAX_BODY_BYTES = 64 * 1024; // cap opt-in body captures so one response can't blow the log

// Query params that commonly carry secrets — redacted in any URL we log.
const SECRET_PARAMS = [
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'client_secret',
  'password',
  'code',
  'signature',
  'sig',
];

function argValue(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

const CDP_URL = argValue('--cdp') || DEFAULT_CDP;
const WITH_BODIES = process.argv.slice(2).includes('--bodies');

// ── Streaming writer (with rotation) ─────────────────────────────────────────────
fs.mkdirSync(LOG_DIR, { recursive: true });
let stream = fs.createWriteStream(EVENTS, { flags: 'a' });
let bytesWritten = (() => {
  try {
    return fs.statSync(EVENTS).size;
  } catch {
    return 0;
  }
})();

function status(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try {
    fs.appendFileSync(STATUS_LOG, line);
  } catch {
    // Status log is best-effort; never let it crash the recorder.
  }
}

function rotate() {
  const old = stream;
  stream = null;
  old.end(); // flushes buffered data to the still-open inode (about to be renamed to .1)
  try {
    fs.renameSync(EVENTS, EVENTS_ROTATED); // overwrites any previous .1 — keeps exactly 2
  } catch {
    // If rename fails we just keep appending to a fresh stream below.
  }
  stream = fs.createWriteStream(EVENTS, { flags: 'a' });
  bytesWritten = 0;
  status('rotated events.jsonl -> events.jsonl.1');
}

/** Append one event as a timestamped JSONL line, rotating first if we'd exceed the cap. */
function writeEvent(event) {
  if (!stream) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  const size = Buffer.byteLength(line);
  if (bytesWritten + size > MAX_BYTES) rotate();
  stream.write(line);
  bytesWritten += size;
}

// ── Redaction ─────────────────────────────────────────────────────────────────────
/**
 * Redact common token params from a URL — in BOTH the query string and the
 * fragment. OAuth implicit-grant returns tokens in the hash
 * (…/callback#access_token=SECRET), so redacting only searchParams leaks them.
 * Non-URL strings pass through untouched.
 */
function redactUrl(url) {
  try {
    const u = new URL(url);
    let changed = false;

    // Query string.
    for (const p of SECRET_PARAMS) {
      if (u.searchParams.has(p)) {
        u.searchParams.set(p, '<redacted>');
        changed = true;
      }
    }

    // Fragment (e.g. #access_token=…&token_type=…).
    if (u.hash.length > 1) {
      const frag = new URLSearchParams(u.hash.slice(1));
      let fragChanged = false;
      for (const p of SECRET_PARAMS) {
        if (frag.has(p)) {
          frag.set(p, '<redacted>');
          fragChanged = true;
        }
      }
      if (fragChanged) {
        u.hash = frag.toString();
        changed = true;
      }
    }

    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

/** Redact the page's current URL through redactUrl before logging. */
const pageUrlOf = (page) => redactUrl(page.url());

/**
 * Redact sensitive headers (any casing) from a plain headers object:
 * Authorization, and the Cookie / Set-Cookie session-secret carriers.
 */
function redactHeaders(headers) {
  const SECRET_HEADERS = new Set(['authorization', 'cookie', 'set-cookie']);
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? '<redacted>' : v;
  }
  return out;
}

// ── Per-page listeners ──────────────────────────────────────────────────────────
const attached = new WeakSet();

function attachToPage(page) {
  if (attached.has(page)) return;
  attached.add(page);

  page.on('console', (msg) => {
    // Playwright console levels (log/info/debug/warning/error) map straight to
    // `level` as-is — 'warning' stays 'warning' (the CLI's logs filter matches).
    writeEvent({ type: 'console', level: msg.type(), page: pageUrlOf(page), text: msg.text() });
  });

  page.on('pageerror', (err) => {
    writeEvent({
      type: 'pageerror',
      level: 'error',
      page: pageUrlOf(page),
      message: err.message,
      stack: err.stack,
    });
  });

  page.on('requestfailed', (req) => {
    writeEvent({
      type: 'requestfailed',
      level: 'error',
      page: pageUrlOf(page),
      method: req.method(),
      url: redactUrl(req.url()),
      failure: req.failure()?.errorText ?? null,
    });
  });

  page.on('response', async (res) => {
    const req = res.request();
    const status = res.status();
    const event = {
      type: 'response',
      level: status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info',
      page: pageUrlOf(page),
      method: req.method(),
      url: redactUrl(res.url()),
      status,
      timing: req.timing?.() ?? null,
    };
    if (WITH_BODIES) {
      event.requestHeaders = redactHeaders(req.headers());
      try {
        const buf = await res.body();
        event.body = buf.toString('utf8').slice(0, MAX_BODY_BYTES);
        event.bodyBytes = buf.length;
      } catch (err) {
        event.bodyError = err.message;
      }
    }
    writeEvent(event);
  });

  // Main-frame navigations only — where the human actually went.
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    writeEvent({ type: 'navigation', level: 'info', url: redactUrl(frame.url()) });
  });

  page.on('close', () => attached.delete(page));
}

function attachToBrowser(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) attachToPage(page);
    context.on('page', attachToPage); // new tabs the human (or Claude) opens
  }
}

// ── Playwright resolution ─────────────────────────────────────────────────────────
async function loadChromium() {
  for (const pkg of ['playwright', 'playwright-core', '@playwright/test']) {
    try {
      const mod = await import(pkg);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Playwright not found. Install one of: playwright, playwright-core, @playwright/test.');
}

// ── Connect / reconnect loop ──────────────────────────────────────────────────────
let shuttingDown = false;
let currentBrowser = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const chromium = await loadChromium();
  status(`recorder starting — cdp=${CDP_URL} bodies=${WITH_BODIES}`);

  while (!shuttingDown) {
    try {
      const browser = await chromium.connectOverCDP(CDP_URL);
      currentBrowser = browser;
      status(`connected to ${CDP_URL}`);
      attachToBrowser(browser);

      // Block until the CDP connection drops (Chromium restart, `down`, etc.).
      await new Promise((resolve) => browser.on('disconnected', resolve));
      currentBrowser = null;
      status('CDP disconnected');
    } catch (err) {
      status(`connect error: ${err.message}`);
    }
    if (shuttingDown) break;
    await sleep(RECONNECT_MS); // auto-reconnect
  }
}

// ── Clean shutdown ────────────────────────────────────────────────────────────────
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  status(`received ${signal} — shutting down`);
  try {
    currentBrowser?.close().catch(() => {});
  } catch {
    // ignore
  }
  try {
    // Null the reference BEFORE end() so a late-firing listener's writeEvent()
    // hits the `if (!stream)` guard instead of writing to an ended stream.
    const s = stream;
    stream = null;
    s?.end();
  } catch {
    // ignore
  }
  // Give the stream a moment to flush, then exit.
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

run().catch((err) => {
  status(`fatal: ${err.stack || err.message}`);
  process.exit(1);
});
