// THE CONTAINER HAS THE PROJECT'S PACKAGE MANAGER. An image's package managers are the image's accident, and post-create's
// install runs under `set -e`. What would break silently:
//   - the image layer stating something other than what package.json declares (a rebuild then reinstalls on every create);
//   - a repeat run moving the layer's spec or the script, which would cost every project a rebuild for nothing;
//   - a project that changed `packageManager` keeping the old spec past its next upgrade.
// The installer's behaviour and the shell/TS agreement are tested in tools/test-layers, where the fakes live.
import { workspace } from '../workspaces.mjs';

const SCRIPT = '.devcontainer/house.package-manager.sh';
const DOCKERFILE = '.devcontainer/house.Dockerfile';
const LAYERS = ['nx', 'agent', 'node'];

const declaring = (packageManager) => () => {
  const tree = workspace();
  tree.write('.nvmrc', '26\n');
  tree.write('package.json', JSON.stringify({ name: 'acme', ...(packageManager ? { packageManager } : {}) }, null, 2));
  return tree;
};
const generate = (tree, ctx, layers = LAYERS) => ctx.load('generators/devcontainer/generator').default(tree, { name: 'acme', layers });

export default {
  name: 'devcontainer: the package manager',
  cases: [
    {
      name: 'the image layer states the declared version; the FROM is the project\'s Node, whatever ships in it',
      setup: declaring('yarn@1.22.22+sha512.abc'),
      run: (tree, ctx) => generate(tree, ctx),
      expect: (tree, t) => {
        const dockerfile = tree.read(DOCKERFILE, 'utf8');
        t.ok(dockerfile.includes('typescript-node:26'), 'FROM the project\'s Node');
        t.ok(dockerfile.includes("house.package-manager.sh 'yarn@1.22.22' "), 'the exact version, without its corepack hash');
        t.ok(tree.read(SCRIPT, 'utf8').includes('yarn 1.22.22'), 'the script carries the house pins');
      },
    },
    {
      name: 'no declared version: the layer asks for the package manager alone, and the script holds the pin',
      setup: () => {
        const tree = declaring()();
        tree.write('pnpm-lock.yaml', '');
        return tree;
      },
      run: (tree, ctx) => generate(tree, ctx),
      expect: (tree, t) => t.ok(tree.read(DOCKERFILE, 'utf8').includes("house.package-manager.sh 'pnpm' "), 'pnpm, with no version of its own'),
    },
    {
      name: 'a project that changed packageManager gets the new spec at its next upgrade',
      once: 'it changes package.json between two generator runs, so a repeat is not the same input',
      setup: declaring('yarn@1.22.22'),
      run: async (tree, ctx) => {
        await generate(tree, ctx);
        tree.write('package.json', JSON.stringify({ name: 'acme', packageManager: 'pnpm@9.15.9' }, null, 2));
        await generate(tree, ctx);
      },
      expect: (tree, t) => {
        const dockerfile = tree.read(DOCKERFILE, 'utf8');
        t.ok(dockerfile.includes("'pnpm@9.15.9'") && !dockerfile.includes('yarn@1.22.22'), 'the old spec is gone');
      },
    },
    {
      name: 'an adopted image of its own: no Dockerfile, the same script for post-create to run',
      setup: () => {
        const tree = declaring('yarn@4.5.0')();
        tree.write('.devcontainer/devcontainer.json', '{ "image": "node:26", "remoteUser": "node" }\n');
        return tree;
      },
      run: (tree, ctx) => generate(tree, ctx),
      expect: (tree, t) => {
        t.ok(!tree.exists(DOCKERFILE), 'no house Dockerfile beside a foreign image');
        t.ok(tree.exists(SCRIPT), 'the script is written');
        t.ok(tree.read('.devcontainer/post-create.sh', 'utf8').includes('house.package-manager.sh" "$PM_SPEC"'), 'post-create runs it');
      },
    },
  ],
};
