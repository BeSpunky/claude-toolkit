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
//   - House shape — the app dev-server is the `dev-server` leaf (created by the `serve` generator) and
//     `serve` is the @bespunky/nx-tools:serve composer → set `host` on the `dev-server` leaf AND on
//     `serve` (the composer DELEGATES host to the dev-server via `--host`, so it belongs there too).
//   - Legacy exception — a `nx:run-commands` orchestrator at `serve` must NOT carry `host` (it would be
//     forwarded to a child as a bare `--host=…` flag), so strip it there.
//   - Plain case — `serve` is still the raw Angular dev-server (a fresh scaffold before the `serve`
//     generator runs) → set `host` on `serve.options`.
//
// Legacy dev-server names (`serve-with-emulators`, `serve-no-emulators`, `serve-standalone`,
// `serve-app`) are also tolerated so `--repair` on an older project still lands `host` correctly,
// whichever stage its serve targets are in. Safe to re-run at any stage.
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
  const targets = project.targets;

  const serve = targets.serve;
  const serveIsNxToolsComposer = serve?.executor === '@bespunky/nx-tools:serve';
  const serveIsLegacyOrchestrator = serve?.executor === 'nx:run-commands';

  // Every name the real app dev-server can live under, current-first. The house `dev-server` leaf wins;
  // the legacy Firebase inner targets are tolerated for --repair on older projects.
  const devServerNames = ['dev-server', 'serve-with-emulators', 'serve-no-emulators', 'serve-standalone', 'serve-app'].filter(
    (name) => targets[name]
  );

  if (devServerNames.length > 0) {
    // House / Firebase shape: the real dev-server(s) live alongside the composing serve.
    // 1) A LEGACY run-commands orchestrator at `serve` must not carry `host` — it would be forwarded to a
    //    child as a bare flag. (The nx-tools:serve composer is the opposite — see (2).)
    if (serveIsLegacyOrchestrator && serve?.options && 'host' in serve.options) {
      delete (serve.options as Record<string, unknown>).host;
    }
    // 2) The nx-tools:serve composer DELEGATES `host` to the dev-server (forwards `--host`), so `host`
    //    belongs on it too — assert it (the `serve` generator sets it; this keeps --repair honest).
    if (serveIsNxToolsComposer && serve) {
      serve.options = { ...serve.options, host };
    }
    // 3) Apply host to every real dev-server target.
    for (const name of devServerNames) {
      const devServer = targets[name];
      devServer.options = { ...devServer.options, host };
    }
  } else {
    // Plain form: `serve` IS the Angular dev-server (before the `serve` generator reshapes it).
    targets.serve ??= {};
    targets.serve.options = { ...targets.serve.options, host };
  }

  updateProjectConfiguration(tree, options.project, project);
  await formatFiles(tree);
}
