// THE `paths` STRATEGY — the integrated model: one global alias table, `compilerOptions.paths`, in the root
// tsconfig. An alias is visible to every project at once, so a consumer needs no wiring of its own.
import { type Tree, getProjects, updateJson, logger } from '@nx/devkit';
import type { Linking, LinkRequest, LinkedLibrary } from './linking';
import { rootTsconfig, rootCompilerOptions } from './tsconfig-roots';
import { defaultEntry, specifierOf, rootContaining, workspacePath } from './shared';

const aliases = (tree: Tree): Record<string, string[]> => rootCompilerOptions(tree).paths ?? {};

/** Does this alias target lie inside the library at `libRoot`? */
const into = (libRoot: string) => (target: string) => {
  const path = workspacePath(target);
  const root = workspacePath(libRoot);
  return path === root || path.startsWith(`${root}/`);
};

export const pathsLinking: Linking = {
  kind: 'paths',

  link(tree: Tree, request: LinkRequest): void {
    const file = rootTsconfig(tree);
    const specifier = specifierOf(request);
    const entry = request.entry ?? defaultEntry(request);
    if (!file) {
      logger.warn(`[linking] No root tsconfig to hold the path alias "${specifier}" -> ${entry}; it was not linked.`);
      return;
    }
    updateJson(tree, file, (json) => {
      json.compilerOptions ??= {};
      json.compilerOptions.paths ??= {};
      const existing: string[] | undefined = json.compilerOptions.paths[specifier];
      // An alias that already exists is the workspace's decision, never silently replaced — but a different one
      // is said out loud, since the library just created will not be what that specifier resolves to.
      if (!existing) json.compilerOptions.paths[specifier] = [entry];
      else if (!existing.some((target) => workspacePath(target) === workspacePath(entry))) {
        logger.warn(`[linking] Kept the existing path alias "${specifier}" -> ${existing.join(', ')} (not ${entry}). Point it at ${entry} if this library should own it.`);
      }
      return json;
    });
  },

  resolve(tree, importPath) {
    const target = aliases(tree)[importPath]?.[0];
    if (!target) return undefined;
    try {
      return rootContaining(getProjects(tree), workspacePath(target));
    } catch {
      return undefined;
    }
  },

  importPathOf(tree, libRoot) {
    // The package's own alias is its SHORTEST one pointing inside it; the longer ones are its subpaths.
    return Object.entries(aliases(tree))
      .filter(([alias, targets]) => !alias.includes('*') && (targets ?? []).some(into(libRoot)))
      .map(([alias]) => alias)
      .sort((a, b) => a.length - b.length)[0];
  },

  isLinkRange: () => false,

  unlink(tree: Tree, library: LinkedLibrary): void {
    const file = rootTsconfig(tree);
    if (!file) return;
    updateJson(tree, file, (json) => {
      const table: Record<string, string[]> = json.compilerOptions?.paths ?? {};
      for (const [alias, targets] of Object.entries(table)) {
        const ownAlias = alias === library.importPath || alias.startsWith(`${library.importPath}/`);
        if (ownAlias && (targets ?? []).some(into(library.libRoot))) delete table[alias];
      }
      return json;
    });
  },
};
