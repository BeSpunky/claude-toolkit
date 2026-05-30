// House generator: write the BeSpunky-standard .devcontainer/devcontainer.json.
// Reads its own bundled template (not a workspace file) and writes through the Nx Tree.
//
// Template supports two kinds of placeholders:
//   - simple substitution:   {{name}}, {{nodeMajor}}
//   - conditional blocks:    {{#flag}}...{{/flag}}  -> included iff the flag option is truthy
// (`firebase` is the only conditional flag for now; add more by passing them in `options`.)
import { type Tree } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface DevcontainerSchema {
  name: string;
  nodeMajor?: string | number;
  firebase?: boolean;
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
  const flags: Record<string, boolean> = { firebase: !!options.firebase };

  const template = readFileSync(join(__dirname, 'devcontainer.json.tpl'), 'utf8');

  // 1) Expand conditional blocks: {{#flag}}body{{/flag}} -> body if flag truthy, else removed.
  const expanded = template.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, flag: string, body: string) => (flags[flag] ? body : '')
  );

  // 2) Substitute simple placeholders.
  const content = expanded
    .split('{{name}}')
    .join(options.name)
    .split('{{nodeMajor}}')
    .join(nodeMajor);

  tree.write('.devcontainer/devcontainer.json', content);

  // 3) Companion script — .devcontainer/post-create.sh — owns all multi-step setup
  //    so devcontainer.json's postCreateCommand stays a one-liner. The script is
  //    self-adapting (Firebase steps fire only when firebase.json exists at the
  //    workspace root), so no templating is needed here — it ships verbatim.
  const postCreate = readFileSync(join(__dirname, 'post-create.sh.tpl'), 'utf8');
  tree.write('.devcontainer/post-create.sh', postCreate);
}
