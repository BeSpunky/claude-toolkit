// 0.51.2 — a library the house left with no spec fails `nx test`, on the runners that can be told not to.
//
// WHY IT FAILS. Vitest and Jest exit 1 on "no tests found", and three house generators remove a library's only spec:
//   - navigation-core deletes the demo under src/lib and writes a vendored kernel with no spec. Its runner is Vitest
//     through Analog, or Jest below Angular 21;
//   - design-system prunes the demo. On @nx/angular:unit-test seed-design-system-spec gives it a real spec, because that
//     executor has no such option; below Angular 21 it is Jest, and on Nx 24 no targetDefault saves it;
//   - adopt-extracted --keepShim deletes the library's src/lib, leaving a re-export.
//
// WHAT THIS DOES. Sets `passWithNoTests: true` in the library's runner config, where the generators now set it on
// creation. In the config, because Nx infers these targets: there is no target to put an option on. Observed for real on
// Nx 24.0.3: exit 1 without it, exit 0 with it, exit 1 again the moment a spec fails, so it hides no suite.
//
// SKIPPED: a library with any spec has nothing to do. SKIPPED, WITH A REPORT:
//   - a test target with another executor or command: the option is not known to reach that runner;
//   - a target or config that already says passWithNoTests: false, which is the project's decision;
//   - a target naming a config that does not exist; no runner config, or several;
//   - a config without the one `test: {` block or `module.exports = {` / `export default {` line the generators write,
//     or one declaring several projects.
//
// SELF-CONTAINED by the migration contract: every value is a frozen copy, not an import from the generators.
import { type ProjectConfiguration, type Tree, getProjects, logger } from '@nx/devkit';

const TAG = '[migrate 0.51.2 pass-libraries-with-no-specs]';
const NAVIGATION_TAG = 'type:navigation';
const DESIGN_SYSTEM_TAG = 'type:design-system';
/** The name a hand-made or pre-tag design system goes by: a generator finds it by this, and tags it after this rung ran. */
const DESIGN_SYSTEM_NAME = 'design-system';
/** adopt-extracted's marker, and the status --keepShim leaves in it. */
const EXTRACTION_MARKER = 'extraction.json';
const SHIM_STATUS = 'adopted-shim';
/** What reads the runner's own config file. No target at all is an inferred one, which runs the runner in the project's root. */
const CONFIG_READING_EXECUTORS = new Set(['@nx/vite:test', '@nx/vitest:test', '@nx/jest:jest']);
const RUNNER_CONFIGS = ['vitest', 'vite', 'jest'].flatMap((runner) =>
  ['mts', 'ts', 'cts', 'mjs', 'js', 'cjs'].map((extension) => `${runner}.config.${extension}`),
);
const ANY_SPEC = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist']);
const OPTION = /^(?!\s*\/\/).*\bpassWithNoTests\s*:\s*(true|false)/m;
const MULTI_PROJECT = /^\s*(?:projects|workspace)\s*:/m;
const VITE_ANCHOR = /^([ \t]*)test:\s*\{[ \t]*$/gm;
const JEST_ANCHOR = /^()(?:module\.exports\s*=|export default)\s*\{[ \t]*$/gm;
const NOTE = 'This library ships no spec of its own. A spec added later still runs, and still fails the target when it fails.';

export default function update(tree: Tree): void {
  const projects = getProjects(tree);
  const hasDesignSystem = [...projects.values()].some((project) => project.tags?.includes(DESIGN_SYSTEM_TAG));
  for (const [name, project] of projects) {
    const preTagDesignSystem = !hasDesignSystem && name === DESIGN_SYSTEM_NAME && project.projectType !== 'application';
    if (project.tags?.includes(NAVIGATION_TAG) || project.tags?.includes(DESIGN_SYSTEM_TAG) || preTagDesignSystem || isShim(tree, project)) {
      state(tree, name, project);
    }
  }
}

function isShim(tree: Tree, project: ProjectConfiguration): boolean {
  const marker = `${project.root}/${EXTRACTION_MARKER}`;
  if (!tree.exists(marker)) return false;
  try {
    return JSON.parse(tree.read(marker, 'utf8') ?? '{}').status === SHIM_STATUS;
  } catch {
    return false;
  }
}

function state(tree: Tree, name: string, project: ProjectConfiguration): void {
  const spec = firstSpec(tree, project.root);
  if (spec) return logger.info(`${TAG} Left ${name}: it has its own spec (${spec}), so there is nothing to pass without.`);

  const left = (why: string) =>
    logger.warn(`${TAG} Left ${name}: ${why}. If \`nx test ${name}\` reports no tests, add a spec or tell its runner \`passWithNoTests\`.`);
  const target = project.targets?.test;
  if (target && !CONFIG_READING_EXECUTORS.has(target.executor ?? '')) {
    return left(`its test target uses ${target.executor ?? 'a command'}, which this option is not known to reach`);
  }
  const options = (target?.options ?? {}) as { passWithNoTests?: boolean; configFile?: string; jestConfig?: string };
  if (options.passWithNoTests === true) return;
  if (options.passWithNoTests === false) return left('its test target says `passWithNoTests: false`, which is its decision');

  const named = options.configFile ?? options.jestConfig;
  if (named && !tree.exists(named)) return left(`its test target names ${named}, which is not a file here`);
  const configs = named ? [named] : RUNNER_CONFIGS.map((config) => `${project.root}/${config}`).filter((config) => tree.exists(config));
  if (configs.length === 0) return left('it has no vite, vitest or jest config at its root');
  if (configs.length > 1) return left(`it has several runner configs (${configs.join(', ')})`);

  const file = configs[0];
  const text = tree.read(file, 'utf8') ?? '';
  const decided = OPTION.exec(text);
  if (decided) {
    if (decided[1] === 'false') left(`${file} says \`passWithNoTests: false\`, which is its decision`);
    return;
  }
  if (MULTI_PROJECT.test(text)) return left(`${file} declares several projects`);
  const jest = /(?:^|\/)[^/]*jest[^/]*$/.test(file);
  const anchors = [...text.matchAll(jest ? JEST_ANCHOR : VITE_ANCHOR)];
  if (anchors.length !== 1) {
    const expected = jest ? 'one `module.exports = {` or `export default {`' : 'one `test: {` block';
    return left(`${file} does not have ${expected} on a line of its own`);
  }
  const end = anchors[0].index + anchors[0][0].length;
  const indent = /^[ \t]*(?=\S)/m.exec(text.slice(end + 1))?.[0];
  const inner = indent && indent.length > anchors[0][1].length ? indent : `${anchors[0][1]}  `;
  tree.write(file, `${text.slice(0, end)}\n${inner}// ${NOTE}\n${inner}passWithNoTests: true,${text.slice(end)}`);
  logger.info(`${TAG} ${file}: \`passWithNoTests: true\`, so \`nx test ${name}\` stops failing on a library with no spec. A spec that fails still fails it.`);
}

function firstSpec(tree: Tree, dir: string): string | null {
  for (const child of tree.children(dir)) {
    const path = `${dir}/${child}`;
    if (tree.isFile(path)) {
      if (ANY_SPEC.test(child)) return path;
    } else if (!SKIPPED_DIRS.has(child) && !child.startsWith('.')) {
      const found = firstSpec(tree, path);
      if (found) return found;
    }
  }
  return null;
}
