// THE `workspaces` STRATEGY — the TS-solution model: a library is a PACKAGE, linked the way any package is.
//
// Four facts make an import of `@acme/ui` resolve to its source, and `link` owns all four (Nx's
// `@nx/js:library` writes the first three for a library it creates; `@nx/js:typescript-sync` keeps references
// current once projects depend on each other — but nobody else writes the consumer's dependency):
//
//   1. MEMBERSHIP   the library's directory is covered by a workspaces glob — the package manager links it into
//                   node_modules, and Nx's devkit can see it at all;
//   2. IDENTITY     its package.json `name` IS the import path, and its `exports` map the specifier to its source
//                   under the workspace's custom condition (`customConditions` in tsconfig.base.json), so
//                   TypeScript reads the .ts, never a dist that has not been built;
//   3. REFERENCE    the root tsconfig.json (the solution file) references it, so `tsc -b` builds it;
//   4. DEPENDENCY   the consumer DECLARES it (`workspace:*` / `*`) — pnpm links nothing undeclared, and npm or
//                   yarn only by the accident of hoisting.
import { type Tree, getProjects, readJson, updateJson, writeJson, logger } from '@nx/devkit';
import { updateJsonInPlace } from '../json-edits';
import { dirname, posix } from 'node:path';
import type { Linking, LinkRequest, LinkedLibrary } from './linking';
import { sourceCondition, referenceFromSolution, SOLUTION_TSCONFIG } from './tsconfig-roots';
import { defaultEntry, workspacePath } from './shared';
import { ensureWorkspaceMember, dropExactWorkspacePattern, workspaceDependencySpec, isWorkspaceLinkRange } from './package-workspaces';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

export const workspacesLinking: Linking = {
  kind: 'workspaces',

  link(tree: Tree, request: LinkRequest): void {
    ensureWorkspaceMember(tree, request.libRoot);
    declareIdentity(tree, request);
    referenceFromSolution(tree, request.libRoot);
    if (request.consumerRoot) declareDependency(tree, request.consumerRoot, request);
  },

  resolve(tree, importPath) {
    try {
      return [...getProjects(tree).values()].find((project) => packageName(tree, project.root) === importPath)?.root;
    } catch {
      return undefined;
    }
  },

  importPathOf(tree, libRoot) {
    return packageName(tree, libRoot);
  },

  isLinkRange: isWorkspaceLinkRange,

  unlink(tree: Tree, library: LinkedLibrary): void {
    dropExactWorkspacePattern(tree, library.libRoot);
    if (tree.exists(SOLUTION_TSCONFIG)) {
      updateJson(tree, SOLUTION_TSCONFIG, (json) => {
        if (Array.isArray(json.references)) json.references = json.references.filter((r: { path?: string }) => !r?.path || workspacePath(r.path) !== workspacePath(library.libRoot));
        return json;
      });
    }
    // Remove EXACTLY the dependency `link` declared — the range this package manager's workspaces link a member
    // by (`isWorkspaceLinkRange`): it can only have meant the local package, which is going away, and left behind it
    // would silently re-point at whatever the registry holds under that name. Any other range was declared by
    // someone else, for the registry (adopt-extracted writes the published one) — it stays, and is reported.
    try {
      // Every project's manifest AND the root's — the root package.json is not a project, but it is where a
      // project.json-only consumer's dependency was declared (see `governingManifest`).
      const roots = new Set(['.', ...[...getProjects(tree).values()].map((project) => project.root)]);
      for (const root of roots) {
        const manifest = root === '.' ? 'package.json' : `${root}/package.json`;
        if (root === library.libRoot || !tree.exists(manifest)) continue;
        updateJsonInPlace(tree, manifest, (json) => {
          for (const field of DEPENDENCY_FIELDS) {
            const range = json[field]?.[library.importPath];
            if (typeof range !== 'string') continue;
            if (isWorkspaceLinkRange(tree, range)) delete json[field][library.importPath];
            else logger.info(`[linking] Kept ${manifest} ${field} "${library.importPath}": "${range}" — it now resolves from the registry.`);
          }
          return json;
        });
      }
    } catch {
      logger.warn(`[linking] Could not read the workspace's projects to remove dependencies on "${library.importPath}" — check for leftover \`workspace:\` ranges by hand.`);
    }
  },
};

/** (2) The library's package.json names it `importPath` and exports the specifier's source entry. */
function declareIdentity(tree: Tree, request: LinkRequest): void {
  const manifest = `${request.libRoot}/package.json`;
  if (!tree.exists(manifest)) writeJson(tree, manifest, { name: request.importPath, version: '0.0.1' });
  const name = readJson<{ name?: string }>(tree, manifest).name;
  if (name && name !== request.importPath) {
    // Under this strategy the package name IS the import path; renaming a package is a public-contract change
    // that is not this helper's to make behind the caller's back.
    throw new Error(
      `Cannot link "${request.importPath}" to ${request.libRoot}: its package.json is named "${name}", and in a ` +
        `workspaces-linked repo the package name is the import path. Use "${name}", or rename the package first.`,
    );
  }

  const key = request.subpath ? `./${request.subpath}` : '.';
  const source = `./${posix.relative(request.libRoot, request.entry ?? defaultEntry(request))}`;
  const condition = sourceCondition(tree);
  updateJsonInPlace(tree, manifest, (json) => {
    json.name ??= request.importPath;
    const exportsMap: Record<string, unknown> =
      json.exports && typeof json.exports === 'object' && !Array.isArray(json.exports) ? json.exports : {};
    const current = exportsMap[key];
    if (current === undefined) {
      // A fresh entry: the source under the custom condition, and as the fallback too — such a library is
      // consumed as source until (and unless) it is given a build that rewrites these.
      exportsMap[key] = { ...(condition ? { [condition]: source } : {}), types: source, default: source };
    } else if (condition && current && typeof current === 'object' && !(condition in current)) {
      // An entry the library's generator already wrote (pointing at dist): ADD the source condition, FIRST —
      // conditions are matched in key order, so a later one would never be reached.
      exportsMap[key] = { [condition]: source, ...(current as Record<string, unknown>) };
    } else if (condition && typeof current === 'string') {
      exportsMap[key] = { [condition]: source, default: current };
    }
    json.exports = exportsMap;
    return json;
  });
}

/** (4) The package.json that governs the consumer's resolution declares the library. */
function declareDependency(tree: Tree, consumerRoot: string, request: LinkRequest): void {
  const manifest = governingManifest(tree, consumerRoot);
  if (!manifest) {
    logger.warn(`[linking] No package.json governs \`${consumerRoot}\`, so its dependency on "${request.importPath}" could not be declared.`);
    return;
  }
  if (manifest === `${request.libRoot}/package.json`) return; // A library does not depend on itself.
  updateJsonInPlace(tree, manifest, (json) => {
    if (!DEPENDENCY_FIELDS.some((field) => json[field]?.[request.importPath] !== undefined)) {
      json.dependencies = { ...json.dependencies, [request.importPath]: workspaceDependencySpec(tree) };
    }
    return json;
  });
}

/**
 * The nearest package.json at or above `root` — the one whose node_modules the consumer resolves through. A
 * project.json-only consumer (an Angular app hosted in a TS-solution workspace) has none of its own, and its
 * imports resolve through the root's.
 */
function governingManifest(tree: Tree, root: string): string | undefined {
  for (let dir = root.replace(/\/+$/, '') || '.'; ; dir = dirname(dir)) {
    const manifest = dir === '.' ? 'package.json' : `${dir}/package.json`;
    if (tree.exists(manifest)) return manifest;
    if (dir === '.') return undefined;
  }
}

function packageName(tree: Tree, root: string): string | undefined {
  const manifest = root === '.' ? 'package.json' : `${root}/package.json`;
  if (!tree.exists(manifest)) return undefined;
  const name = readJson<{ name?: unknown }>(tree, manifest).name;
  return typeof name === 'string' ? name : undefined;
}

