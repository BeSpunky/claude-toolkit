// The Nx dev loop's targets and the rules that relate them.
//
//   `dev-server` — the LEAF: the app's real dev-server, the stack's (its adapter's `devServer` port) or the
//                  project's own. Its options are where a dev-server option LIVES. Never continuous: the dev engine
//                  runs one per STACK, and Nx shares a continuous task across invocations.
//   `serve`      — what a person or an agent types: @bespunky/nx-tools:serve, a thin wrapper over
//                  `tools/dev/dev serve <app>` that forwards every option it does not own to the primary process.
//                  NOT continuous: Nx never shares a non-continuous task, so every `nx serve` is its own stack, and
//                  the run ends with the engine's exit status (a continuous task that ends while nothing depends on
//                  it is reported as succeeded whatever its code — the bug that made a dead stack "succeed").
//   `dev-stack`  — the same executor and options, CONTINUOUS: only for an e2e target to depend on a running stack
//                  (Nx shares it between dependents — right at that level). Depend on `dev-stack`, never on `serve`,
//                  for a running server: a dependent of `serve` waits for the stack to END.
//
// Both MIRROR the leaf — the same options and configurations — so `nx serve <app> -c production` is the native Nx
// flag and any dev-server option can be tuned here too ("enrich, don't hide"). `continuous` is written EXPLICITLY on
// all three (true / false / false): Nx fills an absent key from nx.json targetDefaults or the executor's schema, and
// @nx/angular's `update-21-0-0/set-continuous-option` migration sets `continuous: true` on a dev-server target that
// lacks the key — either would silently turn `serve` back into a shared task.
//
// The mirror is derived, never maintained by hand in two places: the `serve` generator builds both from the leaf,
// and anything that sets a leaf option after it (the Firebase client's proxy config, on a brand-new app whose
// `serve` step already ran) goes through `setLeafOption`, which re-derives them — so a first run and a re-run
// produce the same project.json.
import { type Tree, type TargetConfiguration, readProjectConfiguration } from '@nx/devkit';
import { updateProjectConfigurationInPlace } from './project-files';

export const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';
/** The continuous twin of `serve` — the running stack an e2e target depends on (see the header). */
export const STACK_TARGET = 'dev-stack';

// Where the app's dev-server may sit when the `serve` generator runs, in priority order:
//   - `dev-server` — the canonical leaf, on a re-run or a project that already brought its own.
//   - `serve`      — where a fresh framework app (e.g. @nx/angular:application) parks its dev-server, before
//                    the serve generator reclaims that slot for the composer.
// Pre-0.3.0 names are NOT looked for here; the 0.24.0 migration renames them to `dev-server` first.
const DEV_SERVER_NAMES = ['dev-server', 'serve'];

/**
 * The project's existing dev-server: the canonical `dev-server` leaf, or the fresh `serve` slot before it
 * becomes the composer.
 *
 * Deliberately NOT filtered by executor. That filter is what made this Angular-only: a Vite dev-server sitting
 * on `serve` was invisible, so the generator concluded there was none and overwrote it with an Angular target
 * the project could not run.
 */
export function findExistingDevServer(
  targets: Record<string, TargetConfiguration>
): TargetConfiguration | undefined {
  for (const name of DEV_SERVER_NAMES) {
    const target = targets[name];
    // IS IT AN OBJECT, not merely truthy. `Record<string, TargetConfiguration>` is what the devkit types
    // promise, but project.json is a file a human edits: `targets` can legitimately hold a `//`-prefixed
    // documentation string, and nothing stops one landing on a key we look up by name. A bare `target &&`
    // admits that string, `.executor` on it is undefined, `undefined !== SERVE_EXECUTOR` holds, and the string
    // is returned AS a TargetConfiguration — then written straight back into project.json by the caller.
    // Checking the type here is the difference between ignoring a comment and corrupting the file with it.
    if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
    // The house's own `serve` is not a dev-server — on a re-run it occupies `serve`, and treating it as the leaf
    // would compose it with itself.
    if (target.executor !== SERVE_EXECUTOR) return target;
  }
  return undefined;
}

/** The engine over this leaf, mirroring its options and configurations; `continuous` is the caller's (see the header). */
function engineTarget(leaf: TargetConfiguration, continuous: boolean): TargetConfiguration {
  return {
    continuous,
    executor: SERVE_EXECUTOR,
    ...(continuous ? {} : { cache: false }),
    options: { ...(leaf.options ?? {}) },
    ...(leaf.configurations ? { configurations: structuredClone(leaf.configurations) } : {}),
    ...(leaf.defaultConfiguration ? { defaultConfiguration: leaf.defaultConfiguration } : {}),
  };
}

/** The dev loop's Nx face for this leaf, by target name: `dev-stack` (continuous) and `serve` (not). */
export function serveTargetsFor(leaf: TargetConfiguration): Record<string, TargetConfiguration> {
  return { [STACK_TARGET]: engineTarget(leaf, true), serve: engineTarget(leaf, false) };
}

/**
 * Set `key` on the project's `dev-server` leaf (set-if-absent: a value the project chose is kept) and keep the
 * house `serve`/`dev-stack` mirror true. Returns false when the project has no leaf.
 */
export function setLeafOption(tree: Tree, project: string, key: string, value: unknown): boolean {
  const config = readProjectConfiguration(tree, project);
  const leaf = config.targets?.['dev-server'];
  if (!leaf) return false;
  if (leaf.options?.[key] !== undefined) return true;
  leaf.options = { ...(leaf.options ?? {}), [key]: value };
  if (config.targets!.serve?.executor === SERVE_EXECUTOR) Object.assign(config.targets!, serveTargetsFor(leaf));
  updateProjectConfigurationInPlace(tree, project, config);
  return true;
}
