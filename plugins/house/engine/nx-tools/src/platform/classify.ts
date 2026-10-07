// THE PLATFORM CLASSIFIER — infer, from evidence, which platform an untagged project belongs to.
//
// Used where a workspace gains the firewall over projects nobody classified (firebase-emulators' first insertion,
// migration 0.50.0) and by the `platform` generator when it is not told. It never guesses: a project is classified
// only from what it demonstrably is, and every inference says why.
//
// THE EVIDENCE, joined on the platform lattice (./platform — shared is the bottom, web + server is a conflict):
//   1. the STACK that builds it (Angular → web; plain TS says nothing — it runs anywhere);
//   2. its own IMPORTS of a package bound to one platform (./externals — the same table the firewall bans from);
//   3. the platforms of the WORKSPACE PROJECTS it imports — a library built on a server library is server code,
//      whatever it imports itself. Solved as a fixed point, because (3) feeds on the answers for its dependencies.
// No evidence at all → `shared`: nothing in it ties it to a platform, which is exactly what shared means — and the
// firewall then holds it to that (a shared project importing firebase-admin fails lint, saying so).
//
// It also answers the question an upgrade owes the developer: which EXISTING dependencies will the tightened
// firewall now fail on (`violations`) — the leaks it was blind to.
import { type Tree, getProjects, joinPathFragments, readJson } from '@nx/devkit';
import { adapterOf } from '../adapters/registry';
import { rootTsconfig } from '../generators/_utils/linking';
import { type Platform, join, platformOf, reachable } from './platform';
import { type PlatformExternals, matchesExternal } from './externals';

export interface Classification {
  project: string;
  /** The platform; `null` when the evidence mixes web and server. */
  platform: Platform | null;
  /** It already carried a `platform:` tag (taken as the truth, never re-inferred). */
  declared: boolean;
  /** Why — one human-readable reason per piece of evidence (empty for a declared or evidence-free project). */
  evidence: string[];
  /** Workspace projects its sources import. */
  dependsOn: string[];
}

export interface Violation {
  project: string;
  platform: Platform;
  dependency: string;
  dependencyPlatform: Platform;
}

/** Directories that never hold a project's own source (same spirit as `_utils/app-roots`). */
const NEVER_SOURCE = new Set(['node_modules', 'dist', 'build', 'coverage', 'out-tsc', 'tmp', 'temp']);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
/** `from '…'`, `import '…'`, `import('…')`, `require('…')`, `export … from '…'`. */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g;

export function classifyWorkspace(tree: Tree, externals: PlatformExternals): Map<string, Classification> {
  const projects = getProjects(tree);
  const roots = [...projects.values()].map((project) => normalizeRoot(project.root));
  const owners = importOwners(tree, projects);
  const result = new Map<string, Classification>();
  const own = new Map<string, Platform | null>();

  for (const [name, project] of projects) {
    const declared = platformOf(project.tags);
    const evidence: string[] = [];
    let platform: Platform | null = 'shared';
    const dependsOn = new Set<string>();
    if (!declared) {
      const stack = adapterOf(tree, name);
      if (stack && stack.platform !== 'shared') {
        platform = join(platform, stack.platform);
        evidence.push(`built by the ${stack.id} stack (${stack.platform})`);
      }
    }
    for (const { file, specifier } of importsOf(tree, normalizeRoot(project.root), roots)) {
      const owner = ownerOf(owners, specifier);
      if (owner && owner !== name) {
        dependsOn.add(owner);
        continue;
      }
      if (declared || specifier.startsWith('.') || specifier.startsWith('/')) continue;
      for (const side of ['web', 'server'] as const) {
        if (externals[side].some((pattern) => matchesExternal(pattern, specifier))) {
          platform = join(platform, side);
          const reason = `imports ${specifier} (${side}-only, ${file})`;
          if (!evidence.some((seen) => seen.startsWith(`imports ${specifier} `))) evidence.push(reason);
        }
      }
    }
    own.set(name, declared ?? platform);
    result.set(name, { project: name, platform: declared ?? platform, declared: Boolean(declared), evidence, dependsOn: [...dependsOn].sort() });
  }

  // (3) The fixed point: an undeclared project is joined with what it imports. Monotone on a finite lattice, so it
  // settles within (number of projects) rounds; the bound is only a guard.
  for (let round = 0, changed = true; changed && round <= projects.size; round++) {
    changed = false;
    for (const entry of result.values()) {
      if (entry.declared) continue;
      // `null` (mixed) is a value here, not an absence — `??` would launder it into `shared`.
      const known = own.get(entry.project);
      let platform: Platform | null = known === undefined ? 'shared' : known;
      for (const dependency of entry.dependsOn) platform = join(platform, result.get(dependency)?.platform ?? 'shared');
      if (platform !== entry.platform) {
        entry.platform = platform;
        changed = true;
      }
    }
  }
  for (const entry of result.values()) {
    if (entry.declared) continue;
    for (const dependency of entry.dependsOn) {
      const platform = result.get(dependency)?.platform;
      if (platform === null) entry.evidence.push(`imports ${dependency}, which itself mixes web and server`);
      else if (platform && platform !== 'shared') entry.evidence.push(`imports ${dependency} (${platform})`);
    }
  }
  return result;
}

/** Every dependency between two classified projects that the firewall forbids. */
export function violations(classified: Map<string, Classification>): Violation[] {
  const found: Violation[] = [];
  for (const entry of classified.values()) {
    if (!entry.platform) continue;
    for (const dependency of entry.dependsOn) {
      const target = classified.get(dependency)?.platform;
      if (target && !reachable(entry.platform).includes(target)) {
        found.push({ project: entry.project, platform: entry.platform, dependency, dependencyPlatform: target });
      }
    }
  }
  return found;
}

const normalizeRoot = (root: string): string => root.replace(/^\.\/?/, '').replace(/\/+$/, '') || '.';

/** Every import specifier in the project's own source — never descending into another project's root. */
function* importsOf(tree: Tree, root: string, roots: readonly string[]): Generator<{ file: string; specifier: string }> {
  const others = new Set(roots.filter((other) => other !== root));
  const walk = function* (dir: string): Generator<{ file: string; specifier: string }> {
    for (const child of tree.children(dir)) {
      if (child.startsWith('.') || NEVER_SOURCE.has(child)) continue;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (tree.isFile(path)) {
        if (!SOURCE_FILE.test(child)) continue;
        const text = tree.read(path, 'utf8') ?? '';
        for (const match of text.matchAll(IMPORT)) yield { file: path, specifier: match[1] };
        continue;
      }
      if (others.has(path) || tree.exists(`${path}/.git`)) continue;
      yield* walk(path);
    }
  };
  yield* walk(root);
}

/**
 * What import specifier reaches which project: the root tsconfig's path aliases (by the project that owns the
 * alias's target) and each project's package name (TS-solution workspaces link by package name).
 */
function importOwners(tree: Tree, projects: Map<string, { root: string }>): Array<{ prefix: string; wildcard: boolean; project: string }> {
  const byRoot = [...projects].map(([name, project]) => ({ name, root: normalizeRoot(project.root) }));
  const ownerOfPath = (path: string): string | undefined => {
    const normalized = normalizeRoot(path);
    return byRoot
      .filter(({ root }) => root === '.' || normalized === root || normalized.startsWith(`${root}/`))
      .sort((a, b) => b.root.length - a.root.length)[0]?.name;
  };
  const owners: Array<{ prefix: string; wildcard: boolean; project: string }> = [];
  const tsconfig = rootTsconfig(tree);
  const paths = (tsconfig && readJson<{ compilerOptions?: { paths?: Record<string, string[]> } }>(tree, tsconfig).compilerOptions?.paths) || {};
  for (const [alias, targets] of Object.entries(paths)) {
    const project = targets?.[0] && ownerOfPath(targets[0].replace(/\*.*$/, ''));
    if (project) owners.push({ prefix: alias.replace(/\/?\*$/, ''), wildcard: alias.endsWith('*'), project });
  }
  for (const { name, root } of byRoot) {
    const manifest = joinPathFragments(root, 'package.json');
    if (root === '.' || !tree.exists(manifest)) continue;
    const pkg = readJson<{ name?: string }>(tree, manifest).name;
    if (pkg) owners.push({ prefix: pkg, wildcard: true, project: name });
  }
  return owners.sort((a, b) => b.prefix.length - a.prefix.length);
}

function ownerOf(owners: ReturnType<typeof importOwners>, specifier: string): string | undefined {
  return owners.find(({ prefix, wildcard }) => specifier === prefix || (wildcard && specifier.startsWith(`${prefix}/`)))?.project;
}
