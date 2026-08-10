// Shared util: find the app roots in a workspace by walking the tree for a marker file.
//
// WHY A SHARED WALK AND WHY IT IS FUSSY. Two migrations need "every app that has X", and the naive walk
// they each started with wrote into places that are not the project:
//
//   • `.claude/worktrees/<slug>/` — the house's OWN documented convention puts a full second checkout of
//     the repo there (see the branch-and-release skill). `Tree.children` reads the filesystem and knows
//     nothing about `.gitignore`, so a migration walking blindly edits source on an unrelated feature
//     branch — a branch that is NOT being migrated, so it gets the new files and keeps the old ones, and
//     `--sync`'s git backup covers the main tree only. That is silent corruption of work in progress.
//   • `dist/`, `coverage/`, `.angular/` — build output containing copies of `src`, which produce both
//     pointless writes and spurious "could not wire" warnings about directories nobody edits.
//
// So: skip every dot-directory, skip the known build/output names, and skip anything carrying its own
// `.git` (a nested repo or worktree — in a worktree `.git` is a FILE, which is why `exists` is the test
// rather than a directory check).
//
// It also does two things the first version got wrong by omission: it tests the workspace ROOT itself
// (an `nx init`-retrofitted single-project repo has its app at `src/app`, and `--sync --ensure=agent`
// explicitly supports that shape), and it keeps recursing INTO a matched root, so an app nested under
// another app is found rather than silently skipped.
import type { Tree } from '@nx/devkit';

/** Directories that are never part of a project's source, whatever a workspace is shaped like. */
const NEVER_SOURCE = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'out-tsc',
  'tmp',
  'temp',
]);

/**
 * Every directory under the workspace (including the workspace root itself) for which `isAppRoot` is true.
 *
 * @param tree      the Nx tree to read.
 * @param isAppRoot predicate given a candidate root, e.g. `(r) => tree.exists(`${r}/src/app/app.config.ts`)`.
 *                  Called with `'.'` for the workspace root.
 * @param maxDepth  how deep to look below the root. 4 covers every house layout (`apps/<app>`,
 *                  `packages/<scope>/<app>`) with room to spare.
 */
export function findAppRoots(
  tree: Tree,
  isAppRoot: (root: string) => boolean,
  maxDepth = 4
): string[] {
  const roots: string[] = [];
  if (isAppRoot('.')) roots.push('.');

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    for (const child of tree.children(dir)) {
      // Dot-directories are tooling state, never project source — and `.claude/worktrees` is the one
      // that would do real damage. Excluded as a class rather than by name, so the next dot-directory
      // somebody invents is excluded before it exists.
      if (child.startsWith('.') || NEVER_SOURCE.has(child)) continue;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (tree.isFile(path)) continue;
      // A nested checkout: its own repository, not ours to edit.
      if (tree.exists(`${path}/.git`)) continue;
      if (isAppRoot(path)) roots.push(path);
      walk(path, depth + 1); // Keep going: an app nested under an app is odd, not invisible.
    }
  };
  walk('.', 1);
  return roots;
}
