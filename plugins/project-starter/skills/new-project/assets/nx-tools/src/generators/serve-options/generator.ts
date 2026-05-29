// House generator: set dev-server options on a project's serve target the Nx-native way.
// Uses @nx/devkit (resolved from the host workspace) so the change is format-aware and project-graph aware.
//
// Sets `host: '0.0.0.0'` so the dev server is reachable from outside the devcontainer.
//
// Polling is NOT set here. Modern Angular's `@angular/build:dev-server` schema does not accept `poll`;
// reliable file-watching over WSL/Docker mounts is enabled instead via env vars
// (CHOKIDAR_USEPOLLING + CHOKIDAR_INTERVAL) set on the devcontainer (see the devcontainer generator),
// which is respected by any chokidar-based watcher across both old and new Angular builders.
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
  project.targets.serve ??= {};
  project.targets.serve.options = { ...project.targets.serve.options, host };

  updateProjectConfiguration(tree, options.project, project);
  await formatFiles(tree);
}
