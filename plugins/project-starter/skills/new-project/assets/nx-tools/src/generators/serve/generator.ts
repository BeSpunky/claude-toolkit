// House generator: give a project the unified `serve` target + its `dev-server` leaf.
//
// The per-app sibling of serve-options, and the SINGLE home of the house dev loop. It parks two
// targets on the app, one composing the other — and they sit on OPPOSITE sides of the layer line, which is
// the thing to keep straight when editing this file (see THE SEAM in the generator body):
//   - `dev-server` — the app's real dev-server. Written here as @angular/build:dev-server (host 0.0.0.0, so
//     it's reachable from outside the devcontainer; configurations development (default) / production;
//     buildTarget <app>:build) ONLY when the project has none of its own and is an Angular app. A project
//     that already has a dev-server — Vite, Next, anything — keeps it untouched. An internal leaf the
//     composing executor drives, also runnable directly.
//   - `serve`      — the @bespunky/nx-tools:serve composing executor: it runs `dev-server` plus, on a
//     Firebase tree, the emulator suite, plus the shared co-driven browser, under one graceful Ctrl+C,
//     for the current worktree or any chosen one. This REPLACES the old trio (serve / serve-worktree /
//     serve-with-shared-browser) — the worktree and shared-browser axes are now flags on this one serve.
//
// It also wires the LAYER-1 worktree tab label into the app (worktree-tab-label.ts + provider in
// app.config.ts): a dev-only initializer that, when the app is viewed on a `<slug>.localhost` worktree
// domain, prefixes the tab title with `[slug]` and tints the favicon by a hue hashed from the slug, so
// each worktree tab is visually distinct. Tree-shaken from prod (gated on ngDevMode).
//
// Why per-app (not workspace-level): every app — the scaffolder's first and every later
// `nx g @bespunky/nx-tools:app` — needs its own dev-server leaf + serve target, so it is applied here,
// on the same code path serve-options runs on, and can't drift as apps are added.
//
// Idempotent + --sync-safe: re-running re-asserts the same targets (reclaiming the raw @nx/angular
// `serve` slot into the `dev-server` leaf), rewrites the generator-owned tab-label glue, and re-wires
// the provider only if absent.
//
// It asserts the CURRENT shape only. Collapsing a project that still carries the pre-0.3.0 fan of serve
// targets (`serve-app`/`serve-standalone`/`serve-no-emulators`/`serve-with-emulators`, `serve-worktree`,
// `serve-with-shared-browser`) is the job of the versioned migration
// src/migrations/0.24.0/unify-serve-targets.ts, which sweeps EVERY project once rather than only the apps
// a sync happens to run this per-app generator against.
import {
  type Tree,
  type TargetConfiguration,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
  logger,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { wireProvider } from '../_utils/wire-provider';

interface ServeSchema {
  project: string;
  // Override the workspace identity used as the base-host slug in the tab label. Defaults to the
  // workspace root directory name — correct in every normal case.
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
  const workspaceName = options.workspaceName ?? basename(tree.root);

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

  // The composing `serve` — one command, one graceful Ctrl+C: dev-server + optional emulators + optional
  // shared browser, for the current worktree or any chosen one. Defaults cover the common case (emulators
  // + shared browser on, auto port offset); flags (`--no-emulators`, `--no-shared-browser`, `--worktree`,
  // `--portOffset`, `--configuration`) tune it.
  //
  // Enrich, don't hide: `serve` carries the same dev-server delegation options as the leaf (host,
  // proxyConfig, buildTarget) PLUS the canonical Angular development/production configurations. The
  // executor forwards them to the `dev-server` leaf it drives — so `nx serve <app> --configuration=production`
  // is the native Nx config flag, and any dev-server option can be tuned on `serve` directly.
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

  // LAYER 1: the dev-only worktree tab label. Generator-owned glue (no user values) — always rewritten
  // so fixes propagate. Derives purely from the runtime hostname; the workspace name is baked in only as
  // the base-host sentinel (so `<workspaceName>.localhost` is treated as the base, not a worktree).
  //
  // ANGULAR-ONLY, and gated as such. This half of the generator emits an Angular provider and wires it into
  // `app.config.ts` — the composer above is framework-agnostic, this is not. Writing it unconditionally
  // would drop an Angular source file into a Vite project that cannot compile it, for a feature that could
  // never activate there. `app.config.ts` is the test rather than the build executor: it is the thing that
  // must exist for the provider to have a home.
  const appRoot = project.root;
  const appConfigPath = `${appRoot}/src/app/app.config.ts`;
  const angularApp = tree.exists(appConfigPath);

  if (angularApp) {
    const tabLabelPath = `${appRoot}/src/app/worktree-tab-label.ts`;
    tree.write(
      tabLabelPath,
      readFileSync(join(__dirname, 'files', 'worktree-tab-label.ts.tpl'), 'utf8').split('{{workspaceName}}').join(workspaceName),
    );
  }

  updateProjectConfiguration(tree, projectName, project);

  // Best-effort: wire provideWorktreeTabLabel() into app.config.ts (idempotent — only when absent).
  if (angularApp) {
    const current = tree.read(appConfigPath, 'utf8') ?? '';
    const wired = wireProvider(current, appConfigPath, {
      providerFn: 'provideWorktreeTabLabel',
      importFrom: './worktree-tab-label',
    });
    if (wired && wired !== current) {
      tree.write(appConfigPath, wired);
    } else if (wired === null) {
      logger.warn(
        `[serve] Could not auto-wire ${appConfigPath}. Add ` +
        `\`import { provideWorktreeTabLabel } from './worktree-tab-label';\` and include ` +
        `\`provideWorktreeTabLabel()\` in your providers array manually (dev-only tab label).`,
      );
    }
  }

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
    // The composer itself is not a dev-server — on a re-run it occupies `serve`, and treating it as the leaf
    // would compose it with itself.
    if (target && target.executor !== SERVE_EXECUTOR) return target;
  }
  return undefined;
}

/** Is this project built by an Angular builder — i.e. can we derive an Angular dev-server leaf for it? */
function isAngularApp(targets: Record<string, TargetConfiguration>): boolean {
  const executor = targets.build?.executor ?? '';
  return ANGULAR_BUILD_EXECUTORS.some((prefix) => executor.startsWith(prefix));
}
