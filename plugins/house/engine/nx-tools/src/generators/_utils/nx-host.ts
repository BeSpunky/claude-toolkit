// HOW THIS REPO HOSTS AND INVOKES NX — the same decision house.sh makes (`HOST`), in one place for the
// generators.
//
//   wrapper  no root package.json, or a repo already running the Nx wrapper (`.nx/nxw.js` + an `installation`
//            block in nx.json): Nx runs as `./nx`, the toolkit is pinned in nx.json, nothing is a Node project.
//   node     Nx lives in node_modules and runs through the package manager.
import type { Tree } from '@nx/devkit';
import { PACKAGE_MANAGERS, type PackageManager, DEFAULT_PACKAGE_MANAGER, detectPackageManager } from './package-manager';

export function isWrapperHosted(tree: Tree): boolean {
  if (!tree.exists('package.json')) return true;
  return tree.exists('.nx/nxw.js') && /"installation"\s*:/.test(tree.read('nx.json', 'utf8') ?? '');
}

export interface NxInvocation {
  /** How a PERSON runs nx here, as the docs print it: `./nx`, `yarn nx`, `pnpm nx`, `npx nx`. */
  command: string;
  /**
   * What a PROCESS spawns, relative to the tree root, as a command and its first arguments: no package manager in between, and
   * nothing that outlives a signal. Not `./nx` on the wrapper host: that is Nx's own bash script, whose last line runs node with
   * no `exec`, so a stop aimed at the process kills the script and leaves Nx, and whatever it runs, holding the port.
   */
  spawn: readonly string[];
  /** Nx is installed by the package manager into node_modules (else: the wrapper's `.nx/installation`). */
  nodeHost: boolean;
  /** The package manager, on a node host. */
  packageManager?: PackageManager;
}

/**
 * The one answer to "how is nx run in this repo". `packageManager` overrides detection (house.sh passes the one
 * it detected), and is meaningless on the wrapper host.
 */
export function nxInvocation(tree: Tree, packageManager?: string): NxInvocation {
  if (isWrapperHosted(tree)) return { command: './nx', spawn: ['node', '.nx/nxw.js'], nodeHost: false };
  const pm =
    packageManager && packageManager in PACKAGE_MANAGERS
      ? (packageManager as PackageManager)
      : (detectPackageManager(tree) ?? DEFAULT_PACKAGE_MANAGER);
  return { command: PACKAGE_MANAGERS[pm].nx, spawn: ['node_modules/.bin/nx'], nodeHost: true, packageManager: pm };
}
