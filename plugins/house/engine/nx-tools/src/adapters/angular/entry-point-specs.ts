// What @nx/angular:unit-test finds, and how a library is told to find the rest.
//
// The executor looks only under the project's source root (<library>/src), and a secondary entry point lives beside it, at
// <library>/<entry>. So a spec in an entry never runs: a failing one exits 0 beside any passing spec in src, and with no
// other spec the target fails "No tests found". Verified on @nx/angular 24.0 / @angular/build 22.2, and watched by the
// Angular tripwire (tools/test-angular-ts-solution), because nothing but a real run can notice the builder's glob moving.
// @angular/build:unit-test is the same builder, under the name an Angular CLI library brings. Jest's root is the library,
// so it needs none of this. vitest-analog is what a library with no build gets, where an entry point, which is an
// ng-packagr concept, means nothing. Anything else may share the blindness, so it is told.
import { type Tree, readProjectConfiguration, logger } from '@nx/devkit';
import { updateProjectConfigurationInPlace } from '../../generators/_utils/project-files';
import { updateJsonInPlace } from '../../generators/_utils/json-edits';
import { normalizedPath, under } from '../../generators/_utils/library-files';
import { UNIT_TEST_EXECUTORS, judgeEntryPointReach } from './entry-point-reach';

/** A test executor known to walk the whole library. */
const WALKS_THE_LIBRARY = new Set(['@nx/jest:jest']);

/**
 * Every spec of a library whose source root is `up` below its root. BOTH halves of the include are needed: the builder's
 * glob reports a file under its cwd by its cwd-relative path, which a `../` pattern never matches, so `../**` alone finds
 * the entry points and silently drops src.
 */
const specsOfTheLibrary = (up: string) => ['**/*.spec.ts', '**/*.test.ts', `${up}**/*.spec.ts`, `${up}**/*.test.ts`];
/**
 * The builder ignores `**\/node_modules/**` itself, but that pattern does not match above its cwd either. `dist` only at the
 * library's root: that is an output, and a folder of that name inside an entry may hold a spec.
 */
const notTheLibrarysOwn = (up: string) => [`${up}**/node_modules/**`, `${up}dist/**`];
/**
 * For tsconfig.spec.json, which is relative to the library: every entry's src, as tsconfig.lib.json holds them, not only
 * its specs. The runner type-checks an entry's spec without this (it hands the compiler the specs it found), so this is for
 * the editor and `tsc`: outside it, and excluded by tsconfig.lib.json, the spec is in no project of the library, so its test
 * globals do not resolve. Specs alone would fail a TS-solution typecheck, TS6307: a composite project must list what they import.
 */
const ENTRY_SOURCES = '**/src/**/*.ts';

/**
 * Makes `name`'s test target, and its tsconfig.spec.json, reach the specs of its entry points. Called by whatever gives a
 * library an entry point, because that is what makes the library need it. A project's own include/exclude, a source root
 * that `..` cannot climb out of into the library, or another runner that may share the blindness, is left and reported.
 */
export function reachEntryPointSpecs(tree: Tree, name: string): void {
  const project = readProjectConfiguration(tree, name);
  const runners = Object.entries(project.targets ?? {}).filter(([, target]) => UNIT_TEST_EXECUTORS.has(target.executor ?? ''));
  if (runners.length === 0) {
    const test = project.targets?.test;
    if (test && !WALKS_THE_LIBRARY.has(test.executor ?? '')) {
      logger.warn(`[angular] ${name}: its test target uses ${test.executor ?? 'a command'}, so \`nx test ${name}\` may not run the specs of its entry points (at <library>/<entry>). Check that it does.`);
    }
    return;
  }

  let aimed = false;
  let changed = false;
  for (const [targetName, target] of runners) {
    const reach = judgeEntryPointReach(project, target, specsOfTheLibrary, notTheLibrarysOwn);
    if (reach.kind === 'outside') {
      logger.warn(`[angular] ${name}: its source root ${reach.sourceRoot} is outside the library, so \`nx ${targetName} ${name}\` may not run the specs of its entry points. Check that it does.`);
    } else if (reach.kind === 'declared') {
      logger.warn(
        `[angular] ${name}: its ${targetName} target declares its own include/exclude, so it may not run the specs of its entry points (at <library>/<entry>). ` +
          `To run every spec in the library, its include is ${JSON.stringify(reach.include)} and its exclude ${JSON.stringify(reach.exclude)}.`,
      );
    } else {
      aimed = true;
      if (reach.kind === 'aim') {
        target.options = { ...target.options, include: reach.include, exclude: reach.exclude };
        changed = true;
      }
    }
  }
  if (changed) updateProjectConfigurationInPlace(tree, name, project);
  if (aimed) includeEntrySourcesInSpecTsconfig(tree, project.root);
}

/** Only adds to an include the file states: a tsconfig with none already holds everything under it. */
function includeEntrySourcesInSpecTsconfig(tree: Tree, root: string): void {
  const file = under(normalizedPath(root), 'tsconfig.spec.json');
  if (!tree.exists(file)) return;
  updateJsonInPlace<{ include?: string[] }>(tree, file, (json) => {
    if (json.include) json.include = [...new Set([...json.include, ENTRY_SOURCES])];
  });
}
