// HOW A HOUSE PROJECT IS LINTED — what Nx itself recommends today, never the deprecated `@nx/eslint:lint` executor.
//
// @nx/eslint deprecates its `lint` executor (removed in Nx 24: "Run `nx g @nx/eslint:convert-to-inferred` to migrate
// to the `@nx/eslint/plugin` inferred targets"). The supported shape is the INFERRED target that the
// `@nx/eslint/plugin` entry in nx.json gives every project under an ESLint config — its own, or the root one (a
// project without its own config is linted by the root config, which is how the functions project is linted).
//
// Two writers still produce the executor, and both are answered here:
//   - @nx/angular's add-linting (which its application and library generators call) passes `addExplicitTargets: true`
//     to @nx/eslint's lint-project, so it writes `"lint": { "executor": "@nx/eslint:lint" }` whatever the workspace
//     infers. Nx's answer, convert-to-inferred, cannot run inside a generator or a migration: it reads the project
//     graph from DISK, where a project linted moments ago in the Tree has no lint target yet. So `convertBareLint`
//     makes the conversion it would make, for exactly the bare target @nx/angular wrote;
//   - the house's own targets (functions:lint) ask `houseLintTarget` what to declare.
//
// The plugin is registered as the entry `nx add @nx/eslint` writes (`{ plugin, options: { targetName: 'lint' } }`) —
// written as data, not through @nx/eslint's init generator, which builds the project graph from DISK (blind to the
// Tree, slow, and absent before an install) only to choose that same name. A workspace that turned inference OFF (`useInferencePlugins:
// false`, NX_ADD_PLUGINS=false) chose explicit targets: it gets one — `eslint .` in the project's root, the command the
// inferred target runs — and still not the deprecated executor.
import { type TargetConfiguration, type Tree, getProjects, readJson } from '@nx/devkit';
import { updateJsonInPlace } from './json-edits';
import { updateProjectConfigurationInPlace } from './project-files';

const PLUGIN = '@nx/eslint/plugin';
/** The entry `nx add @nx/eslint` (its init generator's addPlugin) writes into nx.json `plugins`. */
const PLUGIN_ENTRY = { plugin: PLUGIN, options: { targetName: 'lint' } };
/** The deprecated executor — named here only to recognise it. */
const DEPRECATED_EXECUTOR = '@nx/eslint:lint';

/** The explicit lint target for a workspace without inference: what the inferred target runs, cached. */
export const EXPLICIT_LINT_TARGET: TargetConfiguration = {
  executor: 'nx:run-commands',
  cache: true,
  inputs: ['default', '^default', '{workspaceRoot}/eslint.config.*'],
  options: { command: 'eslint .', cwd: '{projectRoot}' },
};

type PluginEntry = string | { plugin?: string; options?: { targetName?: unknown } };

/** Whether this workspace infers targets from plugins (Nx's default) — the switch Nx's own generators read. */
export function infersTargets(tree: Tree): boolean {
  if (process.env.NX_ADD_PLUGINS === 'false') return false;
  return (tree.exists('nx.json') ? readJson<{ useInferencePlugins?: boolean }>(tree, 'nx.json').useInferencePlugins : undefined) !== false;
}

/** The lint target name @nx/eslint/plugin infers here, or undefined when the plugin is not registered. */
export function inferredLintTarget(tree: Tree): string | undefined {
  if (!tree.exists('nx.json')) return undefined;
  const plugins = readJson<{ plugins?: PluginEntry[] }>(tree, 'nx.json').plugins ?? [];
  const entry = plugins.find((p) => (typeof p === 'string' ? p : p?.plugin) === PLUGIN);
  if (entry === undefined) return undefined;
  const name = typeof entry === 'string' ? undefined : entry.options?.targetName;
  return typeof name === 'string' ? name : 'lint';
}

/**
 * What a house project declares to be linted: the inferred target's name (the plugin registered first when it is
 * not yet, `target` undefined — declare nothing), or, in a workspace without inference, `lint` with its explicit target.
 */
export function houseLintTarget(tree: Tree): { name: string; target?: TargetConfiguration } {
  if (!infersTargets(tree)) return { name: 'lint', target: EXPLICIT_LINT_TARGET };
  if (inferredLintTarget(tree) === undefined) {
    if (!tree.exists('nx.json')) tree.write('nx.json', '{}\n');
    updateJsonInPlace<{ plugins?: PluginEntry[] }>(tree, 'nx.json', (nxJson) => {
      nxJson.plugins = [...(nxJson.plugins ?? []), PLUGIN_ENTRY];
    });
  }
  return { name: inferredLintTarget(tree) ?? 'lint' };
}

/**
 * Replace `project`'s BARE deprecated lint target (`{ "executor": "@nx/eslint:lint" }`, nothing else — what @nx/angular
 * writes) with what `houseLintTarget` says, and drop an nx.json `targetDefaults["@nx/eslint:lint"]` nothing uses any
 * more. Returns `lint` when it converted, or undefined when there was nothing to convert or it was left as it is: a
 * configured target is someone's own, and a plugin inferring another name would leave two.
 */
export function convertBareLint(tree: Tree, project: string): string | undefined {
  const target = getProjects(tree).get(project)?.targets?.lint as Record<string, unknown> | undefined;
  const bare = target?.executor === DEPRECATED_EXECUTOR && Object.keys(target).every((key) => key === 'executor');
  if (!bare) return undefined;
  const plan = houseLintTarget(tree);
  if (!plan.target && plan.name !== 'lint') return undefined;
  const config = getProjects(tree).get(project)!;
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
  updateJsonInPlace<{ targetDefaults?: Record<string, unknown> }>(tree, 'nx.json', (nxJson) => {
    if (nxJson.targetDefaults && DEPRECATED_EXECUTOR in nxJson.targetDefaults) delete nxJson.targetDefaults[DEPRECATED_EXECUTOR];
  });
}
