// The Nx dev loop's targets and the rules that relate them.
//
//   `dev-server` — the LEAF: the app's real dev-server, the stack's (its adapter's `devServer` port) or the
//                  project's own. Its options are where a dev-server option LIVES.
//   `dev-stack`  — the COMPOSER (@bespunky/nx-tools:serve), a thin wrapper over `tools/dev/dev serve <app>` that
//                  forwards every option it does not own to the primary process. CONTINUOUS: the Nx-visible running
//                  stack, which Nx shares — what an e2e target depends on. It MIRRORS the leaf — the same options and
//                  configurations — so `nx serve <app> -c production` is the native Nx flag and any dev-server
//                  option can be tuned here too ("enrich, don't hide").
//   `serve`      — what a person or an agent types: a NON-continuous follower (@bespunky/nx-tools:follow-stack) that
//                  depends on `dev-stack` (flags forwarded) and ends when the stack ends, with ITS exit status. It
//                  exists because Nx reports a continuous task that ends — whatever its exit code — as succeeded
//                  when nothing depends on it, so `nx serve` straight on the composer said "succeeded" for a stack
//                  that died. With `serve` depending on it, a dying stack is a CRASHED dependency: the run fails.
//                  Depend on `dev-stack`, never on `serve`, for a running server — a dependent of `serve` waits for
//                  the stack to END.
//
// The mirror is derived, never maintained by hand in two places: the `serve` generator builds the composer from
// the leaf, and anything that sets a leaf option after it (the Firebase client's proxy config, on a brand-new app
// whose `serve` step already ran) goes through `setLeafOption`, which re-derives the composer — so a first run
// and a re-run produce the same project.json.
import { type Tree, type TargetConfiguration, readProjectConfiguration } from '@nx/devkit';
import { updateProjectConfigurationInPlace } from './project-files';

export const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';
/** The continuous composer's target — the running stack Nx shares (see the header). */
export const STACK_TARGET = 'dev-stack';
/** `serve`'s executor: follows the stack to its end and carries its exit status. */
export const FOLLOW_EXECUTOR = '@bespunky/nx-tools:follow-stack';

/**
 * The composer's preflight — a NON-continuous dependency of `dev-stack`, with the serve's flags forwarded, so it runs in
 * a second `nx serve <app>` BEFORE Nx decides to make that run wait on the first (see executors/serve-preflight).
 */
export const SERVE_PREFLIGHT_TARGET = 'serve-preflight';
export const SERVE_PREFLIGHT_EXECUTOR = '@bespunky/nx-tools:serve-preflight';

export const preflightTarget = (): TargetConfiguration => ({ executor: SERVE_PREFLIGHT_EXECUTOR, cache: false });

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
    // The composer itself is not a dev-server — on a re-run it occupies `serve`, and treating it as the leaf
    // would compose it with itself.
    // Nor is `serve` once it is the follower of the composer: it serves nothing itself.
    if (target.executor !== SERVE_EXECUTOR && target.executor !== FOLLOW_EXECUTOR) return target;
  }
  return undefined;
}

/**
 * The composer for this leaf (the `dev-stack` target).
 *
 * WHERE A STACK'S IDENTITY LIVES. The composer is CONTINUOUS — the Nx-visible instance of a running stack, which Nx
 * shares between invocations (that is how an e2e target depending on `dev-stack` reuses the stack the developer has
 * up). The processes it composes — the `dev-server` leaf, the emulator suite — are NOT: the dev engine runs each one
 * per stack, on that stack's shifted ports, and Nx sharing them across stacks is exactly what made a second stack
 * of one tree wait forever on the first's dev-server. So the leaf a stack supplies is never continuous; nothing
 * depends on it but the engine.
 */
export function composerFor(leaf: TargetConfiguration): TargetConfiguration {
  return {
    continuous: true,
    executor: SERVE_EXECUTOR,
    dependsOn: [{ target: SERVE_PREFLIGHT_TARGET, params: 'forward' }],
    options: { ...(leaf.options ?? {}) },
    ...(leaf.configurations ? { configurations: structuredClone(leaf.configurations) } : {}),
    ...(leaf.defaultConfiguration ? { defaultConfiguration: leaf.defaultConfiguration } : {}),
  };
}

/**
 * `serve` for this composer — the follower people and agents type. It mirrors the composer's configuration NAMES
 * (`nx serve <app> -c production` must resolve on `serve` to reach `dev-stack:production`), and forwards every flag
 * to the composer, which forwards them to its preflight.
 */
export function followerFor(composer: TargetConfiguration): TargetConfiguration {
  return {
    executor: FOLLOW_EXECUTOR,
    dependsOn: [{ target: STACK_TARGET, params: 'forward' }],
    cache: false,
    ...(composer.configurations ? { configurations: Object.fromEntries(Object.keys(composer.configurations).map((name) => [name, {}])) } : {}),
    ...(composer.defaultConfiguration ? { defaultConfiguration: composer.defaultConfiguration } : {}),
  };
}

/** The dev loop's Nx face for this leaf: the composer and its follower, by target name. */
export function serveTargetsFor(leaf: TargetConfiguration): Record<string, TargetConfiguration> {
  const composer = composerFor(leaf);
  return { [STACK_TARGET]: composer, serve: followerFor(composer) };
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
  if (config.targets![STACK_TARGET]?.executor === SERVE_EXECUTOR) Object.assign(config.targets!, serveTargetsFor(leaf));
  updateProjectConfigurationInPlace(tree, project, config);
  return true;
}
