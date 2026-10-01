// HOW THIS REPO HOSTS NX — the same decision scaffold.sh makes (`HOST`), in one place for the generators.
//
//   wrapper  no root package.json, or a repo already running the Nx wrapper (`.nx/nxw.js` + an `installation`
//            block in nx.json): Nx runs as `./nx`, the toolkit is pinned in nx.json, nothing is a Node project.
//   node     Nx lives in node_modules and runs through the package manager.
import type { Tree } from '@nx/devkit';

export function isWrapperHosted(tree: Tree): boolean {
  if (!tree.exists('package.json')) return true;
  return tree.exists('.nx/nxw.js') && /"installation"\s*:/.test(tree.read('nx.json', 'utf8') ?? '');
}
