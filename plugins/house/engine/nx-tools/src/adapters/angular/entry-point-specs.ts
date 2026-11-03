// What @nx/angular:unit-test finds, and how a library is told to find the rest.
//
// The executor looks only under the project's source root (<library>/src), and a secondary entry point lives beside it, at
// <library>/<entry>. So a spec in an entry never runs: a failing one exits 0 beside any passing spec in src, and with no
// other spec the target fails "No tests found". Verified on @nx/angular 24.0 / @angular/build 22.2. Other runners are not
// in this: Jest's root is the library, and vitest-analog is what a library with no build gets, where an entry point, which
// is an ng-packagr concept, means nothing.
import { type Tree, readProjectConfiguration, logger } from '@nx/devkit';
import { updateProjectConfigurationInPlace } from '../../generators/_utils/project-files';
import { updateJsonInPlace } from '../../generators/_utils/json-edits';

const EXECUTOR = '@nx/angular:unit-test';

/**
 * Every spec of a library whose source root is `up` below its root. BOTH halves of the include are needed: the builder's
 * glob reports a file under its cwd by its cwd-relative path, which a `../` pattern never matches, so `../**` alone finds
 * the entry points and silently drops src.
 */
const specsOfTheLibrary = (up: string) => ['**/*.spec.ts', '**/*.test.ts', `${up}**/*.spec.ts`, `${up}**/*.test.ts`];
/** The builder ignores `**\/node_modules/**` itself, but that pattern does not match above its cwd either. */
const notTheLibrarysOwn = (up: string) => [`${up}**/node_modules/**`, `${up}**/dist/**`];
/**
 * For tsconfig.spec.json, which is relative to the library: every entry's src, as tsconfig.lib.json holds them, not only
 * its specs. The runner type-checks an entry's spec without this (it hands the compiler the specs it found), so this is for
 * the editor and `tsc`: outside it, and excluded by tsconfig.lib.json, the spec is in no project of the library, so its test
 * globals do not resolve. Specs alone would fail a TS-solution typecheck, TS6307: a composite project must list what they import.
 */
const ENTRY_SOURCES = '**/src/**/*.ts';

/**
 * Makes `name`'s test target, and its tsconfig.spec.json, reach the specs of its entry points. Called by whatever gives a
 * library an entry point, because that is what makes the library need it. Nothing to do on another runner. A project's own
 * include/exclude, or a source root that `..` cannot climb out of into the library, is left and reported.
 */
export function reachEntryPointSpecs(tree: Tree, name: string): void {
  const project = readProjectConfiguration(tree, name);
  const runners = Object.entries(project.targets ?? {}).filter(([, target]) => target.executor === EXECUTOR);
  if (runners.length === 0) return;

  const sourceRoot = project.sourceRoot ?? `${project.root}/src`;
  if (sourceRoot !== project.root && !sourceRoot.startsWith(`${project.root}/`)) {
    logger.warn(`[angular] ${name}: its source root ${sourceRoot} is outside the library, so \`nx test ${name}\` may not run the specs of its entry points. Check that it does.`);
    return;
  }
  // A source root that IS the library: the runner's default already walks everything in it, so `up` is empty and no include is due.
  const up = sourceRoot === project.root ? '' : '../'.repeat(sourceRoot.slice(project.root.length + 1).split('/').length);
  const include = specsOfTheLibrary(up);
  const exclude = notTheLibrarysOwn(up);

  let aimed = false;
  let changed = false;
  for (const [targetName, target] of runners) {
    const ours = same(target.options?.include, include) && same(target.options?.exclude, exclude);
    if (!ours && [target.options, ...Object.values(target.configurations ?? {})].some((options) => options?.include || options?.exclude)) {
      logger.warn(
        `[angular] ${name}: its ${targetName} target declares its own include/exclude, so it may not run the specs of its entry points (at <library>/<entry>). ` +
          `To run every spec in the library, its include is ${JSON.stringify(include)} and its exclude ${JSON.stringify(exclude)}.`,
      );
      continue;
    }
    aimed = true;
    if (up && !ours) {
      target.options = { ...target.options, include, exclude };
      changed = true;
    }
  }
  if (changed) updateProjectConfigurationInPlace(tree, name, project);
  if (aimed) includeSpecsInTsconfig(tree, project.root);
}

/** Only adds to an include the file states: a tsconfig with none already holds everything under it. */
function includeSpecsInTsconfig(tree: Tree, root: string): void {
  const file = `${root}/tsconfig.spec.json`;
  if (!tree.exists(file)) return;
  updateJsonInPlace<{ include?: string[] }>(tree, file, (json) => {
    if (json.include) json.include = [...new Set([...json.include, ENTRY_SOURCES])];
  });
}

function same(actual: unknown, expected: string[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
