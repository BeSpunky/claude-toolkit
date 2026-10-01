// Which package manager a Node-hosted workspace uses — the ONE precedence every house tool agrees on:
// the `packageManager` DECLARATION first, then the lockfile, then the house default (yarn).
//
// It is decided from the workspace's own evidence, never assumed: installing a yarn workspace with npm writes
// a second lockfile into a tree the developer is about to commit.
import type { Tree } from '@nx/devkit';

export type PackageManager = 'yarn' | 'npm' | 'pnpm';

export function detectPackageManager(tree: Tree): PackageManager {
  const declared = /"packageManager"\s*:\s*"(yarn|npm|pnpm)@/.exec(tree.read('package.json', 'utf8') ?? '')?.[1];
  if (declared) return declared as PackageManager;
  if (tree.exists('pnpm-lock.yaml')) return 'pnpm';
  if (tree.exists('yarn.lock')) return 'yarn';
  if (tree.exists('package-lock.json')) return 'npm';
  return 'yarn';
}
