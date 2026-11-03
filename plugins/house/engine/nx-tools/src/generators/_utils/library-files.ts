// THE FILES OF ONE LIBRARY, by the walk that knows where a library ends. Pure mechanics, so a migration may share them:
// a project nested inside another is its own, with its own runner, and an install or build output is nobody's spec.
import type { ProjectConfiguration, Tree } from '@nx/devkit';

/** Never walked. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist']);

/** `./x/` and `x` are one path, and the workspace root is the empty one, so that two of them can be compared. */
export function normalizedPath(path: string): string {
  const trimmed = path.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  return trimmed === '.' ? '' : trimmed;
}

/** `file` under `dir`, a normalized path. */
export const under = (dir: string, file: string): string => (dir ? `${dir}/${file}` : file);

/** Every other project's root in the workspace: where a walk of `root` stops. */
export function otherProjectRoots(projects: Iterable<ProjectConfiguration>, root: string): Set<string> {
  const own = normalizedPath(root);
  return new Set([...projects].map((project) => normalizedPath(project.root)).filter((other) => other !== own));
}

/** The files under `root`, a directory at a time, stopping at each of `stops`. */
export function* filesOfLibrary(tree: Tree, root: string, stops: ReadonlySet<string> = new Set()): Generator<string> {
  const dir = normalizedPath(root);
  for (const child of tree.children(dir || '.')) {
    const path = under(dir, child);
    if (tree.isFile(path)) yield path;
    else if (!SKIPPED_DIRS.has(child) && !child.startsWith('.') && !stops.has(path)) yield* filesOfLibrary(tree, path, stops);
  }
}

/** The first file `files` holds whose name `matching` accepts, or null. */
export function firstMatching(files: Iterable<string>, matching: RegExp): string | null {
  for (const file of files) if (matching.test(file.slice(file.lastIndexOf('/') + 1))) return file;
  return null;
}
