// 0.51.2 — a library the house left with no spec fails `nx test`, on the runners that can be told not to.
//
// WHY IT FAILS. Vitest and Jest exit 1 on "no tests found", and three house generators remove a library's only spec:
//   - navigation-core deletes the demo under src/lib and writes a vendored kernel with no spec. Its runner is Vitest
//     through Analog, or Jest below Angular 21;
//   - design-system prunes the demo. On @nx/angular:unit-test truthful-angular-library-tests gives it a real spec, because that
//     executor has no such option; below Angular 21 it is Jest, and on Nx 24 no targetDefault saves it;
//   - adopt-extracted --keepShim deletes the library's src/lib, leaving a re-export.
//
// WHAT THIS DOES. Sets `passWithNoTests: true` in the library's runner config, where the generators now set it on
// creation. In the config, because Nx infers these targets: there is no target to put an option on. Observed for real on
// Nx 24.0.3: exit 1 without it, exit 0 with it, exit 1 again the moment a spec fails. Only a library with no spec anywhere gets it.
//
// SKIPPED: a library with any spec has nothing to do. SKIPPED, WITH A REPORT:
//   - a test target with another executor or command: the option is not known to reach that runner;
//   - a target, a configuration of it or a config that already says passWithNoTests: false, which is the project's decision;
//   - a target naming a config that does not exist, a configuration naming one of its own; no runner config, or several;
//   - a config without the one `test: {` block or `module.exports = {` / `export default {` line the generators write,
//     read with comments and strings blanked out, or one declaring several projects or computing the option.
//
// FROZEN by the migration contract: every value is a copy, not an import from the generators. What it shares with them is
// the pure mechanics that take those values as parameters (_utils/pass-with-no-tests, _utils/library-files), and the
// question of what a project is (adapters/registry), which holds no value.
import { type ProjectConfiguration, type Tree, getProjects, logger } from '@nx/devkit';
import { projectRole } from '../../adapters/registry';
import { normalizedPath, otherProjectRoots, under } from '../../generators/_utils/library-files';
import { statePassWithNoTests } from '../../generators/_utils/pass-with-no-tests';

const TAG = '[migrate 0.51.2 pass-libraries-with-no-specs]';
const NAVIGATION_TAG = 'type:navigation';
const DESIGN_SYSTEM_TAG = 'type:design-system';
/** The name a hand-made or pre-tag design system goes by: a generator finds it by this, and tags it after this rung ran. */
const DESIGN_SYSTEM_NAME = 'design-system';
/** adopt-extracted's marker, and the status --keepShim leaves in it. */
const EXTRACTION_MARKER = 'extraction.json';
const SHIM_STATUS = 'adopted-shim';
const CONFIG_READING_EXECUTORS = new Set(['@nx/vite:test', '@nx/vitest:test', '@nx/jest:jest']);
const RUNNER_CONFIGS = ['vitest', 'vite', 'jest'].flatMap((runner) =>
  ['mts', 'ts', 'cts', 'mjs', 'js', 'cjs'].map((extension) => `${runner}.config.${extension}`),
);
const NOTE = 'This library ships no spec of its own. A spec the runner is set to find still runs, and still fails the target when it fails.';

export default function update(tree: Tree): void {
  const projects = getProjects(tree);
  const hasDesignSystem = [...projects.values()].some((project) => project.tags?.includes(DESIGN_SYSTEM_TAG));
  for (const [name, project] of projects) {
    const preTagDesignSystem = !hasDesignSystem && name === DESIGN_SYSTEM_NAME && projectRole(tree, name) === 'library';
    if (project.tags?.includes(NAVIGATION_TAG) || project.tags?.includes(DESIGN_SYSTEM_TAG) || preTagDesignSystem || isShim(tree, project)) {
      state(tree, name, project, otherProjectRoots(projects.values(), project.root));
    }
  }
}

function isShim(tree: Tree, project: ProjectConfiguration): boolean {
  const marker = under(normalizedPath(project.root), EXTRACTION_MARKER);
  if (!tree.exists(marker)) return false;
  try {
    return JSON.parse(tree.read(marker, 'utf8') ?? '{}').status === SHIM_STATUS;
  } catch {
    return false;
  }
}

function state(tree: Tree, name: string, project: ProjectConfiguration, stops: ReadonlySet<string>): void {
  const left = (why: string) =>
    logger.warn(`${TAG} Left ${name}: ${why}. If \`nx test ${name}\` reports no tests, add a spec or tell its runner \`passWithNoTests\`.`);
  const result = statePassWithNoTests(tree, project, { configReadingExecutors: CONFIG_READING_EXECUTORS, runnerConfigs: RUNNER_CONFIGS, note: NOTE, stops });
  switch (result.kind) {
    case 'stated':
      return logger.info(`${TAG} ${result.file}: \`passWithNoTests: true\`, so \`nx test ${name}\` stops failing on a library with no spec. A spec that fails still fails it.`);
    case 'has-spec':
      return logger.info(`${TAG} Left ${name}: it has its own spec (${result.spec}), so there is nothing to pass without.`);
    case 'decided':
      if (!result.value) left(`${result.source} says \`passWithNoTests: false\`, which is its decision`);
      return;
    case 'other-runner':
      return left(`its test target uses ${result.executor ?? 'a command'}, which this option is not known to reach`);
    case 'no-config':
      return left('it has no vite, vitest or jest config at its root');
    case 'unrecognised':
      return left(result.reason);
  }
}
