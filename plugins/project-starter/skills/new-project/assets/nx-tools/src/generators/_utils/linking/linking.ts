// THE LINKING PORT — how one project in this workspace reaches another's code.
//
// Two strategies exist in the Nx world, and a workspace wears exactly one (`detectLinking`):
//
//   paths       the integrated model: projects defined by project.json, linked by `compilerOptions.paths`
//               aliases in the root tsconfig. One global table; every project sees every alias.
//   workspaces  the TS-solution model: projects defined by package.json, members of the package manager's
//               workspaces, linked like any other package — a consumer DEPENDS on the library (`workspace:*` /
//               `*`), node_modules carries the symlink, the library's `exports` (under the workspace's custom
//               condition) points TypeScript at its source, and the root tsconfig.json `references` it.
//
// Before this port the house knew only the first, and said so in five policy comments; every generator that
// linked a library wrote a `paths` entry by hand, and four of them each picked "the root tsconfig" their own way.
// Now a generator states WHAT it needs ("link this library", "which library is this import?") and the
// workspace's strategy decides how.
//
// Keep it as small as its callers: every method below has one. (`retarget` was considered and left out — no
// generator moves a linked library's entry; when one does, the method arrives with its caller.)
import type { Tree } from '@nx/devkit';

export type LinkingKind = 'paths' | 'workspaces';

/** A library to make importable — and, optionally, the project that will import it. */
export interface LinkRequest {
  /** The specifier consumers import (`@acme/ui`). Under `workspaces` it is also the library's package name. */
  importPath: string;
  /** The library's project root, workspace-relative (`packages/ui`). */
  libRoot: string;
  /**
   * The SOURCE entry the specifier resolves to, workspace-relative. Defaults to `<libRoot>/src/index.ts`, or
   * `<libRoot>/<subpath>/src/index.ts` for a subpath.
   */
  entry?: string;
  /**
   * A secondary entry point: link `<importPath>/<subpath>` rather than the package itself
   * (`paths`: its own alias; `workspaces`: `exports["./<subpath>"]`).
   */
  subpath?: string;
  /**
   * The project that will import the library, workspace-relative. `paths` needs no per-consumer wiring (its
   * alias table is global); `workspaces` declares the dependency in the package.json that governs the consumer's
   * resolution — without it, pnpm never links the package and npm/yarn only by accident of hoisting.
   */
  consumerRoot?: string;
}

/** A linked library, identified both ways. */
export interface LinkedLibrary {
  importPath: string;
  libRoot: string;
}

export interface Linking {
  readonly kind: LinkingKind;
  /** Make `importPath` (or its subpath) resolve to the library's source. Idempotent. */
  link(tree: Tree, request: LinkRequest): void;
  /** The project root `importPath` resolves to in this workspace — or undefined when it is not linked here. */
  resolve(tree: Tree, importPath: string): string | undefined;
  /** The specifier this workspace imports the library at `libRoot` by — the reverse of `resolve`. */
  importPathOf(tree: Tree, libRoot: string): string | undefined;
  /**
   * Is `range` a dependency declaration THIS strategy writes to reach a local package (so `unlink` will remove it)?
   * `paths` declares no dependencies, so never; `workspaces` — the package manager's workspace range.
   */
  isLinkRange(tree: Tree, range: string): boolean;
  /** Remove every in-repo link to the library (its subpaths included) — for a library about to be deleted. */
  unlink(tree: Tree, library: LinkedLibrary): void;
}
