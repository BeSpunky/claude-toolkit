// The workspace's IDENTITY — the name a generator uses when it asks "who is this project?" and was not told.
//
// Not the workspace directory's name. The house upgrade runs in a git worktree whenever it starts on a protected
// branch, and that worktree is named after the run (`house-upgrade-2026-10-05`). A default of `basename(tree.root)`
// therefore stamped the run's slug into everything that asked — the worktree tab label's main-tree sentinel, the
// window identity's name hash, the Firebase demo project id — in exactly the setup the upgrade mandates.
//
// The identity is the name the same directory has in the repository's MAIN worktree. `--git-common-dir` is shared
// by every worktree and, for an ordinary layout, is the main worktree's `.git`, so its parent is the main
// worktree. Only the worktree's TOP maps to that name: a workspace in a subdirectory of its repository is named
// after that subdirectory, which is the same in every worktree. No git, or a bare/submodule layout whose common
// dir is not a `.git` beside a working tree → the directory's own name.
//
// The same rule as the engine's `_project_identity` (engine/house.sh), which must answer before this package is
// installed and hands its answer to every generator it runs. Keep the two in step; this one is the default for a
// generator run on its own (`nx g …` by hand), the engine's is what an upgrade actually passes.
import type { Tree } from '@nx/devkit';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';

export function workspaceIdentity(tree: Tree): string {
  const root = tree.root;
  const common = git(root, '--path-format=absolute', '--git-common-dir');
  const top = git(root, '--show-toplevel');
  if (common && top && basename(common) === '.git' && real(root) === real(top)) return basename(dirname(common));
  return basename(root);
}

function git(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null; // not a git repository, or no git — the directory's own name is the answer, not an error.
  }
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
