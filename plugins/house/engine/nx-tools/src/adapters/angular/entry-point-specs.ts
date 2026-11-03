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
import { type SpecTsconfig, UNIT_TEST_EXECUTORS, holdEntrySources, judgeEntryPointReach } from './entry-point-reach';

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
/** ENTRY_SOURCES also matches a build output at the library's root. Only there: a folder of that name inside an entry may hold a source. */
const NOT_SOURCES = 'dist/**';

/**
 * Makes `name`'s unit-test targets, and its tsconfig.spec.json, reach every spec in the library, entry points or not. The
 * library port states this at birth, so an entry point made later, by anyone, is reached by construction: with no entry
 * and no spec it changes nothing about "No tests found", because src is still in the include. A project's own
 * include/exclude, or a source root that `..` cannot climb out of into the library, is left and reported.
 */
export function aimUnitTestTargets(tree: Tree, name: string): void {
  const project = readProjectConfiguration(tree, name);
  const runners = Object.entries(project.targets ?? {}).filter(([, target]) => UNIT_TEST_EXECUTORS.has(target.executor ?? ''));

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

/**
 * The same, for whatever gives a library an entry point, which is the one moment it is owed even by a library this port
 * did not make, or made before it stated this. Another runner that may share the blindness is told here, and not at
 * birth, because only now does it have something to miss.
 */
export function reachEntryPointSpecs(tree: Tree, name: string): void {
  const targets = readProjectConfiguration(tree, name).targets ?? {};
  if (!Object.values(targets).some((target) => UNIT_TEST_EXECUTORS.has(target.executor ?? ''))) {
    const test = targets.test;
    if (test && !WALKS_THE_LIBRARY.has(test.executor ?? '')) {
      logger.warn(`[angular] ${name}: its test target uses ${test.executor ?? 'a command'}, so \`nx test ${name}\` may not run the specs of its entry points (at <library>/<entry>). Check that it does.`);
    }
    return;
  }
  aimUnitTestTargets(tree, name);
}

function includeEntrySourcesInSpecTsconfig(tree: Tree, root: string): void {
  const file = under(normalizedPath(root), 'tsconfig.spec.json');
  if (!tree.exists(file)) return;
  updateJsonInPlace<SpecTsconfig>(tree, file, (json) => holdEntrySources(json, ENTRY_SOURCES, NOT_SOURCES));
}
