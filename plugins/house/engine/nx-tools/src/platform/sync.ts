// The platform sync generator's registration: on the LINT target, because lint is what judges a project's platform —
// so classifying what the evidence settles runs right before the judgement (generators/platform-sync).
// `targetDefaults` is keyed by target name, so it reaches the inferred target (@nx/eslint/plugin) and an explicit one
// alike. Registered only where a firewall exists: a classification nothing enforces is a label nobody checks.
import { type Tree } from '@nx/devkit';
import { updateJsonInPlace } from '../generators/_utils/json-edits';
import { inferredLintTarget } from '../generators/_utils/lint-inference';

export const PLATFORM_SYNC = '@bespunky/nx-tools:platform-sync';

/** Register the sync generator on the lint target's defaults. Returns the target name when it changed nx.json. */
export function registerPlatformSync(tree: Tree): string | undefined {
  if (!tree.exists('nx.json')) return undefined;
  const target = inferredLintTarget(tree) ?? 'lint';
  const changed = updateJsonInPlace<{ targetDefaults?: Record<string, { syncGenerators?: string[] }> }>(tree, 'nx.json', (nxJson) => {
    const defaults = ((nxJson.targetDefaults ??= {})[target] ??= {});
    if (!(defaults.syncGenerators ?? []).includes(PLATFORM_SYNC)) defaults.syncGenerators = [...(defaults.syncGenerators ?? []), PLATFORM_SYNC];
  });
  return changed ? target : undefined;
}
