// Git worktrees — which tree a serve targets, and the DNS slug it is reached at. GENERATOR-OWNED
// (@bespunky/nx-tools:dev); rewritten every sync.
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

/**
 * Parse `git worktree list --porcelain` into `{ path, branch?, head?, detached, isMain, isCurrent }`.
 * Pure (string in, data out). Bare entries carry no working tree and can't be served, so they're dropped.
 * Git always lists the primary worktree first.
 */
export function parseWorktrees(porcelain, currentRoot) {
  const current = currentRoot ? resolve(currentRoot) : undefined;
  const worktrees = [];
  let path, branch, head;
  let detached = false;
  let bare = false;

  const flush = () => {
    if (path && !bare) {
      worktrees.push({
        path,
        branch,
        head,
        detached,
        isMain: false,
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
    if (key === 'worktree') {
      flush();
      path = value;
    } else if (key === 'HEAD') head = value;
    else if (key === 'branch') branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'detached') detached = true;
    else if (key === 'bare') bare = true;
  }
  flush();

  if (worktrees.length > 0) worktrees[0].isMain = true;
  return worktrees;
}

/**
 * The repository's worktrees AS WORKSPACES: each entry's `path` is the directory a serve runs in — the workspace
 * root inside that worktree, not the worktree's git toplevel. An Nx workspace may live in a subdirectory of its
 * repository (`mono/services/web`), and then every tree serves from `<worktree>/services/web`: the same prefix,
 * read once from git (`--show-prefix`), joined onto every worktree. Equating the tree with the git toplevel ran
 * every process, and the install, in the repository root.
 *
 * `root` is this workspace's root (the directory holding tools/dev). A directory that is not a git repository is
 * served as a single tree (it is its own main tree) — the engine needs no git to run.
 */
export function collectWorktrees(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let top, prefix;
  try {
    top = git('rev-parse', '--show-toplevel').trim();
    prefix = git('rev-parse', '--show-prefix').trim();
  } catch {
    return [{ path: resolve(root), detached: false, isMain: true, isCurrent: true }];
  }
  return parseWorktrees(git('worktree', 'list', '--porcelain'), top).map((w) => ({ ...w, path: prefix ? resolve(w.path, prefix) : w.path }));
}

/**
 * The slug a tree is served at — `<slug>.localhost`. The MAIN tree is reached at the workspace's name (the main
 * tree's directory); every other tree at its own worktreeSlug. ONE function, because two parties must agree on
 * it: the engine registers this slug, and worktree-domains' reconcile keeps a route only while some tree still
 * answers to it. Two copies of the rule is how live routes were dropped as "worktree gone".
 */
export function servedSlug(tree, worktrees) {
  const main = worktrees.find((w) => w.isMain) ?? worktrees[0];
  return worktreeSlug(tree, basename(main.path));
}

/** A one-line, human-readable label for a worktree (branch, markers, path). */
export function worktreeLabel(w) {
  const ref = w.branch ?? (w.head ? `(detached ${w.head.slice(0, 7)})` : '(no git)');
  const markers = [w.isMain ? 'main' : null, w.isCurrent ? 'current' : null].filter(Boolean);
  const suffix = markers.length ? `  [${markers.join(', ')}]` : '';
  return `${ref}${suffix}  ·  ${w.path}`;
}

/**
 * Coerce a string into a valid DNS label (lowercase `[a-z0-9-]`, no edge hyphens, ≤ 63 chars). Mirrored by the
 * payload's `_utils/dns-label.ts` (the worktree tab label bakes the main tree's slug with it) — keep them in step.
 */
export function toDnsLabel(input) {
  const label = input
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return label || 'app';
}

/**
 * The slug naming a tree's pretty `<slug>.localhost` domain: the MAIN tree → the workspace name; a worktree →
 * its branch (slashes flattened), else its directory name.
 */
export function worktreeSlug(w, workspaceName) {
  if (w.isMain) return toDnsLabel(workspaceName);
  return toDnsLabel(w.branch ?? basename(w.path));
}

/** The stable identity a tree's port block derives from — its branch, else its path. */
export function worktreeKey(w) {
  return w.branch ?? w.path;
}

/**
 * Resolve free text (branch, slug, or path) to worktrees. Exact branch/path wins outright; otherwise a loose
 * match. Returns every match so the caller can tell "none" from "ambiguous".
 */
export function matchWorktree(worktrees, query) {
  const q = query.trim();
  const exact = worktrees.filter((w) => w.branch === q || resolve(w.path) === resolve(q));
  if (exact.length) return exact;
  const qSlug = toDnsLabel(q);
  return worktrees.filter(
    (w) =>
      (w.branch !== undefined && w.branch.includes(q)) ||
      w.path.endsWith(q) ||
      basename(w.path) === q ||
      toDnsLabel(w.branch ?? basename(w.path)) === qSlug,
  );
}
