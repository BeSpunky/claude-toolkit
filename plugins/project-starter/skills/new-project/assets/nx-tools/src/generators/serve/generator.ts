// House generator: the NX ADAPTER of the dev loop — give a project the `serve` target + its `dev-server` leaf,
// and declare it in `.bespunky/dev.json`.
//
// The dev loop itself is stack-free: `tools/dev/dev serve` runs what `.bespunky/dev.json` declares. This
// generator is how an Nx project joins it. It parks two targets on the app, one composing the other — on
// OPPOSITE sides of the layer line (see THE SEAM in the generator body):
//   - `dev-server` — the app's real dev-server. Written here as @angular/build:dev-server (host 0.0.0.0, so
//     it's reachable from outside the devcontainer; configurations development (default) / production;
//     buildTarget <app>:build) ONLY when the project has none of its own and is an Angular app. A project
//     that already has a dev-server — Vite, Next, anything — keeps it untouched.
//   - `serve`      — the @bespunky/nx-tools:serve executor: a THIN WRAPPER over `tools/dev/dev serve <app>`.
//     `nx serve <app> --worktree=… --port-offset=…` is the engine with Nx's option parsing in front; every
//     option the wrapper does not own (buildTarget, host, …) is forwarded to the app's primary process.
// …and it SEEDS the app's entry in `.bespunky/dev.json` from the adapters that apply (the dev-server process;
// the Firebase emulators when the workspace has them) — only what the app does not declare yet, so a later
// `nx g @bespunky/nx-tools:app` is servable before the next sync.
//
// The dev-only worktree TAB LABEL is no longer written here — it is Angular's, and lives in the
// `worktree-tab-label` generator (the `angular` layer's per-app step).
//
// Why per-app (not workspace-level): every app — the scaffolder's first and every later
// `nx g @bespunky/nx-tools:app` — needs its own dev-server leaf + serve target, so it is applied here,
// on the same code path serve-options runs on, and can't drift as apps are added.
//
// Idempotent + --sync-safe: re-running re-asserts the same targets (reclaiming the raw @nx/angular `serve`
// slot into the `dev-server` leaf).
//
// It asserts the CURRENT shape only. Collapsing a project that still carries the pre-0.3.0 fan of serve
// targets is the job of the versioned migration src/migrations/0.24.0/unify-serve-targets.ts.
import {
  type Tree,
  type TargetConfiguration,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
  logger,
} from '@nx/devkit';
import { seedFromAdapters } from '../dev/fragments';

interface ServeSchema {
  project: string;
  /**
   * DEPRECATED, ignored: they configured the worktree tab label, which moved to the `worktree-tab-label`
   * generator. Still accepted so a caller passing them keeps working.
   */
  wireProviders?: boolean;
  workspaceName?: string;
}

// The Angular dev-server executor — the LEAF's default, not the composer's requirement. Named
// `ANGULAR_DEV_SERVER_EXECUTOR` rather than `DEV_SERVER_EXECUTOR` because that is the distinction the whole
// split turns on: the composer drives a `dev-server` TARGET by name and never learns what produced it.
const ANGULAR_DEV_SERVER_EXECUTOR = '@angular/build:dev-server';
const ANGULAR_BUILD_EXECUTORS = ['@angular/build:', '@angular-devkit/build-angular:'];
const SERVE_EXECUTOR = '@bespunky/nx-tools:serve';
// Where the app's dev-server may sit when this generator runs, in priority order:
//   - `dev-server` — the canonical leaf, on a re-run or a project that already brought its own.
//   - `serve`      — where a fresh @nx/angular:application parks its dev-server, before this generator
//                    reclaims that slot for the composer.
// Pre-0.3.0 names are NOT looked for here; the 0.24.0 migration renames them to `dev-server` first.
const DEV_SERVER_NAMES = ['dev-server', 'serve'];

export default async function serveGenerator(tree: Tree, options: ServeSchema): Promise<void> {
  const projectName = options.project;

  const project = readProjectConfiguration(tree, projectName);
  project.targets ??= {};
  const targets = project.targets;

  // THE SEAM. This generator writes two things with genuinely different preconditions, and conflating them
  // is what pinned the whole dev loop to Angular:
  //
  //   the COMPOSER (`serve`)      — runs `dev-server` + emulators + shared browser under one Ctrl+C. It
  //                                 drives a TARGET BY NAME and never learns what produced it. Framework
  //                                 -agnostic; belongs to the `web` layer.
  //   the LEAF     (`dev-server`) — the actual server. Angular's, here — but only because Angular is what
  //                                 this house scaffolds. A Vite or Next app has its own.
  //
  // So the leaf is written ONLY when this generator is the one that has to supply it: when the project has
  // no dev-server of its own AND is an Angular app. A project that already has a dev-server (under any
  // executor) keeps it — the composer will happily drive a Vite one — and a project with neither is told
  // what is missing rather than handed an Angular target it cannot run.
  const existingDevServer = findExistingDevServer(targets);
  const ownsLeaf = !existingDevServer || existingDevServer.executor === ANGULAR_DEV_SERVER_EXECUTOR;

  if (!existingDevServer && !isAngularApp(targets)) {
    throw new Error(
      `[serve] Project "${projectName}" has nothing to serve: no \`dev-server\` (or legacy) target, and no ` +
        `Angular build to derive one from.\n` +
        `  The \`serve\` composer drives a \`dev-server\` target — it does not create one for a framework it ` +
        `doesn't know.\n` +
        `  Add a \`dev-server\` target to this project (any executor — Vite, Next, a custom one), then re-run ` +
        `this generator to compose it with the emulators and the shared browser.`
    );
  }

  const preserved: Record<string, unknown> = { ...(existingDevServer?.options ?? {}) };
  const host = (preserved.host as string | undefined) ?? '0.0.0.0';
  // buildTarget + configurations are generator-owned on the leaf — drop any inherited copies.
  delete preserved.buildTarget;
  delete preserved.host;

  // Free the `serve` slot when it holds the raw Angular dev-server — a fresh @nx/angular:application parks
  // one there, and the composer takes that name below (the leaf is re-asserted as `dev-server`).
  if (targets.serve?.executor === ANGULAR_DEV_SERVER_EXECUTOR) delete targets.serve;

  if (ownsLeaf) {
    // The `dev-server` leaf — the real Angular dev-server the composer drives. Env pinned via
    // configurations (development default / production), host applied so it's reachable from outside the
    // container. Preserves any extra user options captured above.
    targets['dev-server'] = {
      continuous: true,
      executor: ANGULAR_DEV_SERVER_EXECUTOR,
      options: { ...preserved, buildTarget: `${projectName}:build`, host },
      configurations: {
        development: { buildTarget: `${projectName}:build:development` },
        production: { buildTarget: `${projectName}:build:production` },
      },
      defaultConfiguration: 'development',
    };
  } else {
    // A NON-Angular dev-server: re-seat it under the canonical `dev-server` name (it may have been found on
    // `serve`, which the composer is about to claim) and otherwise leave it entirely alone. Its options, its
    // executor and its configurations belong to whoever set it up; the composer only needs to find it by name.
    targets['dev-server'] = existingDevServer as TargetConfiguration;
    logger.info(
      `[serve] Composing the existing \`${existingDevServer?.executor}\` dev-server for "${projectName}" — left as-is.`
    );
  }

  // The composing `serve` — the Nx face of `tools/dev/dev serve <app>`: every process the app declares, one
  // graceful Ctrl+C, the current worktree or any chosen one. Flags (`--worktree`, `--port-offset`, `--skip`,
  // `--no-shared-browser`, `--configuration`) tune it.
  //
  // Enrich, don't hide: `serve` carries the same dev-server delegation options as the leaf (host,
  // proxyConfig, buildTarget) PLUS the canonical Angular development/production configurations. The
  // executor forwards every option it does not own to the app's primary process — the `dev-server` leaf — so
  // `nx serve <app> --configuration=production` is the native Nx config flag, and any dev-server option can be
  // tuned on `serve` directly.
  targets.serve = {
    continuous: true,
    executor: SERVE_EXECUTOR,
    options: { ...preserved, buildTarget: `${projectName}:build`, host },
    configurations: {
      development: { buildTarget: `${projectName}:build:development` },
      production: { buildTarget: `${projectName}:build:production` },
    },
    defaultConfiguration: 'development',
  };

  updateProjectConfiguration(tree, projectName, project);

  // Declare the app for the stack-free engine the composer wraps. Only what it does not declare yet.
  for (const line of seedFromAdapters(tree, projectName)) logger.info(`[serve] ${line}`);

  await formatFiles(tree);
}

/**
 * The project's existing dev-server: the canonical `dev-server` leaf, or the fresh `serve` slot before it
 * becomes the composer.
 *
 * Deliberately NOT filtered by executor. That filter is what made this Angular-only: a Vite dev-server sitting
 * on `serve` was invisible, so the generator concluded there was none and overwrote it with an Angular target
 * the project could not run.
 */
function findExistingDevServer(
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
    if (target.executor !== SERVE_EXECUTOR) return target;
  }
  return undefined;
}

/** Is this project built by an Angular builder — i.e. can we derive an Angular dev-server leaf for it? */
function isAngularApp(targets: Record<string, TargetConfiguration>): boolean {
  const executor = targets.build?.executor ?? '';
  return ANGULAR_BUILD_EXECUTORS.some((prefix) => executor.startsWith(prefix));
}
