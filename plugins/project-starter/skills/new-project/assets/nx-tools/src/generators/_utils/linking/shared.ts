// Small facts both linking strategies need, kept in one place so they cannot disagree.
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
