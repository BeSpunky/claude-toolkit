// House generator: set dev-server options on a project's serve target the Nx-native way.
// Uses @nx/devkit (resolved from the host workspace) so the change is format-aware and project-graph aware.
const { readProjectConfiguration, updateProjectConfiguration, formatFiles } = require('@nx/devkit');

module.exports = async function serveOptionsGenerator(tree, options) {
  const host = options.host || '0.0.0.0';
  const poll = options.poll != null ? options.poll : 1000;

  const project = readProjectConfiguration(tree, options.project);
  project.targets = project.targets || {};
  project.targets.serve = project.targets.serve || {};
  project.targets.serve.options = Object.assign(
    {},
    project.targets.serve.options,
    { host, poll }
  );

  updateProjectConfiguration(tree, options.project, project);
  await formatFiles(tree);
};
