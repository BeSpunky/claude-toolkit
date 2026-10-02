// Small facts both linking strategies need, kept in one place so they cannot disagree.
import { posix } from 'node:path';
import type { ProjectConfiguration } from '@nx/devkit';
import type { LinkRequest } from './linking';

/** The specifier a request links: the package, or its subpath. */
export const specifierOf = (request: LinkRequest): string =>
  request.subpath ? `${request.importPath}/${request.subpath}` : request.importPath;

/** The house's source entry for a request that names none: `<libRoot>[/<subpath>]/src/index.ts`. */
export const defaultEntry = (request: LinkRequest): string =>
  [request.libRoot, request.subpath, 'src', 'index.ts'].filter(Boolean).join('/');

/** The project whose root contains `path` — the deepest one, since project roots nest. */
export function rootContaining(projects: Map<string, ProjectConfiguration>, path: string): string | undefined {
  return [...projects.values()]
    .map((project) => project.root)
    .filter((root) => root === '.' || path === root || path.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * A workspace-relative path in one canonical spelling. tsconfig path targets are written both ways in the wild —
 * `./packages/ui/src/index.ts` (what @nx/js and @nx/angular write) and `packages/ui/src/index.ts` (what the house
 * writes) — and both name the same file, so every comparison goes through this.
 */
export const workspacePath = (path: string): string => posix.normalize(path.replace(/\\/g, '/')).replace(/^(\.\/)+/, '').replace(/\/+$/, '');
