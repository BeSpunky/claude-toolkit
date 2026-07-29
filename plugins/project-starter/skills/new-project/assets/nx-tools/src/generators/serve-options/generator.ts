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
//   - Plain case — `serve` is still the raw Angular dev-server (a fresh scaffold before the `serve`
//     generator runs) → set `host` on `serve.options`.
//
// Those two shapes are the whole story. The HISTORIC ones — a dev-server parked under `serve-with-emulators`
// / `serve-no-emulators` / `serve-standalone` / `serve-app` — are normalised by the 0.24.0
// `unify-serve-targets` migration BEFORE this generator ever sees the project, so it asserts the current
// shape instead of tolerating past ones. Safe to re-run at any stage.
//
// ONE SHAPE IS STILL CHECKED FOR HERE, and deliberately: an `nx:run-commands` orchestrator at `serve`.
// That is NOT legacy tolerance — it is a correctness rule about what this generator may WRITE, and it has to
// live where the write happens. `run-commands` forwards its options to the child command as bare flags, so a
// `host` option there becomes a stray `--host=…` appended to whatever it runs. The 0.24.0 migration strips
// exactly that key, and both run in ONE sync (migration first), so without the check below this generator
// would hand it straight back and the migration would be a no-op in practice. A guard on the OUTPUT belongs
// to the writer; a guard that only exists upstream is one ordering change away from being gone.
import {
  type Tree,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
  logger,
} from '@nx/devkit';

/** The legacy orchestrator's executor — the one `serve` shape that must never be given `host`. */
const RUN_COMMANDS_EXECUTOR = 'nx:run-commands';

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

  // The one canonical name for the real app dev-server — the leaf the `serve` composer drives by name.
  const devServer = targets['dev-server'];

  if (devServer) {
    // House shape: the real dev-server leaf lives alongside the composing serve.
    // 1) The nx-tools:serve composer DELEGATES `host` to the dev-server (forwards `--host`), so `host`
    //    belongs on it too — assert it (the `serve` generator sets it; this keeps --sync honest).
    if (serveIsNxToolsComposer && serve) {
      serve.options = { ...serve.options, host };
    }
    // 2) Apply host to the dev-server leaf itself.
    devServer.options = { ...devServer.options, host };
  } else if (serve?.executor === RUN_COMMANDS_EXECUTOR) {
    // A `run-commands` orchestrator with no `dev-server` leaf beside it. There is nowhere correct to put
    // `host`: on the orchestrator it becomes a bare `--host=…` on the child command (the very key the 0.24.0
    // migration removes), and inventing a `dev-server` here would be this generator taking over the `serve`
    // generator's job. So write nothing and say why — the fix is to run the `serve` generator against this
    // project, which replaces the orchestrator with the composer + leaf that `host` belongs on.
    logger.warn(
      `[serve-options] \`${options.project}\`'s \`serve\` is still an \`${RUN_COMMANDS_EXECUTOR}\` orchestrator ` +
        `with no \`dev-server\` leaf, so \`host: ${host}\` was NOT set: run-commands forwards its options to the ` +
        `child command as bare flags, and a stray \`--host=${host}\` would break it. Run the \`serve\` generator ` +
        `against this project (\`nx g @bespunky/nx-tools:serve --project=${options.project}\`) to get the ` +
        `composer + \`dev-server\` shape that carries \`host\` correctly.`
    );
  } else {
    // Plain form: `serve` IS the Angular dev-server (before the `serve` generator reshapes it).
    targets.serve ??= {};
    targets.serve.options = { ...targets.serve.options, host };
  }

  updateProjectConfiguration(tree, options.project, project);
  await formatFiles(tree);
}
