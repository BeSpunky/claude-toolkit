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
//   - If `serve` is the Angular dev-server directly → set `host` on `serve.options`.
//   - If `serve` has been wrapped into an `nx:run-commands` orchestrator by the
//     firebase-emulators generator (the wrapper runs `emulators` + `serve-app` in parallel)
//     → set `host` on `serve-app.options` instead, AND remove any stray `host` from the
//     wrapper's options. Setting `host` on the wrapper would forward it as `--host=0.0.0.0`
//     to every parallel command via nx:run-commands' flag-passthrough — breaking
//     `firebase emulators:start`, which has no `--host` flag.
//
// This makes the generator safe to re-run on a project at any stage (fresh, wrapped, both).
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
  const isWrapper = serve?.executor === 'nx:run-commands';

  if (isWrapper && project.targets['serve-app']) {
    // Wrapped form: actual dev-server lives at `serve-app`.
    // 1) Clean any stray `host` off the wrapper (left by an earlier run of this generator
    //    that didn't yet know about the wrap), so nx:run-commands stops forwarding it.
    if (serve.options && 'host' in serve.options) {
      delete (serve.options as Record<string, unknown>).host;
    }
    // 2) Apply host to the real dev-server target.
    const serveApp = project.targets['serve-app'];
    serveApp.options = { ...serveApp.options, host };
  } else {
    // Unwrapped form: `serve` IS the Angular dev-server (firebase not opted in, or first run
    //   before firebase-emulators wraps it).
    project.targets.serve ??= {};
    project.targets.serve.options = { ...project.targets.serve.options, host };
  }

  updateProjectConfiguration(tree, options.project, project);
  await formatFiles(tree);
}
