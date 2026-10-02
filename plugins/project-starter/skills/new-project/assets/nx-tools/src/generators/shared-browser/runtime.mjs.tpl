// tools/shared-browser/runtime.mjs — the shared browser's OWN Playwright runtime. GENERATOR-OWNED
// (@bespunky/nx-tools:shared-browser); rewritten every sync.
//
// The shared browser used to resolve `playwright` from the workspace's node_modules, which tied a co-driven
// browser — a stack-free thing — to a JavaScript project: a Python or Go repo had nothing to resolve, and a JS
// one silently drove whatever Playwright version (and Chromium revision) its own tests happened to pin.
//
// So the runtime is self-contained: ONE pinned playwright-core, installed on demand into a per-user cache
// OUTSIDE the repository (nothing to gitignore, nothing for Nx or a package manager to discover, shared by
// every worktree and project on the machine at the same version), and the Chromium revision THAT version
// expects. Node + npm are the only prerequisites — and Node is the house floor.
//
//   node runtime.mjs install [--with-deps]   install playwright-core + its Chromium (+ OS deps, needs sudo)
//   node runtime.mjs module                  print the playwright-core module dir (installing if needed)
//   node runtime.mjs chromium                print the Chromium executable (installing both if needed)
//
// Progress goes to stderr: stdout carries only the answer, so the bash CLI can capture it.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLAYWRIGHT_VERSION = '{{playwrightVersion}}';

/**
 * The shared Chromium's DevTools endpoint (loopback only). SB_CDP overrides the port, exactly as it does for the
 * CLI — which exports it, so the recorder it spawns and every attach agree with the browser it started. Defined
 * once here for every node-side reader; a hard-coded 9223 in each of them silently ignored the override.
 */
export const CDP_URL = `http://127.0.0.1:${process.env.SB_CDP || 9223}`;

/** Where the runtime lives. SB_PLAYWRIGHT_RUNTIME overrides (e.g. a volume that survives rebuilds). */
export const RUNTIME_DIR =
  process.env.SB_PLAYWRIGHT_RUNTIME ||
  join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'bespunky', `playwright-core@${PLAYWRIGHT_VERSION}`);

export const MODULE_DIR = join(RUNTIME_DIR, 'node_modules', 'playwright-core');

const toStderr = { stdio: ['ignore', 2, 2] };

/** Install the pinned playwright-core into the runtime dir, if it isn't there yet. */
export function ensureModule() {
  if (existsSync(join(MODULE_DIR, 'package.json'))) return MODULE_DIR;
  console.error(`[shared-browser] installing playwright-core@${PLAYWRIGHT_VERSION} into ${RUNTIME_DIR} (once per machine)…`);
  execFileSync(
    'npm',
    ['install', '--prefix', RUNTIME_DIR, '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--loglevel=error', `playwright-core@${PLAYWRIGHT_VERSION}`],
    toStderr,
  );
  return MODULE_DIR;
}

/** The pinned Playwright (`{ chromium, … }`), installed on demand. */
export function loadPlaywright() {
  ensureModule();
  return createRequire(join(RUNTIME_DIR, 'noop.js'))('playwright-core');
}

/** The Chromium this playwright-core expects, installed on demand. Returns its executable path. */
export function ensureChromium({ withDeps = false } = {}) {
  const { chromium } = loadPlaywright();
  const exe = chromium.executablePath();
  const cli = join(MODULE_DIR, 'cli.js');
  if (!existsSync(exe)) {
    console.error(`[shared-browser] installing Chromium for playwright-core@${PLAYWRIGHT_VERSION}…`);
    execFileSync(process.execPath, [cli, 'install', 'chromium'], toStderr);
  }
  if (withDeps) {
    // OS libraries Chromium links against. Needs root; without passwordless sudo, say what to run.
    try {
      execFileSync('sudo', ['-n', process.execPath, cli, 'install-deps', 'chromium'], toStderr);
    } catch {
      console.error(`[shared-browser] could not install Chromium's OS deps (needs root). Run: sudo ${process.execPath} ${cli} install-deps chromium`);
    }
  }
  return exe;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [verb, ...flags] = process.argv.slice(2);
  try {
    if (verb === 'install') ensureChromium({ withDeps: flags.includes('--with-deps') });
    else if (verb === 'module') console.log(ensureModule());
    else if (verb === 'chromium') console.log(ensureChromium());
    else {
      console.error('usage: node runtime.mjs install [--with-deps] | module | chromium');
      process.exit(2);
    }
  } catch (err) {
    console.error(`[shared-browser] runtime: ${err.message}`);
    process.exit(1);
  }
}
