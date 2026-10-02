// The root-tsconfig questions (and the one root-tsconfig write) every linking strategy and generator needs — answered once.
import { type Tree, readJson, updateJson } from '@nx/devkit';
import { workspacePath } from './shared';

/**
 * The root tsconfig that holds the workspace's COMPILER OPTIONS (`paths`, `customConditions`, …):
 * `tsconfig.base.json` where it exists (Nx's integrated and TS-solution workspaces both keep shared options
 * there — in a TS-solution workspace `tsconfig.json` is the solution file, references only), else
 * `tsconfig.json` (a standalone / `nx init` workspace). Undefined when there is neither.
 *
 * THE one copy of a pick four generators used to each make with their own `['tsconfig.base.json',
 * 'tsconfig.json'].find(...)`.
 */
export function rootTsconfig(tree: Tree): string | undefined {
  return ['tsconfig.base.json', 'tsconfig.json'].find((file) => tree.exists(file));
}

/** The root tsconfig's compiler options (empty when there is none). */
export function rootCompilerOptions(tree: Tree): Record<string, any> {
  const file = rootTsconfig(tree);
  return (file && readJson<{ compilerOptions?: Record<string, any> }>(tree, file).compilerOptions) || {};
}

/**
 * The export condition under which this workspace's packages expose their SOURCE to TypeScript — or undefined
 * when the workspace defines none. It must be one the root tsconfig actually resolves with
 * (`compilerOptions.customConditions`), and among several the same preference Nx's own generators apply
 * (`getCustomConditionName` in @nx/js): its `@nx-source/…` convention, then the legacy `development`, then the
 * first one declared.
 */
export function sourceCondition(tree: Tree): string | undefined {
  const declared: string[] = rootCompilerOptions(tree).customConditions ?? [];
  return declared.find((c) => c.startsWith('@nx-source/')) ?? declared.find((c) => c === 'development') ?? declared[0];
}

/** The TS-solution file: the root tsconfig.json that only `references` the workspace's projects. */
export const SOLUTION_TSCONFIG = 'tsconfig.json';

/**
 * Make the solution file reference the project at `root` (deduplicated, in Nx's `./<root>` form) — what
 * `@nx/js:typescript-sync` would add, written up front so `nx sync --check` in CI agrees with a fresh generator
 * run. A no-op without a solution file.
 */
export function referenceFromSolution(tree: Tree, root: string): void {
  if (!tree.exists(SOLUTION_TSCONFIG)) return;
  updateJson(tree, SOLUTION_TSCONFIG, (json) => {
    json.references ??= [];
    const present = json.references.some((r: { path?: string }) => typeof r?.path === 'string' && workspacePath(r.path) === workspacePath(root));
    if (!present) json.references.push({ path: `./${workspacePath(root)}` });
    return json;
  });
}
