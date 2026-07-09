import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * A single git worktree, distilled from `git worktree list --porcelain` into
 * exactly what the serve executor needs to describe and target it.
 */
export interface Worktree {
  /** Absolute path to the worktree's root directory. */
  path: string;
  /** Short branch name (e.g. `feat/foo`); undefined when the worktree is detached. */
  branch?: string;
  /** Commit the worktree currently points at. */
  head?: string;
  /** True when the worktree is in detached-HEAD state (no branch). */
  detached: boolean;
  /** The repository's primary worktree — git always lists it first. */
  isMain: boolean;
  /** The worktree the executor is being invoked from. */
  isCurrent: boolean;
}

/**
 * Parse the output of `git worktree list --porcelain` into {@link Worktree}s.
 *
 * Kept pure (string in, data out) so the collection logic is unit-testable
 * without a real repository. Bare entries carry no working tree and can't be
 * served, so they're dropped here.
 *
 * @param porcelain  Raw `--porcelain` output.
 * @param currentRoot  The invoking workspace root, used to flag `isCurrent`.
 */
export function parseWorktrees(porcelain: string, currentRoot?: string): Worktree[] {
  const current = currentRoot ? resolve(currentRoot) : undefined;
  const worktrees: Worktree[] = [];

  // Each record is a block of `key value` lines terminated by a blank line.
  let path: string | undefined;
  let branch: string | undefined;
  let head: string | undefined;
  let detached = false;
  let bare = false;

  const flush = () => {
    if (path && !bare) {
      worktrees.push({
        path,
        branch,
        head,
        detached,
        isMain: false, // assigned after the full list is known
        isCurrent: current !== undefined && resolve(path) === current,
      });
    }
    path = branch = head = undefined;
    detached = bare = false;
  };

  for (const raw of porcelain.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') {
      flush();
      continue;
    }
    const sp = line.indexOf(' ');
    const key = sp === -1 ? line : line.slice(0, sp);
    const value = sp === -1 ? '' : line.slice(sp + 1);
    switch (key) {
      case 'worktree':
        flush();
        path = value;
        break;
      case 'HEAD':
        head = value;
        break;
      case 'branch':
        branch = value.replace(/^refs\/heads\//, '');
        break;
      case 'detached':
        detached = true;
        break;
      case 'bare':
        bare = true;
        break;
      // `locked` / `prunable` don't affect how we serve — ignore.
    }
  }
  flush();

  if (worktrees.length > 0) {
    worktrees[0].isMain = true;
  }
  return worktrees;
}

/** Run git in `repoRoot` and return its worktrees, current one flagged. */
export function collectWorktrees(repoRoot: string): Worktree[] {
  const porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return parseWorktrees(porcelain, repoRoot);
}

/** A one-line, human-readable label for a worktree (branch, markers, path). */
export function worktreeLabel(w: Worktree): string {
  const ref = w.branch ?? `(detached ${(w.head ?? '???????').slice(0, 7)})`;
  const markers = [w.isMain ? 'main' : null, w.isCurrent ? 'current' : null].filter(Boolean);
  const suffix = markers.length ? `  [${markers.join(', ')}]` : '';
  return `${ref}${suffix}  ·  ${w.path}`;
}

/**
 * Resolve a free-text `query` (branch name or path) to worktrees.
 * Exact branch/path matches win outright; otherwise a loose match (substring
 * branch, path suffix, or directory basename) is used. Returns every match so
 * the caller can distinguish "none" from "ambiguous".
 */
export function matchWorktree(worktrees: Worktree[], query: string): Worktree[] {
  const q = query.trim();
  const exact = worktrees.filter((w) => w.branch === q || resolve(w.path) === resolve(q));
  if (exact.length) return exact;
  return worktrees.filter(
    (w) =>
      (w.branch !== undefined && w.branch.includes(q)) ||
      w.path.endsWith(q) ||
      w.path.split('/').pop() === q,
  );
}
