// HOW THIS WORKSPACE LINKS ITS PROJECTS — detected, never assumed; then one strategy behind one port.
//
// `detectLinking` is our own copy of Nx's `isUsingTsSolutionSetup` (@nx/js `ts-solution-setup`): it is exported
// only from `@nx/js/internal`, which is no contract, and @nx/js is an optional peer of this payload anyway. The
// rule, verbatim in substance — a workspace is TS-solution ("workspaces") when ALL hold:
//
//   - package-manager workspaces are ON (pnpm: `pnpm-workspace.yaml` declares `packages`; others: root
//     package.json declares `workspaces`);
//   - `tsconfig.base.json` and `tsconfig.json` both exist;
//   - `tsconfig.json` extends `./tsconfig.base.json` and includes nothing (`files`/`include` present and empty —
//     it is a solution file, references only);
//   - `tsconfig.base.json` has `composite` on (and `declaration` not explicitly off).
//
// Everything else — including a repo with workspaces but a classic tsconfig — links by `paths`, which is what
// Nx's own generators would do there too. One deliberate divergence: the package manager is the house's
// tree-based detection (`../package-manager`), not devkit's, which reads lockfiles from disk and so cannot see
// a workspace being built in the generator's Tree.
import { type Tree, readJson } from '@nx/devkit';
import type { Linking, LinkingKind } from './linking';
import { pathsLinking } from './paths';
import { workspacesLinking } from './workspaces';
import { workspacePatterns } from './package-workspaces';

export type { Linking, LinkingKind, LinkRequest, LinkedLibrary } from './linking';
export { rootTsconfig, sourceCondition, referenceFromSolution } from './tsconfig-roots';
export { ensureWorkspaceMember, isWorkspaceMember, workspaceDependencySpec } from './package-workspaces';

const STRATEGIES: Readonly<Record<LinkingKind, Linking>> = { paths: pathsLinking, workspaces: workspacesLinking };

/** How this workspace links its projects (see the header for the rule). */
export function detectLinking(tree: Tree): LinkingKind {
  return workspacePatterns(tree) !== undefined && isTsSolutionConfig(tree) ? 'workspaces' : 'paths';
}

/** The linking strategy this workspace wears. */
export function workspaceLinking(tree: Tree): Linking {
  return STRATEGIES[detectLinking(tree)];
}

function isTsSolutionConfig(tree: Tree): boolean {
  if (!tree.exists('tsconfig.base.json') || !tree.exists('tsconfig.json')) return false;
  try {
    const solution = readJson<{ extends?: unknown; files?: unknown[]; include?: unknown[] }>(tree, 'tsconfig.json');
    if (solution.extends !== './tsconfig.base.json') return false;
    if ((!solution.files && !solution.include) || (solution.files?.length ?? 0) > 0 || (solution.include?.length ?? 0) > 0) return false;
    const base = readJson<{ compilerOptions?: { composite?: boolean; declaration?: boolean } }>(tree, 'tsconfig.base.json').compilerOptions;
    return Boolean(base?.composite) && base?.declaration !== false;
  } catch {
    return false; // A tsconfig that does not parse is no solution setup Nx would recognise either.
  }
}
