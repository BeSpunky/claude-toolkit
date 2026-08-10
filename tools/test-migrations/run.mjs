#!/usr/bin/env node
/**
 * Run the `@bespunky/nx-tools` MIGRATIONS against fixture workspaces.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────────
 *
 * A migration is the only code in this repo that writes into OTHER PEOPLE'S repositories, one way, with no
 * undo beyond a git tag. It runs once, on a machine nobody here is sitting at, against a workspace shape
 * nobody here has seen. And its failures are silent by construction: a migration that writes nothing looks
 * exactly like a migration with nothing to do.
 *
 * `tools/test-scaffold/run.sh` already makes this argument for the scaffolder's refusals — "a gate that
 * stops refusing looks exactly like a gate with nothing to catch." Every word of it applies here, and the
 * ladder had thirteen rungs with no test between them.
 *
 * The immediate evidence: a throwaway version of these fixtures, written while reviewing the 0.33.0 rung,
 * caught five defects that four reading passes had missed — a tree walk that entered `.claude/worktrees/`
 * and would have edited another branch's source, sibling files that could not compile against the config
 * they were written beside, an "already migrated" check that matched on identifier name so a project with
 * its own same-named provider was silently skipped AND logged as a success, an import path derived from a
 * suffix match that pointed at files nobody wrote, and a rewrite that stopped at the first call site in a
 * file. None of those is subtle to a fixture. All of them are invisible to a reader.
 *
 * ── WHAT IT RUNS AGAINST: THE COMPILED PAYLOAD, NOT THE SOURCE ─────────────────────────────────────────
 *
 * Migrations ship as JavaScript — `nx migrate` loads them out of `node_modules`, transpiled by
 * `assets/compile-generators.mts`. So the harness compiles the payload the same way and imports the RESULT.
 * Testing the TypeScript source instead would leave the transpile step — the one thing between what is
 * written here and what consumers execute — untested.
 *
 * The build lands under `node_modules/.cache/` for a reason that is easy to trip over: the migrations reach
 * for the TypeScript compiler API with a bare `require('typescript')`, resolved from the compiled module's
 * OWN location. Compile to `os.tmpdir()` and that resolution walks up to `/` and finds nothing, so every
 * AST-based migration degrades to its "no TypeScript here" branch and the suite passes while testing
 * almost nothing. Inside the repo, resolution walks up into the repo's own `node_modules` and finds both
 * `typescript` and `@nx/devkit`.
 *
 * ── IDEMPOTENCE IS CHECKED FOR EVERY CASE, BY THE HARNESS ──────────────────────────────────────────────
 *
 * Re-running a rung immediately after itself must change nothing — that is a property of every migration,
 * not a thing each fixture should have to remember. So the runner runs each rung, runs it a second time,
 * and fails the case if the second run altered the tree. Note the shape of the claim: PER RUNG, not per
 * ladder. Re-running a whole ladder is legitimately not idempotent (a later rung can create the anchor an
 * earlier rung looks for), and asserting that would be asserting something false.
 *
 * Usage:  node tools/test-migrations/run.mjs [case-name-substring]
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PAYLOAD = join(REPO, 'plugins/project-starter/skills/new-project/assets/nx-tools');
const COMPILER = join(REPO, 'plugins/project-starter/skills/new-project/assets/compile-generators.mts');
// Inside the repo, so `require('typescript')` from a compiled migration resolves. See the header.
const BUILD = join(REPO, 'node_modules/.cache/bespunky-migration-tests');

const only = process.argv[2];

/** Compile the payload's TypeScript exactly as the publisher does, into a throwaway build dir. */
function buildPayload() {
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  cpSync(join(PAYLOAD, 'src'), join(BUILD, 'src'), { recursive: true });
  execFileSync(process.execPath, [COMPILER, BUILD], { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * Assertion helpers handed to each case. Deliberately tiny — a fixture should read as a statement about a
 * workspace, not as a test framework.
 */
function assertions(tree, failures) {
  const read = (path) => tree.read(path, 'utf8') ?? '';
  const record = (ok, message) => {
    if (!ok) failures.push(message);
  };
  return {
    read,
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

/** Snapshot every file in the tree, so a rung's second run can be compared against its first. */
function snapshot(tree) {
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

async function main() {
  // Both preconditions, named individually. A raw module-resolution stack trace out of the compile step is
  // a genuinely bad first experience for a tool nobody has run before — and `typescript` is the one that
  // actually bites, because it was added to this repo FOR this harness, so any checkout predating it has
  // @nx/devkit present and TypeScript absent.
  const missing = [
    ['@nx/devkit', "the fixtures use @nx/devkit's in-memory Tree"],
    ['typescript', 'the payload is transpiled, and the migrations use the TypeScript compiler API'],
  ].filter(([pkg]) => !existsSync(join(REPO, 'node_modules', pkg)));

  if (missing.length > 0) {
    console.error('Migration tests need the workspace installed:');
    for (const [pkg, why] of missing) console.error(`  • ${pkg} is not installed — ${why}`);
    console.error('\n  yarn install   # then re-run');
    process.exit(2);
  }

  process.stdout.write('compiling the payload… ');
  try {
    buildPayload();
  } catch (error) {
    console.error('\nCould not compile the payload:\n' + (error.stderr?.toString() || error.message));
    process.exit(2);
  }
  console.log('ok');

  const require_ = createRequire(join(REPO, 'noop.js'));
  const { createTreeWithEmptyWorkspace } = require_('@nx/devkit/testing');

  // Migrations report to the devkit logger, and that reporting is part of what they are FOR — several of
  // them do nothing but explain what they refused to guess at. So it is captured per case rather than
  // silenced: invisible while a case passes, printed in full under one that fails, where it is usually the
  // fastest explanation of why. Patching the shared logger object works because every compiled migration
  // resolves the same `@nx/devkit` instance this does.
  const devkitLogger = require_('@nx/devkit').logger;
  const original = { info: devkitLogger.info, warn: devkitLogger.warn, error: devkitLogger.error };
  let captured = [];
  for (const level of ['info', 'warn', 'error']) {
    devkitLogger[level] = (...args) => captured.push(`[${level}] ${args.join(' ')}`);
  }

  const caseDir = join(HERE, 'cases');
  const suites = [];
  for (const file of (await readdir(caseDir)).filter((f) => f.endsWith('.mjs')).sort()) {
    suites.push({ file, ...(await import(pathToFileURL(join(caseDir, file)).href)).default });
  }

  let passed = 0;
  let failed = 0;

  for (const suite of suites) {
    console.log(`\n${suite.name}`);
    for (const testCase of suite.cases) {
      if (only && !`${suite.name} ${testCase.name}`.toLowerCase().includes(only.toLowerCase())) continue;

      const failures = [];
      captured = [];
      const tree = createTreeWithEmptyWorkspace();
      try {
        testCase.setup(tree);
        for (const rung of testCase.ladder ?? suite.ladder) {
          const migrate = require_(join(BUILD, 'src/migrations', rung)).default;
          await migrate(tree);
          const afterFirst = snapshot(tree);
          await migrate(tree); // Idempotence is the harness's job, not each fixture's. See the header.
          if (snapshot(tree) !== afterFirst) failures.push(`rung ${rung} is not idempotent — a second run changed the tree`);
        }
        testCase.expect(tree, assertions(tree, failures));
      } catch (error) {
        failures.push(`threw: ${error.stack || error.message}`);
      }

      if (failures.length === 0) {
        passed++;
        console.log(`  ok   ${testCase.name}`);
      } else {
        failed++;
        console.log(`  FAIL ${testCase.name}`);
        for (const failure of failures) console.log(`         ${failure}`);
        for (const line of captured) console.log(`         ${line.replace(/\n/g, '\n         ')}`);
      }
    }
  }

  Object.assign(devkitLogger, original);
  rmSync(BUILD, { recursive: true, force: true });
  console.log(`\n${failed === 0 ? 'ok' : 'FAILED'}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
