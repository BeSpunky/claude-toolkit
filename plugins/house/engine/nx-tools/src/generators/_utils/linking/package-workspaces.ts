// THE PACKAGE MANAGER'S WORKSPACES — which directories are members, and how a workspace package is depended on.
//
// Where membership is declared depends on the package manager, and Nx reads it the same way: pnpm keeps it in
// `pnpm-workspace.yaml` → `packages` (and ignores package.json `workspaces` entirely); npm, yarn and bun keep it
// in package.json `workspaces` (an array, or yarn classic's `{ packages: [...] }`). Membership matters twice:
// the package manager links only members into node_modules, and Nx's devkit discovers a package.json-defined
// project only when a workspaces glob covers it — a library outside every glob is invisible to `getProjects`.
//
// Two parsers are BORROWED rather than added: `@zkochan/js-yaml` and `minimatch` are what Nx itself parses
// pnpm-workspace.yaml and matches workspace globs with, and both are dependencies of `@nx/devkit` — our one
// required peer. They are resolved from devkit's own location (so pnpm's strict layout, where a peer's
// dependencies are not ours to `require`, still finds them), which keeps this payload's dependency list at
// two and guarantees we read these files exactly as Nx does.
import { type Tree, readJson, logger } from '@nx/devkit';
import { updateManifest } from '../dependencies';
import { dirname } from 'node:path';
import { detectPackageManager } from '../package-manager';
import { workspacePath } from './shared';

const PNPM_WORKSPACE = 'pnpm-workspace.yaml';

interface JsYaml {
  load(content: string): unknown;
  dump(value: unknown, options?: Record<string, unknown>): string;
}
type Minimatch = (path: string, pattern: string, options?: Record<string, unknown>) => boolean;

/** A module `@nx/devkit` depends on, resolved from devkit's own install location (see the header). */
function fromDevkit<T>(id: string): T {
  const devkit = dirname(require.resolve('@nx/devkit/package.json'));
  return require(require.resolve(id, { paths: [devkit] })) as T;
}
const yaml = (): JsYaml => fromDevkit<JsYaml>('@zkochan/js-yaml');
const minimatch = (): Minimatch => fromDevkit<{ minimatch: Minimatch }>('minimatch').minimatch;

/**
 * The workspaces globs this workspace declares — or undefined when package-manager workspaces are OFF
 * (no root package.json, a pnpm repo without `packages`, a package.json without `workspaces`). An empty array
 * is ON with no members yet. Mirrors Nx's `isWorkspacesEnabled` + `getPackageManagerWorkspacesPatterns`.
 */
export function workspacePatterns(tree: Tree): string[] | undefined {
  const pm = detectPackageManager(tree);
  if (!pm) return undefined;
  if (pm === 'pnpm') {
    if (!tree.exists(PNPM_WORKSPACE)) return undefined;
    try {
      const packages = (yaml().load(tree.read(PNPM_WORKSPACE, 'utf-8') ?? '') as { packages?: unknown } | null)?.packages;
      return packages === undefined ? undefined : asPatterns(packages);
    } catch {
      return undefined; // An unparseable file declares nothing Nx could read either.
    }
  }
  const workspaces = readJson<{ workspaces?: unknown }>(tree, 'package.json').workspaces;
  if (!workspaces) return undefined;
  return asPatterns(Array.isArray(workspaces) ? workspaces : (workspaces as { packages?: unknown }).packages);
}

function asPatterns(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [];
}

/** Is the project at `root` a workspace member? (A `!negated` glob excludes, as in every package manager.) */
export function isWorkspaceMember(tree: Tree, root: string, patterns = workspacePatterns(tree) ?? []): boolean {
  const match = minimatch();
  const manifest = `${root}/package.json`;
  const covers = (pattern: string) => match(manifest, `${pattern.replace(/\/+$/, '')}/package.json`, { dot: true });
  const included = patterns.filter((p) => !p.startsWith('!')).some(covers);
  return included && !patterns.filter((p) => p.startsWith('!')).some((p) => covers(p.slice(1)));
}

/**
 * Make the project at `root` a workspace member, with the NARROWEST honest glob — Nx's own rule
 * (`addProjectToTsSolutionWorkspace`): `<parent>/*` when that would admit no project other than this one,
 * else the directory itself. Returns the glob it added, or null when `root` was already a member.
 */
export function ensureWorkspaceMember(tree: Tree, root: string): string | null {
  const patterns = workspacePatterns(tree) ?? [];
  if (isWorkspaceMember(tree, root, patterns)) return null;

  const parent = dirname(root);
  const strangers =
    parent === '.'
      ? ['(the workspace root)']
      : tree
          .children(parent)
          .map((child) => `${parent}/${child}`)
          .filter((dir) => dir !== root && tree.exists(`${dir}/package.json`) && !isWorkspaceMember(tree, dir, patterns));
  const pattern = strangers.length === 0 ? `${parent}/*` : root;

  if (detectPackageManager(tree) === 'pnpm') {
    // Rewritten through the same YAML dumper Nx's generators use on this file, so the two never fight over its shape.
    const parsed = ((tree.exists(PNPM_WORKSPACE) && yaml().load(tree.read(PNPM_WORKSPACE, 'utf-8') ?? '')) || {}) as { packages?: string[] };
    parsed.packages = [...asPatterns(parsed.packages), pattern];
    tree.write(PNPM_WORKSPACE, yaml().dump(parsed, { indent: 2, quotingType: '"', forceQuotes: true }));
  } else {
    updateManifest(tree, 'package.json', 'linking', (json) => {
      if (json.workspaces && !Array.isArray(json.workspaces)) json.workspaces.packages = [...asPatterns(json.workspaces.packages), pattern];
      else json.workspaces = [...asPatterns(json.workspaces), pattern];
      return json;
    });
  }
  logger.info(`[linking] Added "${pattern}" to the package manager's workspaces, so \`${root}\` is a member.`);
  return pattern;
}

/** Remove a glob that names exactly `root` (one `ensureWorkspaceMember` may have added). Wider globs stay — they cover others. */
export function dropExactWorkspacePattern(tree: Tree, root: string): void {
  const exact = (p: unknown) => typeof p === 'string' && workspacePath(p) === workspacePath(root);
  if (detectPackageManager(tree) === 'pnpm') {
    if (!tree.exists(PNPM_WORKSPACE)) return;
    const parsed = (yaml().load(tree.read(PNPM_WORKSPACE, 'utf-8') ?? '') ?? {}) as { packages?: unknown[] };
    if (!parsed.packages?.some(exact)) return;
    parsed.packages = parsed.packages.filter((p) => !exact(p));
    tree.write(PNPM_WORKSPACE, yaml().dump(parsed, { indent: 2, quotingType: '"', forceQuotes: true }));
  } else if (tree.exists('package.json')) {
    updateManifest(tree, 'package.json', 'linking', (json) => {
      if (Array.isArray(json.workspaces)) json.workspaces = json.workspaces.filter((p: unknown) => !exact(p));
      else if (Array.isArray(json.workspaces?.packages)) json.workspaces.packages = json.workspaces.packages.filter((p: unknown) => !exact(p));
      return json;
    });
  }
}

/**
 * The version range a consumer declares to depend on a WORKSPACE package. pnpm and yarn berry have a protocol
 * that can only ever mean the local package (`workspace:*`) and REQUIRE it to link one; npm and yarn classic do
 * not understand it at all, and link a member that satisfies a plain range (`*`).
 */
export function workspaceDependencySpec(tree: Tree): 'workspace:*' | '*' {
  const pm = detectPackageManager(tree);
  return pm === 'pnpm' || (pm === 'yarn' && isYarnBerry(tree)) ? 'workspace:*' : '*';
}

/**
 * Is `range` the one this workspace's package manager LINKS a member by — what `workspaceDependencySpec` writes?
 * Any `workspace:` protocol range qualifies (it can only ever mean a local package); a plain `*` only where that
 * is the spec (npm, yarn classic), since under pnpm or yarn berry a `*` asks the registry.
 */
export function isWorkspaceLinkRange(tree: Tree, range: string): boolean {
  return range.startsWith('workspace:') || range === workspaceDependencySpec(tree);
}

/**
 * Yarn 2+ ("berry") vs yarn 1 ("classic"), from the repo's own evidence — never by spawning `yarn --version`,
 * which answers for whatever yarn is on this machine's PATH, not for the repo: a declared `packageManager:
 * yarn@<major>`, else berry's own config file (`.yarnrc.yml`), else a berry lockfile (it opens with
 * `__metadata:`). None of them → classic, the yarn that predates all three.
 */
function isYarnBerry(tree: Tree): boolean {
  const declared = /"packageManager"\s*:\s*"yarn@(\d+)/.exec(tree.read('package.json', 'utf-8') ?? '')?.[1];
  if (declared) return Number(declared) >= 2;
  if (tree.exists('.yarnrc.yml')) return true;
  return /^__metadata:/m.test(tree.read('yarn.lock', 'utf-8') ?? '');
}
