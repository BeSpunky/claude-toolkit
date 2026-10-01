// The Nx dev loop's two targets and the ONE rule that relates them.
//
//   `dev-server` — the LEAF: the app's real dev-server, the stack's (its adapter's `devServer` port) or the
//                  project's own. Its options are where a dev-server option LIVES.
//   `serve`      — the COMPOSER (@bespunky/nx-tools:serve), a thin wrapper over `tools/dev/dev serve <app>` that
//                  forwards every option it does not own to the primary process. It MIRRORS the leaf — the same
//                  options and configurations — so `nx serve <app> -c production` is the native Nx flag and any
//                  dev-server option can be tuned on `serve` too ("enrich, don't hide").
//
// The mirror is derived, never maintained by hand in two places: the `serve` generator builds the composer from
// the leaf, and anything that sets a leaf option after it (the Firebase client's proxy config, on a brand-new app
// whose `serve` step already ran) goes through `setLeafOption`, which re-derives the composer — so a first run
// and a re-run produce the same project.json.
import { type Tree, type TargetConfiguration, readProjectConfiguration, updateProjectConfiguration } from '@nx/devkit';

export const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';

/** The composer for this leaf. */
export function composerFor(leaf: TargetConfiguration): TargetConfiguration {
  return {
    continuous: true,
    executor: SERVE_EXECUTOR,
    options: { ...(leaf.options ?? {}) },
    ...(leaf.configurations ? { configurations: structuredClone(leaf.configurations) } : {}),
    ...(leaf.defaultConfiguration ? { defaultConfiguration: leaf.defaultConfiguration } : {}),
  };
}

/**
 * Set `key` on the project's `dev-server` leaf (set-if-absent: a value the project chose is kept) and keep the
 * house composer's mirror true. Returns false when the project has no leaf.
 */
export function setLeafOption(tree: Tree, project: string, key: string, value: unknown): boolean {
  const config = readProjectConfiguration(tree, project);
  const leaf = config.targets?.['dev-server'];
  if (!leaf) return false;
  if (leaf.options?.[key] !== undefined) return true;
  leaf.options = { ...(leaf.options ?? {}), [key]: value };
  if (config.targets!.serve?.executor === SERVE_EXECUTOR) config.targets!.serve = composerFor(leaf);
  updateProjectConfiguration(tree, project, config);
  return true;
}
