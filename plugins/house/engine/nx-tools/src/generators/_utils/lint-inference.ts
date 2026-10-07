// HOW A HOUSE PROJECT IS LINTED — what Nx itself recommends today, never the deprecated `@nx/eslint:lint` executor.
//
// @nx/eslint deprecates its `lint` executor (removed in Nx 24: "Run `nx g @nx/eslint:convert-to-inferred` to migrate
// to the `@nx/eslint/plugin` inferred targets"). The supported shape is the INFERRED target that an `@nx/eslint/plugin`
// entry in nx.json gives every project under an ESLint config — its own, or the root one (a project without its own
// config is linted by the root config, which is how the functions project is linted).
//
// Two writers still produce the executor, and both are answered here:
//   - @nx/angular's add-linting (which its application and library generators call) passes `addExplicitTargets: true`
//     to @nx/eslint's lint-project, so it writes `"lint": { "executor": "@nx/eslint:lint" }` whatever the workspace
//     infers. Nx's answer, convert-to-inferred, cannot run inside a generator or a migration: it reads the project
//     graph from DISK, where a project linted moments ago in the Tree has no lint target yet. So `convertBareLint`
//     makes the conversion it would make, for exactly the bare target @nx/angular wrote;
//   - the house's own targets (functions:lint) ask `houseLintTarget` what to declare.
//
// WHETHER A PROJECT IS INFERRED is asked the way Nx answers it (`lintTargetFor`): an entry infers a target for a
// project when its `include`/`exclude` (nx.json — Nx's own matcher, ./globs) take the project's definition file AND
// the ESLint config that governs it. A workspace that scoped its entry (`include: ['libs/**']`) does not lint an app
// by inference, so the app keeps — or is given — an explicit target, and is never left with no lint at all.
//
// The plugin is registered as the entry `nx add @nx/eslint` writes (`{ plugin, options: { targetName: 'lint' } }`) —
// written as data, not through @nx/eslint's init generator, which builds the project graph from DISK (blind to the
// Tree, slow, and absent before an install) only to choose that same name. REGISTERING IT LINTS EVERY PROJECT under
// an ESLint config that has a lintable file, not only the one being created — so `registerLintInference` scopes the
// entry to code (an `exclude` for each project tagged `tooling`, and for a root that is only the workspace's shell),
// and REPORTS, by name, every project that gains a `lint` target with it: a project linted for the first time may
// fail lint on code nobody ever linted, and that should be news on the upgrade, not in CI.
//
// A workspace that turned inference OFF (`useInferencePlugins: false`, NX_ADD_PLUGINS=false) chose explicit targets:
// it gets one — `eslint .` in the project's root, the command the inferred target runs — and still not the
// deprecated executor.
import { type TargetConfiguration, type Tree, getProjects, logger, readJson } from '@nx/devkit';
import { updateJsonInPlace } from './json-edits';
import { projectDefinitionFile, updateProjectConfigurationInPlace } from './project-files';
import { pluginEntryMatches } from './globs';

const PLUGIN = '@nx/eslint/plugin';
/** The entry `nx add @nx/eslint` (its init generator's addPlugin) writes into nx.json `plugins`. */
const PLUGIN_ENTRY = { plugin: PLUGIN, options: { targetName: 'lint' } };
/** The deprecated executor — named here only to recognise it. */
const DEPRECATED_EXECUTOR = '@nx/eslint:lint';
/** The tag the house's tooling projects carry (shared browser, worktree domains, the emulator suite). */
const TOOLING_TAG = 'tooling';
/** The ESLint config file names @nx/eslint looks for (`ESLINT_CONFIG_FILENAMES`, @nx/eslint 23). */
export const ESLINT_CONFIGS = [
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc.json',
  'eslint.config.js', 'eslint.config.cjs', 'eslint.config.mjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
];
/** What @nx/eslint/plugin lints (its DEFAULT_EXTENSIONS) — a project with none of these gains no target. */
const LINTABLE = /\.(?:ts|cts|mts|tsx|js|cjs|mjs|jsx|html|vue)$/;
/** Inputs older @nx/eslint generators wrote for the executor — dropping these loses nothing the inferred target lacks. */
const STOCK_INPUTS = new Set([
  'default', '^default', '{workspaceRoot}/.eslintrc.json', '{workspaceRoot}/.eslintignore', '{workspaceRoot}/eslint.config.js',
  '{workspaceRoot}/eslint.config.cjs', '{workspaceRoot}/eslint.config.mjs', '{workspaceRoot}/tools/eslint-rules/**/*',
]);

/** The explicit lint target for a project inference does not cover: what the inferred target runs, cached. */
export const EXPLICIT_LINT_TARGET: TargetConfiguration = {
  executor: 'nx:run-commands',
  cache: true,
  inputs: ['default', '^default', '{workspaceRoot}/eslint.config.*'],
  options: { command: 'eslint .', cwd: '{projectRoot}' },
};

type PluginEntry = string | { plugin?: string; options?: { targetName?: unknown }; include?: string[]; exclude?: string[] };

/** Whether this workspace infers targets from plugins (Nx's default) — the switch Nx's own generators read. */
export function infersTargets(tree: Tree): boolean {
  if (process.env.NX_ADD_PLUGINS === 'false') return false;
  return (tree.exists('nx.json') ? readJson<{ useInferencePlugins?: boolean }>(tree, 'nx.json').useInferencePlugins : undefined) !== false;
}

function lintEntries(tree: Tree): Exclude<PluginEntry, string>[] {
  if (!tree.exists('nx.json')) return [];
  return (readJson<{ plugins?: PluginEntry[] }>(tree, 'nx.json').plugins ?? [])
    .map((entry) => (typeof entry === 'string' ? { plugin: entry } : entry))
    .filter((entry) => entry?.plugin === PLUGIN);
}

const targetNameOf = (entry: Exclude<PluginEntry, string>): string =>
  typeof entry.options?.targetName === 'string' ? entry.options.targetName : 'lint';

/** The lint target name @nx/eslint/plugin's FIRST entry infers, or undefined when the plugin is not registered. */
export function inferredLintTarget(tree: Tree): string | undefined {
  const [first] = lintEntries(tree);
  return first ? targetNameOf(first) : undefined;
}

/**
 * The lint target @nx/eslint/plugin infers for the project at `root`, or undefined when no entry covers it: no entry
 * whose include/exclude take both the project's definition file and the ESLint config that governs it.
 */
export function lintTargetFor(tree: Tree, root: string): string | undefined {
  // Nx reads both files a root may have; a project not created yet is judged by the file it WILL be defined in.
  const existing = (['project.json', 'package.json'] as const).map((file) => (root === '.' ? file : `${root}/${file}`)).filter((file) => tree.exists(file));
  const files = existing.length ? existing : [projectDefinitionFile(tree, root).path];
  for (const entry of lintEntries(tree)) {
    const takes = (file: string) => pluginEntryMatches(file, entry.include, entry.exclude);
    if (!files.some(takes)) continue;
    const config = governingConfig(tree, root, takes);
    if (config) return targetNameOf(entry);
  }
  return undefined;
}

/** The nearest ESLint config at or above `root` that `takes` (an entry's filter) admits. */
function governingConfig(tree: Tree, root: string, takes: (file: string) => boolean): string | undefined {
  const dirs: string[] = [];
  for (let dir = root; ; dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '.') {
    dirs.push(dir);
    if (dir === '.') break;
  }
  for (const dir of dirs) {
    const found = ESLINT_CONFIGS.map((file) => (dir === '.' ? file : `${dir}/${file}`)).find((file) => tree.exists(file) && takes(file));
    if (found) return found;
  }
  return undefined;
}

/**
 * What the project at `root` declares to be linted: the inferred target's name when an entry covers it (the plugin
 * registered first when none is, `target` undefined — declare nothing), else `lint` with its explicit target.
 */
export function houseLintTarget(tree: Tree, root: string): { name: string; target?: TargetConfiguration } {
  if (!infersTargets(tree)) return { name: 'lint', target: EXPLICIT_LINT_TARGET };
  if (!lintEntries(tree).length) registerLintInference(tree);
  const inferred = lintTargetFor(tree, root);
  return inferred ? { name: inferred } : { name: 'lint', target: EXPLICIT_LINT_TARGET };
}

/**
 * Register @nx/eslint/plugin, scoped to code — and say which projects it starts linting. See the header.
 */
export function registerLintInference(tree: Tree): void {
  if (!tree.exists('nx.json')) tree.write('nx.json', '{}\n');
  const projects = [...getProjects(tree)];
  const exclude = projects
    .filter(([, project]) => (project.tags ?? []).includes(TOOLING_TAG) || isWorkspaceShell(project))
    .flatMap(([, project]) => (project.root === '.' || project.root === '' ? ['project.json', 'package.json'] : [`${project.root}/**`]))
    .sort();
  const entry = exclude.length ? { ...PLUGIN_ENTRY, exclude } : PLUGIN_ENTRY;
  updateJsonInPlace<{ plugins?: PluginEntry[] }>(tree, 'nx.json', (nxJson) => {
    nxJson.plugins = [...(nxJson.plugins ?? []), entry];
  });
  const gaining = projects
    .filter(([, project]) => !project.targets?.lint && lintTargetFor(tree, project.root || '.') && hasLintableFile(tree, project.root || '.', projects.map(([, p]) => p.root)))
    .map(([name]) => name)
    .sort();
  logger.info(
    `[house] Registered @nx/eslint/plugin (nx.json) — Nx's inferred \`lint\` target.` +
      (gaining.length ? ` These projects gain \`lint\` with it: ${gaining.join(', ')}. Run \`nx run-many -t lint -p ${gaining.join(',')}\` — code linted for the first time may report what was never checked.` : '') +
      (exclude.length ? ` Not linted by it (tooling): ${exclude.join(', ')}.` : ''),
  );
}

/** The repo root as a project that is only the workspace's shell — no role, nothing it builds, tests or serves. */
function isWorkspaceShell(project: { root: string; projectType?: string; targets?: Record<string, unknown> }): boolean {
  if (project.root !== '.' && project.root !== '') return false;
  return !project.projectType && !['build', 'test', 'serve'].some((target) => target in (project.targets ?? {}));
}

/** A file @nx/eslint/plugin would lint, in the project's own tree (not in a nested project). */
function hasLintableFile(tree: Tree, root: string, roots: readonly string[]): boolean {
  const others = new Set(roots.filter((other) => other !== root && other !== '.' && other !== ''));
  const walk = (dir: string): boolean =>
    tree.children(dir).some((child) => {
      if (child.startsWith('.') || child === 'node_modules' || child === 'dist') return false;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (tree.isFile(path)) return LINTABLE.test(child);
      return !others.has(path) && walk(path);
    });
  return walk(root);
}

/**
 * Replace `project`'s BARE deprecated lint target (`{ "executor": "@nx/eslint:lint" }`, nothing else — what @nx/angular
 * writes) with what `houseLintTarget` says, and drop an nx.json `targetDefaults["@nx/eslint:lint"]` nothing uses any
 * more (reporting what it carried). Returns `lint` when it converted, or undefined when there was nothing to convert
 * or it was left as it is: a configured target is someone's own, and a plugin inferring another name would leave two.
 */
export function convertBareLint(tree: Tree, project: string): string | undefined {
  const config = getProjects(tree).get(project);
  const target = config?.targets?.lint as Record<string, unknown> | undefined;
  const bare = target?.executor === DEPRECATED_EXECUTOR && Object.keys(target).every((key) => key === 'executor');
  if (!config || !bare) return undefined;
  const plan = houseLintTarget(tree, config.root || '.');
  if (!plan.target && plan.name !== 'lint') return undefined;
  if (plan.target) config.targets!.lint = plan.target;
  else delete config.targets!.lint;
  updateProjectConfigurationInPlace(tree, project, config);
  dropUnusedExecutorDefault(tree);
  return 'lint';
}

function dropUnusedExecutorDefault(tree: Tree): void {
  if (!tree.exists('nx.json')) return;
  const used = [...getProjects(tree).values()].some((p) => Object.values(p.targets ?? {}).some((t) => t?.executor === DEPRECATED_EXECUTOR));
  if (used) return;
  const defaults = readJson<{ targetDefaults?: Record<string, Record<string, unknown>> }>(tree, 'nx.json').targetDefaults?.[DEPRECATED_EXECUTOR];
  if (!defaults) return;
  updateJsonInPlace<{ targetDefaults?: Record<string, unknown> }>(tree, 'nx.json', (nxJson) => {
    delete nxJson.targetDefaults![DEPRECATED_EXECUTOR];
  });
  // What the entry carried beyond Nx's stock cache/inputs no longer applies: the inferred target is keyed by NAME.
  const carried = Object.entries(defaults).filter(([key, value]) =>
    key === 'inputs' ? Array.isArray(value) && value.some((input) => typeof input !== 'string' || !STOCK_INPUTS.has(input)) : key !== 'cache',
  );
  if (carried.length) {
    logger.warn(
      `[house] nx.json: removed targetDefaults["${DEPRECATED_EXECUTOR}"] — no target runs that executor any more — and with it ` +
        `${carried.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('; ')}. The inferred lint target does not read it: ` +
        `restate what still matters under targetDefaults["${inferredLintTarget(tree) ?? 'lint'}"] (an executor option such as ` +
        `maxWarnings becomes an eslint flag there, e.g. options.args).`,
    );
  }
}
