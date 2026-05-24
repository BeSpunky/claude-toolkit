// House generator: set dev-server options on a project's serve target the Nx-native way.
// Uses @nx/devkit (resolved from the host workspace) so the change is format-aware and project-graph aware.
import {
  type Tree,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
} from '@nx/devkit';

interface ServeOptionsSchema {
  project: string;
  host?: string;
  poll?: number;
}

export default async function serveOptionsGenerator(
  tree: Tree,
  options: ServeOptionsSchema
): Promise<void> {
  const host = options.host ?? '0.0.0.0';
  const poll = options.poll ?? 1000;

  const project = readProjectConfiguration(tree, options.project);
  project.targets ??= {};
  project.targets.serve ??= {};
  project.targets.serve.options = { ...project.targets.serve.options, host, poll };

  updateProjectConfiguration(tree, options.project, project);
  await formatFiles(tree);
}
