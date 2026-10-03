/**
 * The COMPILED PAYLOAD, for the harnesses that test it — test-migrations, test-layers, test-generators —
 * and the few fixture helpers they share (the tree snapshot, the logger capture, the assertions).
 *
 * Each of them used to carry its own copy of "compile the payload the way the publisher does, into a cache
 * dir inside the repo, then require the result". Three copies of one decision is two places for it to drift
 * — and the part most likely to drift is the one that fails SILENTLY (where the build lands; see below). So it
 * lives here once, with its reasons.
 *
 * ── WHY THE COMPILED PAYLOAD, NOT THE SOURCE ───────────────────────────────────────────────────────────────
 *
 * Generators and migrations ship as JavaScript — Nx loads them out of `node_modules`, transpiled by
 * `engine/compile-generators.mts`. Testing the TypeScript source instead would leave the transpile step — the
 * one thing between what is written here and what consumers execute — untested.
 *
 * ── WHY THE BUILD LANDS UNDER node_modules/.cache/ ─────────────────────────────────────────────────────────
 *
 * The payload reaches for its peers with BARE requires (`require('typescript')`, `@nx/devkit`, `@nx/js`, …),
 * resolved from the compiled module's OWN location. Compile to `os.tmpdir()` and that resolution walks up to
 * `/` and finds nothing, so every AST-based migration degrades to its "no TypeScript here" branch and the suite
 * passes while testing almost nothing. Inside the repo, resolution walks up into the repo's own `node_modules`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ASSETS = join(REPO, 'plugins/house/engine');
export const PAYLOAD = join(ASSETS, 'nx-tools');
const COMPILER = join(ASSETS, 'compile-generators.mts');

/** `require`, resolving from the repo root — the same `@nx/devkit` instance every compiled module resolves. */
export const requireFromRepo = createRequire(join(REPO, 'noop.js'));

/** Is `pkg` resolvable from the repo (installed, or provided by a parent node_modules)? */
export function resolvable(pkg) {
  try {
    requireFromRepo.resolve(`${pkg}/package.json`);
    return true;
  } catch {
    return existsSync(join(REPO, 'node_modules', pkg));
  }
}

/**
 * Exit 2 with a sentence per missing package — a raw module-resolution trace out of the compile step is a bad
 * first experience for a tool nobody has run before.
 *
 * @param needs  `[package, why]` pairs.
 * @param who    the harness, for the sentence.
 */
export function requireInstalled(needs, who) {
  const missing = needs.filter(([pkg]) => !resolvable(pkg));
  if (missing.length === 0) return;
  console.error(`${who} need the workspace installed:`);
  for (const [pkg, why] of missing) console.error(`  • ${pkg} is not installed — ${why}`);
  console.error('\n  yarn install   # then re-run');
  process.exit(2);
}

/**
 * Compile the payload exactly as the publisher does, into `node_modules/.cache/<cacheName>`.
 * Returns `{ build, load(relativeToSrc), dispose() }`. Throws with the compiler's stderr on failure.
 */
export function compilePayload(cacheName) {
  const build = join(REPO, 'node_modules/.cache', cacheName);
  rmSync(build, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  cpSync(join(PAYLOAD, 'src'), join(build, 'src'), { recursive: true });
  // The package's top-level manifests ship beside src/ and are read at run time (the app generator resolves the
  // per-app steps it attaches through generators.json) — so the build is the package's shape, not just its code.
  for (const manifest of ['package.json', 'generators.json', 'executors.json', 'migrations.json']) {
    if (existsSync(join(PAYLOAD, manifest))) cpSync(join(PAYLOAD, manifest), join(build, manifest));
  }
  try {
    execFileSync(process.execPath, [COMPILER, build], { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    throw new Error(`Could not compile the payload:\n${error.stderr?.toString() || error.message}`);
  }
  return {
    build,
    load: (path) => requireFromRepo(join(build, 'src', path)),
    dispose: () => rmSync(build, { recursive: true, force: true }),
  };
}

/** Every file in an @nx/devkit Tree, as one comparable string — the idempotence check's "before" and "after". */
export function snapshot(tree) {
  const files = {};
  const walk = (dir) => {
    for (const child of tree.children(dir)) {
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (tree.isFile(path)) files[path] = tree.read(path, 'utf8');
      else walk(path);
    }
  };
  walk('.');
  return JSON.stringify(files);
}

/** Which files differ between two `snapshot`s — so an idempotence failure names what moved. */
export function snapshotDiff(before, after) {
  const a = JSON.parse(before);
  const b = JSON.parse(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((path) => a[path] !== b[path]).sort();
}

/**
 * Capture the devkit logger. Generators and migrations report to it, and that reporting is part of what they
 * are FOR — several do nothing but explain what they refused to guess at. So it is captured rather than
 * silenced: invisible while a case passes, printed under one that fails. Patching the shared logger object works
 * because every compiled module resolves the same `@nx/devkit` instance this does.
 */
export function captureDevkitLogger() {
  const logger = requireFromRepo('@nx/devkit').logger;
  const original = { info: logger.info, warn: logger.warn, error: logger.error };
  const lines = [];
  for (const level of Object.keys(original)) logger[level] = (...args) => lines.push(`[${level}] ${args.join(' ')}`);
  return {
    lines,
    reset: () => lines.splice(0),
    restore: () => Object.assign(logger, original),
  };
}

/**
 * Assertion helpers handed to each fixture case (migrations and generators alike). Deliberately tiny — a
 * fixture should read as a statement about a workspace, not as a test framework.
 */
export function treeAssertions(tree, failures) {
  const read = (path) => tree.read(path, 'utf8') ?? '';
  const record = (ok, message) => {
    if (!ok) failures.push(message);
  };
  return {
    read,
    /** Parsed JSON at `path` (undefined when absent). */
    json: (path) => (tree.exists(path) ? JSON.parse(read(path)) : undefined),
    /** Deep equality, reported with both sides. */
    equal: (actual, expected, message) =>
      record(JSON.stringify(actual) === JSON.stringify(expected), `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
    ok: (cond, message) => record(Boolean(cond), message),
    exists: (path) => record(tree.exists(path), `expected ${path} to exist`),
    missing: (path) => record(!tree.exists(path), `expected ${path} NOT to exist`),
    has: (path, needle) => record(read(path).includes(needle), `expected ${path} to contain ${JSON.stringify(needle)}`),
    hasNot: (path, needle) =>
      record(!read(path).includes(needle), `expected ${path} NOT to contain ${JSON.stringify(needle)}`),
    occurrences: (path, needle, n) => {
      const found = read(path).split(needle).length - 1;
      record(found === n, `expected ${n}× ${JSON.stringify(needle)} in ${path}, found ${found}`);
    },
    /** A provider is WIRED when it is called on a line that is not a comment. */
    wired: (path, providerFn) =>
      record(
        read(path).split('\n').some((line) => !line.trimStart().startsWith('//') && line.includes(`${providerFn}(`)),
        `expected ${providerFn}() to be wired (uncommented) in ${path}`
      ),
    notWired: (path, providerFn) =>
      record(
        !read(path).split('\n').some((line) => !line.trimStart().startsWith('//') && line.includes(`${providerFn}(`)),
        `expected ${providerFn}() NOT to be wired in ${path}`
      ),
  };
}
