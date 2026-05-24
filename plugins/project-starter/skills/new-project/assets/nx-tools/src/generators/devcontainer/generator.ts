// House generator: write the BeSpunky-standard .devcontainer/devcontainer.json.
// Reads its own bundled template (not a workspace file) and writes through the Nx Tree.
import { type Tree } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface DevcontainerSchema {
  name: string;
  nodeMajor?: string | number;
}

export default async function devcontainerGenerator(
  tree: Tree,
  options: DevcontainerSchema
): Promise<void> {
  if (!options.name) {
    throw new Error('devcontainer generator requires --name (the devcontainer / project name).');
  }
  // Default the image tag to the Node major we are running under (the base image), if not given.
  const nodeMajor = String(options.nodeMajor ?? process.versions.node.split('.')[0]);

  const template = readFileSync(join(__dirname, 'devcontainer.json.tpl'), 'utf8');
  const content = template
    .split('{{name}}')
    .join(options.name)
    .split('{{nodeMajor}}')
    .join(nodeMajor);

  tree.write('.devcontainer/devcontainer.json', content);
}
