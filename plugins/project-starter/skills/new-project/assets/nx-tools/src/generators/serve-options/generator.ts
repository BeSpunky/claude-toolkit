// House generator: set dev-server options on the project's actual dev-server target.
// Uses @nx/devkit so the change is format-aware and project-graph aware.
//
// Sets `host: '0.0.0.0'` so the dev server is reachable from outside the devcontainer.
// Polling is NOT set here. Modern Angular's `@angular/build:dev-server` schema does not accept `poll`;
// reliable file-watching over WSL/Docker mounts is enabled via env vars
// (CHOKIDAR_USEPOLLING + CHOKIDAR_INTERVAL) set on the devcontainer (see the devcontainer generator),
// which is respected by any chokidar-based watcher across both old and new Angular builders.
//
// Where it routes the option:
//   - Plain case — `serve` is the Angular dev-server directly (no Firebase, or a fresh
//     scaffold before firebase-emulators runs) → set `host` on `serve.options`.
//   - Firebase shape — the firebase-emulators generator parks an `nx:run-commands`
//     orchestrator at `serve` (running `firebase:emulators` + `serve-no-emulators` in parallel)
//     with the real dev-server at `serve-no-emulators` → set `host` on `serve-no-emulators.options`
//     instead, AND strip any stray `host` from the orchestrator's options. (Setting `host` on a
//     run-commands target would forward it as `--host=0.0.0.0` via flag-passthrough.)
//     If serve-options runs before firebase-emulators reshapes a fresh project, `host`
//     lands on `serve`, which firebase-emulators then MOVES to `serve-no-emulators` wholesale —
//     so the option survives the migration regardless of order. (The legacy dev-server names
//     `serve-standalone` and `serve-app` are also tolerated, in case serve-options runs before the
//     rename migration.)
//
// This makes the generator safe to re-run on a project at any stage (fresh, firebase-shaped).
import {
  type Tree,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
} from '@nx/devkit';

interface ServeOptionsSchema {
  project: string;
  host?: string;
}

export default async function serveOptionsGenerator(
  tree: Tree,
  options: ServeOptionsSchema
): Promise<void> {
  const host = options.host ?? '0.0.0.0';

  const project = readProjectConfiguration(tree, options.project);
  project.targets ??= {};

  const serve = project.targets.serve;
  const isOrchestrator = serve?.executor === 'nx:run-commands';

  // The emulator-free app dev-server target the orchestrator composes. `serve-no-emulators` is the
  // current name; `serve-standalone` and `serve-app` are legacy names (firebase-emulators renames
  // them) — tolerate all three so host lands correctly whether serve-options runs before or after
  // that rename migration.
  const devServerName = project.targets['serve-no-emulators']
    ? 'serve-no-emulators'
    : project.targets['serve-standalone']
    ? 'serve-standalone'
    : project.targets['serve-app']
    ? 'serve-app'
    : null;

  if (isOrchestrator && devServerName) {
    // Firebase shape: the actual dev-server lives at serve-no-emulators (or a legacy name).
    // 1) Clean any stray `host` off the orchestrator (left by an earlier run of this
    //    generator that didn't yet know the shape), so nx:run-commands stops forwarding it.
    if (serve.options && 'host' in serve.options) {
      delete (serve.options as Record<string, unknown>).host;
    }
    // 2) Apply host to the real dev-server target.
    const devServer = project.targets[devServerName];
    devServer.options = { ...devServer.options, host };
  } else {
    // Plain form: `serve` IS the Angular dev-server (firebase not opted in, or first run
    //   before firebase-emulators reshapes it).
    project.targets.serve ??= {};
    project.targets.serve.options = { ...project.targets.serve.options, host };
  }

  updateProjectConfiguration(tree, options.project, project);
  await formatFiles(tree);
}
