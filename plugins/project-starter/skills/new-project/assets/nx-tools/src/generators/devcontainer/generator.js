// House generator: write the BeSpunky-standard .devcontainer/devcontainer.json.
// Reads its own bundled template (not a workspace file) and writes through the Nx Tree.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async function devcontainerGenerator(tree, options) {
  const name = options.name;
  if (!name) {
    throw new Error('devcontainer generator requires --name (the devcontainer / project name).');
  }
  // Default the image tag to the Node major we are running under (the base image), if not given.
  const nodeMajor = String(options.nodeMajor || process.versions.node.split('.')[0]);

  const template = readFileSync(join(__dirname, 'devcontainer.json.tpl'), 'utf8');
  const content = template.split('{{name}}').join(name).split('{{nodeMajor}}').join(nodeMajor);

  tree.write('.devcontainer/devcontainer.json', content);
};
