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
//     `serve` is the @bespunky/nx-tools:serve composer → set `host` on `dev-server.options`, and strip
//     any stray `host` off the composing `serve` target (a run-commands/composer target would forward
//     it as `--host=…` via flag-passthrough).
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
  // A composing `serve` (the nx-tools serve executor, or a legacy run-commands orchestrator) must NOT
  // carry `host` — it would be forwarded to a child as a flag.
  const serveIsComposer =
    serve?.executor === '@bespunky/nx-tools:serve' || serve?.executor === 'nx:run-commands';

  // Every name the real app dev-server can live under, current-first. The house `dev-server` leaf wins;
  // the legacy Firebase inner targets are tolerated for --repair on older projects.
  const devServerNames = ['dev-server', 'serve-with-emulators', 'serve-no-emulators', 'serve-standalone', 'serve-app'].filter(
    (name) => targets[name]
  );

  if (devServerNames.length > 0) {
    // House / Firebase shape: the real dev-server(s) live alongside the composing serve.
    // 1) Clean any stray `host` off the composer (left by an earlier run that didn't yet know the shape).
    if (serveIsComposer && serve?.options && 'host' in serve.options) {
      delete (serve.options as Record<string, unknown>).host;
    }
    // 2) Apply host to every real dev-server target.
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
