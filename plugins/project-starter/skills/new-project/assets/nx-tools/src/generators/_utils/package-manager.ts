// Which package manager a Node-hosted workspace uses — the ONE precedence every house tool agrees on:
// the `packageManager` DECLARATION first, then the lockfile, then the house default (yarn).
//
// It is decided from the workspace's own evidence, never assumed: installing a yarn workspace with npm writes
// a second lockfile into a tree the developer is about to commit.
import type { Tree } from '@nx/devkit';

export type PackageManager = 'yarn' | 'npm' | 'pnpm';

/**
 * The workspace's package manager, or `undefined` when there is no root package.json to have one (a repo hosted by
 * the Nx wrapper — never answered with a guess, which is how a Python repo used to be told to run `yarn nx …`).
 *
 * The SAME precedence scaffold.sh's `detect_package_manager` and the generated post-create.sh use: the
 * `packageManager` field is the only signal a human deliberately WROTE; every other one is an artifact.
 */
export function detectPackageManager(tree: Tree): PackageManager | undefined {
  if (!tree.exists('package.json')) return undefined;
  const declared = /"packageManager"\s*:\s*"(yarn|npm|pnpm)@/.exec(tree.read('package.json', 'utf8') ?? '')?.[1];
  if (declared) return declared as PackageManager;
  if (tree.exists('pnpm-lock.yaml')) return 'pnpm';
  if (tree.exists('yarn.lock')) return 'yarn';
  if (tree.exists('package-lock.json')) return 'npm';
  // A package.json that declares nothing: the house default, the same one scaffold.sh falls back to.
  return 'yarn';
}
