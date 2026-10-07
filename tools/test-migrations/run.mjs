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
 * Migrations ship as JavaScript — `nx migrate` loads them out of `node_modules` — so the harness compiles the
 * payload the way the publisher does and imports the RESULT. How, and why the build must land inside the repo
 * (or every AST-based migration silently degrades to its "no TypeScript here" branch), is shared with the
 * other payload harnesses: `tools/test-support/payload.mjs`.
 *
 * ── IDEMPOTENCE IS CHECKED FOR EVERY CASE, BY THE HARNESS ──────────────────────────────────────────────
 *
 * Re-running a rung immediately after itself must change nothing — that is a property of every migration,
 * not a thing each fixture should have to remember. So the runner runs each rung, runs it a second time,
 * and fails the case if the second run altered the tree. Note the shape of the claim: PER RUNG, not per
 * ladder. Re-running a whole ladder is legitimately not idempotent (a later rung can create the anchor an
 * earlier rung looks for), and asserting that would be asserting something false.
 *
 * ── HISTORICAL SHAPES CONVERGE, OR SAY WHY NOT ─────────────────────────────────────────────────────────
 *
 * Idempotence re-runs a rung on its OWN output, so it can never catch the bug that bit 0.24.3: an "already
 * current" guard keyed on ONE marker of the new shape, fooled by an intermediate shape an EARLIER release wrote
 * (a 0.7.1 repair's interface had every `default:` and no `proxied?`, was judged current, and stayed
 * half-migrated forever). So a case may declare `historicalShapes` — the same input as it really shipped from
 * earlier toolkit versions (taken from git, sha named) — and the harness runs the ladder on each and asserts
 * the result is IDENTICAL to the canonical input's. A shape that legitimately ends elsewhere declares
 * `diverges: '<reason>'` (and may bring its own `expect`); the reason is printed, and a declared divergence that
 * in fact converges FAILS, so a stale reason cannot outlive the fix that made it untrue.
 *
 * Usage:  node tools/test-migrations/run.mjs [case-name-substring]
 */
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compilePayload, requireInstalled, requireFromRepo, snapshot, snapshotDiff, unparseable, captureDevkitLogger, treeAssertions } from '../test-support/payload.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];

async function main() {
  // Both preconditions, named individually — `typescript` is the one that actually bites, because it was added
  // to this repo FOR this harness, so any checkout predating it has @nx/devkit present and TypeScript absent.
  requireInstalled(
    [
      ['@nx/devkit', "the fixtures use @nx/devkit's in-memory Tree"],
      ['typescript', 'the payload is transpiled, and the migrations use the TypeScript compiler API'],
    ],
    'Migration tests',
  );

  process.stdout.write('compiling the payload… ');
  let payload;
  try {
    payload = compilePayload('bespunky-migration-tests');
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exit(2);
  }
  console.log('ok');

  const { createTreeWithEmptyWorkspace } = requireFromRepo('@nx/devkit/testing');
  const log = captureDevkitLogger(); // printed under a failing case — see tools/test-support/payload.mjs

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
      const notes = [];
      log.reset();
      // One ladder run on a fresh fixture: idempotence and parse-ability checked per run, by the harness.
      const run = async (setup, label) => {
        const tree = createTreeWithEmptyWorkspace();
        setup(tree);
        const beforeLadder = snapshot(tree);
        for (const rung of testCase.ladder ?? suite.ladder) {
          const migrate = payload.load(`migrations/${rung}`).default;
          await migrate(tree);
          const afterFirst = snapshot(tree);
          await migrate(tree); // Idempotence is the harness's job, not each fixture's. See the header.
          if (snapshot(tree) !== afterFirst) failures.push(`${label}rung ${rung} is not idempotent — a second run changed ${snapshotDiff(afterFirst, snapshot(tree)).join(', ')}`);
        }
        for (const error of unparseable(beforeLadder, snapshot(tree))) failures.push(`${label}wrote a file that does not parse: ${error}`);
        return tree;
      };
      try {
        const tree = await run(testCase.setup, '');
        testCase.expect(tree, treeAssertions(tree, failures), log.lines); // log.lines: what the ladder reported
        const canonical = snapshot(tree);
        // Every shape an earlier release really wrote must land where the canonical input lands. See the header.
        for (const shape of testCase.historicalShapes ?? []) {
          const label = `historical shape "${shape.name}": `;
          const historical = await run(shape.setup, label);
          const differs = snapshotDiff(canonical, snapshot(historical));
          if (shape.diverges) {
            if (differs.length === 0) failures.push(`${label}declares it diverges (${shape.diverges}) but converged — drop the reason`);
            else notes.push(`${shape.name} diverges by design: ${shape.diverges}`);
            shape.expect?.(historical, treeAssertions(historical, failures), log.lines);
          } else if (differs.length > 0) {
            failures.push(`${label}did not converge with the canonical input — differs in ${differs.join(', ')}`);
          }
        }
      } catch (error) {
        failures.push(`threw: ${error.stack || error.message}`);
      }

      if (failures.length === 0) {
        passed++;
        const shapes = testCase.historicalShapes?.length;
        console.log(`  ok   ${testCase.name}${shapes ? ` (+${shapes} historical shape${shapes === 1 ? '' : 's'})` : ''}`);
        for (const note of notes) console.log(`         ${note}`);
      } else {
        failed++;
        console.log(`  FAIL ${testCase.name}`);
        for (const failure of failures) console.log(`         ${failure}`);
        for (const line of log.lines) console.log(`         ${line.replace(/\n/g, '\n         ')}`);
      }
    }
  }

  log.restore();
  payload.dispose();
  console.log(`\n${failed === 0 ? 'ok' : 'FAILED'}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
