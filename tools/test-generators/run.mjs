#!/usr/bin/env node
/**
 * Run the `@bespunky/nx-tools` GENERATORS (and the seams under them) against fixture workspaces.
 *
 *   node tools/test-generators/run.mjs [case-name-substring]
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────────
 *
 * Workspace layouts and linking (docs/features/2026-10-02-workspace-layouts/) turned two facts every generator
 * used to ASSUME — "apps live in apps/", "a library is reached through a tsconfig path alias" — into facts every
 * generator now DETECTS. That multiplied the shapes a generator writes into: three layouts × two linking models ×
 * the package managers that declare a workspace member differently. Nine-plus cells, and a generator that is right
 * in the one its author tried is, by default, untested in the other eight.
 *
 * And its failures are the quiet kind. A library linked by an alias in a TS-solution workspace typechecks in the
 * editor and fails in CI; a dependency declared `^0.0.1` instead of `workspace:*` resolves — from the REGISTRY, to
 * the last published sibling rather than the one beside it; a project created outside every workspaces glob is
 * simply invisible to Nx. None of those throws in the generator. All of them were caught, while this was being
 * built, by throwaway scripts in a scratchpad — and a throwaway script protects nothing after the session that
 * wrote it ends. This is those scripts, made permanent.
 *
 * ── WHAT IT RUNS: THE COMPILED PAYLOAD ─────────────────────────────────────────────────────────────────
 *
 * The same build test-migrations and test-layers use (`tools/test-support/payload.mjs` — how, and why it must land
 * inside the repo). A case loads modules out of it with `ctx.load('<path under src/>')`.
 *
 * ── IDEMPOTENCE IS CHECKED FOR EVERY CASE, BY THE HARNESS ──────────────────────────────────────────────
 *
 * A house generator re-runs on every upgrade. A second run that changes something is a sync that never settles —
 * a diff in every consumer's repo, every time. So the runner calls each case's `run` TWICE and fails the case if
 * the second call altered the tree; no fixture has to remember to ask. A case whose operation is one-way by
 * definition (deleting a library) opts out with `once: '<why>'` — the reason is printed with the result, so an
 * exemption is always visible, never a silent hole.
 *
 * ── CASES THAT NEED A FRAMEWORK PLUGIN ─────────────────────────────────────────────────────────────────
 *
 * Some generators delegate to `@nx/js` or `@nx/angular` — optional peers of the payload, and NOT devDependencies
 * of this repo (both are heavy). A case declares them in `needs: [...]`; when one is not resolvable the case is
 * SKIPPED, named, and counted in the summary line — never silently passed. `--strict` turns a skip into a failure,
 * for a run that is supposed to have everything. The Angular paths that only a real install can prove are guarded
 * separately by tools/test-angular-ts-solution/ (real network, real build).
 *
 * ── ADDING A CASE ──────────────────────────────────────────────────────────────────────────────────────
 *
 * One file in `cases/`, no wiring:
 *
 *   export default {
 *     name: 'suite name',
 *     cases: [{
 *       name: 'what it should do',
 *       needs: ['@nx/js'],                    // optional
 *       once: 'why a second run is not meaningful',   // optional — exempts the idempotence check
 *       setup: (ctx) => workspace({ ... }),   // returns the Tree (see workspaces.mjs for the shapes)
 *       run: async (tree, ctx) => { ... },    // the operation under test — called twice
 *       expect: (tree, t, ctx) => { ... },    // t: tools/test-support treeAssertions; ctx.logs: the FIRST run's log
 *     }],
 *   };
 */
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compilePayload,
  requireInstalled,
  resolvable,
  snapshot,
  snapshotDiff,
  unparseable,
  floatingWrites,
  captureDevkitLogger,
  treeAssertions,
} from '../test-support/payload.mjs';

/** A log line that says the tree changed — false on a run that changed nothing. */
const CLAIMS_A_CHANGE = /\b(?:Rewrote|Rewrites|Wrote|Updated|Created|Added|Removed|Seeded|Pinned|Moved|Replaced|Wired|Retargeted|Adopted)\b/;

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const only = args.find((a) => !a.startsWith('--'));

async function main() {
  requireInstalled(
    [
      ['@nx/devkit', "the fixtures use @nx/devkit's in-memory Tree"],
      ['typescript', 'the payload is transpiled before it is tested'],
    ],
    'Generator tests',
  );

  process.stdout.write('compiling the payload… ');
  let payload;
  try {
    payload = compilePayload('bespunky-generator-tests');
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exit(2);
  }
  console.log('ok');

  const log = captureDevkitLogger();
  // The framework generators a case delegates to (@nx/js, @nx/angular) and Nx itself print around the devkit logger —
  // `console` (deprecation notices, "Fetching prettier…") and Nx's `output`, which writes to the streams. Same
  // treatment as the logger: captured while a case runs, shown only under a failure. (One line escapes, as in every
  // suite on an in-memory Tree: "NX workspace root does not exist: /virtual" comes from Nx's NATIVE module, writing
  // to the file descriptor itself — harmless, and out of reach of anything in-process.)
  const say = (line) => process.stdout.write(`${line}\n`);
  const quiet = (fn) => async (...a) => {
    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    const streams = { out: process.stdout.write, err: process.stderr.write };
    for (const level of Object.keys(original)) console[level] = (...args) => log.lines.push(`[console.${level}] ${args.join(' ')}`);
    const sink = (name) => (chunk, ...rest) => {
      const text = String(chunk).trim();
      if (text) log.lines.push(`[${name}] ${text}`);
      const done = rest.find((r) => typeof r === 'function');
      if (done) done();
      return true;
    };
    process.stdout.write = sink('stdout');
    process.stderr.write = sink('stderr');
    try {
      return await fn(...a);
    } finally {
      Object.assign(console, original);
      process.stdout.write = streams.out;
      process.stderr.write = streams.err;
    }
  };
  const caseDir = join(HERE, 'cases');
  const suites = [];
  for (const file of (await readdir(caseDir)).filter((f) => f.endsWith('.mjs')).sort()) {
    suites.push({ file, ...(await import(pathToFileURL(join(caseDir, file)).href)).default });
  }

  let passed = 0;
  let failed = 0;
  const skipped = [];

  for (const suite of suites) {
    const selected = suite.cases.filter((c) => !only || `${suite.name} ${c.name}`.toLowerCase().includes(only.toLowerCase()));
    if (selected.length) say(`\n${suite.name}`);
    for (const testCase of selected) {

      const absent = (testCase.needs ?? []).filter((pkg) => !resolvable(pkg));
      if (absent.length) {
        skipped.push(`${suite.name} · ${testCase.name} (needs ${absent.join(', ')})`);
        if (strict) failed++;
        say(`  ${strict ? 'FAIL' : 'skip'} ${testCase.name} — needs ${absent.join(', ')}, not installed`);
        continue;
      }

      const failures = [];
      log.reset();
      const ctx = { load: payload.load, logs: [] };
      try {
        const tree = await quiet(testCase.setup)(ctx);
        log.reset(); // ctx.logs is what the operation under test said, not its setup
        const beforeRun = snapshot(tree);
        await quiet(testCase.run)(tree, ctx);
        ctx.logs = [...log.lines];
        for (const error of unparseable(beforeRun, snapshot(tree))) failures.push(`wrote a file that does not parse: ${error}`);
        // No generator writes a version nobody chose — through ANY write path (0.50.0; see cases/versions.mjs).
        for (const entry of floatingWrites(beforeRun, snapshot(tree), payload.load('generators/_utils/version-spec').isFloatingSpec)) {
          failures.push(`wrote a floating dependency version: ${entry}`);
        }
        if (!testCase.once) {
          const afterFirst = snapshot(tree);
          log.reset();
          await quiet(testCase.run)(tree, ctx); // Idempotence is the harness's job — see the header.
          const changed = snapshotDiff(afterFirst, snapshot(tree));
          if (changed.length) failures.push(`not idempotent — a second run changed: ${changed.join(', ')}`);
          // …and so is honesty: a second run that changed nothing must not CLAIM a change (a notice that fires on
          // every no-op upgrade is one everyone learns to ignore).
          const claims = changed.length ? [] : log.lines.filter((line) => CLAIMS_A_CHANGE.test(line));
          if (claims.length) failures.push(`a no-op second run claims a change: ${claims.map((l) => l.split('\n')[0]).join(' | ')}`);
        }
        await testCase.expect(tree, treeAssertions(tree, failures), ctx);
      } catch (error) {
        failures.push(`threw: ${error.stack || error.message}`);
      }

      if (failures.length === 0) {
        passed++;
        say(`  ok   ${testCase.name}${testCase.once ? `  (run once: ${testCase.once})` : ''}`);
      } else {
        failed++;
        say(`  FAIL ${testCase.name}`);
        for (const failure of failures) say(`         ${failure}`);
        for (const line of log.lines) say(`         ${line.replace(/\n/g, '\n         ')}`);
      }
    }
  }

  log.restore();
  payload.dispose();
  const skipNote = skipped.length ? `, ${skipped.length} skipped (a framework plugin is not installed — see the header; --strict fails them)` : '';
  console.log(`\n${failed === 0 ? 'ok' : 'FAILED'}: ${passed} passed, ${failed} failed${skipNote}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
