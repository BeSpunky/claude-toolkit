// House generator: the NX ADAPTER of the dev loop — give a project the `serve` target + its `dev-server` leaf,
// and declare it in `.bespunky/dev.json`.
//
// The dev loop itself is stack-free: `tools/dev/dev serve` runs what `.bespunky/dev.json` declares. This
// generator is how an Nx project joins it. It parks two targets on the app, one composing the other — on
// OPPOSITE sides of the layer line (see THE SEAM in the generator body):
//   - `dev-server` — the app's real dev-server. Supplied by the project's STACK (its adapter's `devServer`
//     port — Angular's is @angular/build:dev-server, host 0.0.0.0, configurations development (default) /
//     production) ONLY when the project has none of its own. A project that already has a dev-server — Vite,
//     Next, anything — keeps it untouched.
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
// Idempotent + upgrade-safe: re-running re-asserts the same targets (reclaiming the raw @nx/angular `serve`
// slot into the `dev-server` leaf).
//
// It also turns Nx's interactive TUI off (nx.json `tui.enabled: false`, set-if-absent): the composer streams
// every process's prefixed logs under one Ctrl+C, and the TUI would re-wrap that stream in a redrawing pane that
// humans and agents alike read worse. That is a property of THIS dev loop, so it lives with it (it used to be
// written by the Firebase generator, back when the emulators were the only reason a run had several streams).
//
// It asserts the CURRENT shape only. Collapsing a project that still carries the pre-0.3.0 fan of serve
// targets is the job of the versioned migration src/migrations/0.24.0/unify-serve-targets.ts.
import {
  type Tree,
  type TargetConfiguration,
  readProjectConfiguration,
  updateProjectConfiguration,
  updateJson,
  formatFiles,
  logger,
} from '@nx/devkit';
import { seedFromAdapters } from '../dev/fragments';
import { adapterOf } from '../../adapters/registry';
import { composerFor, findExistingDevServer } from '../_utils/dev-server';

interface ServeSchema {
  project: string;
}

export default async function serveGenerator(tree: Tree, options: ServeSchema): Promise<void> {
  const projectName = options.project;

  const project = readProjectConfiguration(tree, projectName);
  project.targets ??= {};
  const targets = project.targets;

  // THE SEAM. This generator writes two things with genuinely different preconditions, and conflating them
  // is what pinned the whole dev loop to Angular:
  //
  //   the COMPOSER (`serve`)      — runs the app's declared processes under one Ctrl+C. It drives a TARGET BY
  //                                 NAME and never learns what produced it. Framework-agnostic; the `web` layer's.
  //   the LEAF     (`dev-server`) — the actual server: the project's own, or its STACK's (the adapter's
  //                                 `devServer` port — src/adapters). This file names no framework.
  //
  // So the leaf is written ONLY when the stack has to supply it: when the project has no dev-server of its own,
  // or has the stack's own (re-asserted). A project that already has a dev-server under any other executor
  // keeps it untouched — the composer will happily drive a Vite one — and a project with neither is told what
  // is missing rather than handed a target it cannot run.
  const existingDevServer = findExistingDevServer(targets);
  const stack = adapterOf(tree, projectName);
  const stackLeaf = stack?.devServer;
  const ownsLeaf = Boolean(stackLeaf) && (!existingDevServer || existingDevServer.executor === stackLeaf!.executor);

  if (!existingDevServer && !stackLeaf) {
    throw new Error(
      `[serve] Project "${projectName}" has nothing to serve: no \`dev-server\` (or legacy) target, and ` +
        (stack ? `its stack (${stack.id}) has no dev-server to derive one from.\n` : `no registered stack builds it.\n`) +
        `  The \`serve\` composer drives a \`dev-server\` target — it does not create one for a framework it ` +
        `doesn't know.\n` +
        `  Add a \`dev-server\` target to this project (any executor — Vite, Next, a custom one), then re-run ` +
        `this generator to compose it with the emulators and the shared browser.`
    );
  }

  let leaf: TargetConfiguration;
  if (ownsLeaf) {
    // The stack's leaf, carrying every option the user tuned on the previous one.
    leaf = stackLeaf!.leaf(tree, projectName, { ...(existingDevServer?.options ?? {}) });
  } else {
    // A dev-server of the project's own: re-seat it under the canonical `dev-server` name (it may have been
    // found on `serve`, which the composer is about to claim) and otherwise leave it entirely alone. Its options,
    // its executor and its configurations belong to whoever set it up; the composer only needs to find it.
    leaf = existingDevServer as TargetConfiguration;
    logger.info(`[serve] Composing the existing \`${leaf.executor}\` dev-server for "${projectName}" — left as-is.`);
  }
  targets['dev-server'] = leaf;

  // The composing `serve` — the Nx face of `tools/dev/dev serve <app>`: every process the app declares, one
  // graceful Ctrl+C, the current worktree or any chosen one. Flags (`--worktree`, `--port-offset`, `--skip`,
  // `--no-shared-browser`, `--configuration`) tune it. It MIRRORS the leaf (see _utils/dev-server).
  targets.serve = composerFor(leaf);

  updateProjectConfiguration(tree, projectName, project);
  streamedLogs(tree);

  // Declare the app for the stack-free engine the composer wraps. Only what it does not declare yet.
  for (const line of seedFromAdapters(tree, projectName)) logger.info(`[serve] ${line}`);

  await formatFiles(tree);
}

/** Nx's TUI off for the dev loop — unless the workspace already decided (either way). */
function streamedLogs(tree: Tree): void {
  if (!tree.exists('nx.json')) return;
  updateJson(tree, 'nx.json', (json) => {
    if (json.tui?.enabled === undefined) json.tui = { ...(json.tui ?? {}), enabled: false };
    return json;
  });
}
