// THE PLATFORM CLASSIFIER — infer, from evidence, which platform an untagged project belongs to.
//
// Used where a workspace gains the firewall over projects nobody classified (firebase-emulators' first insertion,
// migration 0.50.0), by the `platform` generator when it is not told, and by `platform-sync` for projects created
// later. It never guesses: a project is classified only from what it demonstrably is, and every inference says why.
//
// IT READS WHAT THE FIREWALL READS. Imports come from ./imports — the same five AST forms Nx's rule visits, never a
// pattern over the text (a comment or a string that mentions a package is no import). Files are judged through
// ./scopes — tests and tool configs never ship, so they are no evidence (lint does not judge them either). Packages
// are judged through ./externals — the table the firewall bans from, plus whatever the project's own config bans.
//
// WHICH PROJECTS. Only CODE. A project tagged `tooling` (the house's shared browser, worktree domains, emulator
// suite) says it is not. Otherwise it is code when something imports it, or when it has code that ships (a shipping
// source file) and is code by role (an application or library — `projectRole`), by stack (a stack builds it), by
// target (build / test / serve / lint) or by what its own files import (a platform-bound package, another
// project) — not for the ROOT, whose "own" files are whatever no other project claims (root-level tooling). What is
// none of these — scripts nothing imports, an e2e project whose every file is a test, the workspace ROOT as the
// shell create-nx-workspace leaves — has no code a product runs, and a platform tag on it would state a fact about
// code that does not exist. It is left untagged and unmentioned (`basis: 'tooling'`).
//
// THE EVIDENCE, joined on the platform lattice (./platform — shared is the bottom, web + server is a conflict):
//   1. the STACK that builds it (Angular → web; plain TS says nothing — it runs anywhere);
//   2. its own IMPORTS of a package bound to one platform, or of a Node built-in (server — see ./externals);
//   3. the platforms of the WORKSPACE PROJECTS it imports — a library built on a server library is server code,
//      whatever it imports itself. Solved as a fixed point, because (3) feeds on the answers for its dependencies.
//
// AN APPLICATION TAKES ITS STACK'S PLATFORM when the stack is bound to one (an Angular app is web, whatever it
// imports): what builds it decides where it runs. Imports that contradict it are reported as what lint will flag
// (`conflicts`) — except in an SSR app's server half, which the firewall scopes as server code (./scopes).
//
// NO EVIDENCE IS NOT `shared`. A project whose evidence binds it to no platform is `undefined` — REPORTED, never
// tagged: "nothing here imports a platform-bound package" is the absence of evidence, and the table cannot list
// every package that is (a database driver, a CLI helper). `shared` is a claim a human makes. Only a STACK that is
// itself platform-neutral (the js stack's own libraries) is born shared — by the house, at creation, as stated.
//
// It also answers the question an upgrade owes the developer: which EXISTING dependencies the firewall will fail
// on (`violations`) — the leaks it was blind to, and the imports of projects that still have no platform.
import { type ProjectConfiguration, type Tree, getProjects, joinPathFragments, readJson } from '@nx/devkit';
import { adapterOf, projectRole } from '../adapters/registry';
import { rootTsconfig } from '../generators/_utils/linking';
import { type Platform, join, platformOf, reachable } from './platform';
import { type PlatformExternals, isNodeBuiltin, matchesExternal } from './externals';
import { importSpecifiers, isSourceFile } from './imports';
import { scopeOf } from './scopes';

export interface Classification {
  project: string;
  /**
   * The platform: `null` when the evidence mixes web and server; `undefined` when nothing binds it to one (or its
   * imports could not be read) — both reported, neither tagged.
   */
  platform: Platform | null | undefined;
  /** What decided it: a tag it already carried, its stack (an application), the evidence, or nothing at all. */
  basis: 'declared' | 'stack' | 'evidence' | 'none' | 'tooling';
  /** It already carried a `platform:` tag (taken as the truth, never re-inferred). */
  declared: boolean;
  /** Why — one human-readable reason per piece of evidence. */
  evidence: string[];
  /** An application's imports that contradict its stack's platform — what lint will report. */
  conflicts: string[];
  /** Workspace projects its sources import. */
  dependsOn: string[];
}

export interface Violation {
  project: string;
  platform: Platform;
  dependency: string;
  /** The dependency's platform, or `null` when it has none — lint fails there just the same. */
  dependencyPlatform: Platform | null;
}

/** Directories that never hold a project's own source (same spirit as `_utils/app-roots`). */
const NEVER_SOURCE = new Set(['node_modules', 'dist', 'build', 'coverage', 'out-tsc', 'tmp', 'temp']);
/** Targets whose presence says a project holds code of its own (built, tested, served or linted). */
const CODE_TARGETS = ['build', 'test', 'serve', 'lint'];

interface Own {
  /** Join of the bound evidence; 'shared' = none bound. */
  bound: Platform | null;
  evidence: string[];
  conflicts: string[];
  dependsOn: Set<string>;
  unread: boolean;
  /** Some import is bound to a platform the config does not name. */
  unsided: boolean;
}

export interface ClassifyOptions {
  /**
   * `untagged`: read only the sources of projects without a platform tag — what a project created since needs, at a
   * fraction of the cost (a tagged project's own imports are then not read, so `dependsOn` is empty for it and
   * `violations` sees only what the untagged import). Default: every project's.
   */
  read?: 'all' | 'untagged';
}

export function classifyWorkspace(tree: Tree, externals: PlatformExternals, options: ClassifyOptions = {}): Map<string, Classification> {
  const projects = getProjects(tree);
  const roots = [...projects.values()].map((project) => normalizeRoot(project.root));
  const owners = importOwners(tree, projects);
  const result = new Map<string, Classification>();
  const own = new Map<string, Own>();
  const ships = new Map<string, boolean>();

  for (const [name, project] of projects) {
    const declared = platformOf(project.tags);
    const stack = adapterOf(tree, name);
    const facts: Own = { bound: 'shared', evidence: [], conflicts: [], dependsOn: new Set(), unread: false, unsided: false };
    const application = projectRole(tree, name) === 'application';
    const stackPlatform = stack && stack.platform !== 'shared' ? stack.platform : undefined;
    if (!declared && stackPlatform) {
      facts.bound = join(facts.bound, stackPlatform);
      facts.evidence.push(`built by the ${stack!.id} stack (${stackPlatform})`);
    }
    let shipping = false;
    const files = declared && options.read === 'untagged' ? [] : sourceFiles(tree, normalizeRoot(project.root), roots);
    for (const file of files) {
      const scope = scopeOf(file);
      if (scope === 'never-ships') continue;
      shipping = true;
      const specifiers = importSpecifiers(tree.read(file, 'utf8') ?? '', file);
      if (!specifiers) {
        facts.unread = true;
        continue;
      }
      for (const specifier of specifiers) {
        const owner = ownerOf(owners, specifier);
        if (owner && owner !== name) {
          facts.dependsOn.add(owner);
          continue;
        }
        if (declared || specifier.startsWith('.') || specifier.startsWith('/')) continue;
        const side = sideOf(externals, specifier);
        if (!side) continue;
        if (side === 'unsided') {
          facts.unsided = true;
          note(facts.evidence, specifier, `imports ${specifier} (banned by this project's own platform:shared constraint, which says no platform; ${file})`);
          continue;
        }
        const why = side.builtin ? 'a Node built-in' : `${side.platform}-only`;
        // An application on a bound stack: the stack decides; an import of the OTHER platform is what lint reports —
        // unless it sits in the server half of an SSR web app, which the firewall scopes as server code.
        if (application && stackPlatform && !declared) {
          const allowedHere = scope === 'ssr-server' && stackPlatform === 'web';
          if (side.platform !== stackPlatform && !allowedHere) {
            note(facts.conflicts, specifier, `${file} imports ${specifier} (${why})${side.builtin ? ' — the browser build fails on it' : ''}`);
          }
          continue;
        }
        facts.bound = join(facts.bound, side.platform);
        note(facts.evidence, specifier, `imports ${specifier} (${why}, ${file})`);
      }
    }
    ships.set(name, shipping);
    own.set(name, facts);
  }

  const imported = new Set([...own.values()].flatMap((facts) => [...facts.dependsOn]));
  for (const [name, project] of projects) {
    const facts = own.get(name)!;
    const declared = platformOf(project.tags);
    const base = { project: name, declared: Boolean(declared), conflicts: facts.conflicts, dependsOn: [...facts.dependsOn].sort() };
    if (declared) {
      result.set(name, { ...base, platform: declared, basis: 'declared', evidence: [] });
      continue;
    }
    const bound = facts.bound !== 'shared' || facts.unsided || facts.conflicts.length > 0 || facts.dependsOn.size > 0;
    if (!isCodeProject(tree, name, project, imported, ships.get(name)!, bound)) {
      result.set(name, { ...base, platform: undefined, basis: 'tooling', evidence: [] });
      continue;
    }
    const stack = adapterOf(tree, name);
    if (projectRole(tree, name) === 'application' && stack && stack.platform !== 'shared') {
      result.set(name, { ...base, platform: stack.platform, basis: 'stack', evidence: [`an application of the ${stack.id} stack (${stack.platform})`] });
      continue;
    }
    const evidence = [...facts.evidence];
    if (facts.unread) evidence.push('some of its sources could not be read (no usable TypeScript in this workspace)');
    result.set(name, { ...base, platform: undefined, basis: 'none', evidence });
  }

  // (3) The fixed point over the undecided: own bound evidence joined with what each imports. Monotone on a finite
  // lattice, so it settles within (number of projects) rounds; the bound is only a guard.
  const settled = (entry: Classification): Platform | null | undefined => entry.platform;
  for (let round = 0, changed = true; changed && round <= projects.size; round++) {
    changed = false;
    for (const entry of result.values()) {
      if (entry.basis !== 'none' && entry.basis !== 'evidence') continue;
      const facts = own.get(entry.project)!;
      let bound: Platform | null = facts.bound;
      for (const dependency of entry.dependsOn) {
        const platform = result.get(dependency) ? settled(result.get(dependency)!) : undefined;
        if (platform === undefined) continue;
        bound = join(bound, platform);
      }
      // Nothing BOUND it (shared is the bottom, not a finding), it imports a package of an unnamed side, or some of it
      // could not be read: no platform — reported. Otherwise the evidence decided.
      const next: Platform | null | undefined = bound === 'shared' || (bound !== null && (facts.unsided || facts.unread)) ? undefined : bound;
      const basis = next === undefined ? 'none' : 'evidence';
      if (next !== entry.platform || basis !== entry.basis) {
        entry.platform = next;
        entry.basis = basis;
        changed = true;
      }
    }
  }
  for (const entry of result.values()) {
    if (entry.basis !== 'none' && entry.basis !== 'evidence') continue;
    for (const dependency of entry.dependsOn) {
      const platform = result.get(dependency)?.platform;
      if (platform === null) entry.evidence.push(`imports ${dependency}, which itself mixes web and server`);
      else if (platform && platform !== 'shared') entry.evidence.push(`imports ${dependency} (${platform})`);
    }
  }
  return result;
}

/** Does the project demonstrably hold code of its own — a stack builds it, or it builds, tests, serves or lints? */
export function holdsCode(tree: Tree, name: string, project: { targets?: Record<string, unknown> }): boolean {
  return Boolean(adapterOf(tree, name)) || Object.keys(project.targets ?? {}).some((target) => CODE_TARGETS.includes(target));
}

/** The tag a project states it is tooling with (the house's own tooling projects carry it). */
export const TOOLING_TAG = 'tooling';

/** Code, not tooling — see the header. `bound`: its shipping files import a platform-bound package or a workspace project. */
export function isCodeProject(
  tree: Tree,
  name: string,
  project: ProjectConfiguration,
  imported: ReadonlySet<string>,
  shipping: boolean,
  bound: boolean,
): boolean {
  if ((project.tags ?? []).includes(TOOLING_TAG)) return false;
  if (imported.has(name)) return true;
  if (!shipping) return false;
  // The workspace ROOT's "own" files are everything no other project claims — root-level tooling, CI scripts — so
  // what they import says nothing about the root as a project: only its role, stack or targets make it code.
  const evidenceCounts = bound && normalizeRoot(project.root) !== '.';
  return evidenceCounts || Boolean(projectRole(tree, name)) || holdsCode(tree, name, project);
}

/**
 * Every dependency between classified projects that the firewall forbids — including an import of a project left
 * with no platform, which lint fails just the same. Read against the platforms as they will be after tagging.
 */
export function violations(classified: Map<string, Classification>): Violation[] {
  const found: Violation[] = [];
  for (const entry of classified.values()) {
    if (!entry.platform) continue;
    for (const dependency of entry.dependsOn) {
      const target = classified.get(dependency);
      if (!target || target.basis === 'tooling') continue;
      const platform = target.platform ?? null;
      if (platform === null || !reachable(entry.platform).includes(platform)) {
        found.push({ project: entry.project, platform: entry.platform, dependency, dependencyPlatform: platform });
      }
    }
  }
  return found;
}

/** The side a package is bound to — by the table (or the project's own bans), or as a Node built-in. */
function sideOf(externals: PlatformExternals, specifier: string): { platform: Platform; builtin: boolean } | 'unsided' | undefined {
  for (const side of ['web', 'server'] as const) {
    if (externals[side].some((pattern) => matchesExternal(pattern, specifier))) return { platform: side, builtin: false };
  }
  if (externals.unsided.some((pattern) => matchesExternal(pattern, specifier))) return 'unsided';
  if (isNodeBuiltin(specifier)) return { platform: 'server', builtin: true };
  return undefined;
}

/** One reason per specifier — the first file that showed it. */
function note(list: string[], specifier: string, reason: string): void {
  if (!list.some((seen) => seen.includes(` ${specifier} (`))) list.push(reason);
}

const normalizeRoot = (root: string): string => root.replace(/^\.\/?/, '').replace(/\/+$/, '') || '.';

/** Every source file of the project's own — never descending into another project's root. */
function* sourceFiles(tree: Tree, root: string, roots: readonly string[]): Generator<string> {
  const others = new Set(roots.filter((other) => other !== root));
  const walk = function* (dir: string): Generator<string> {
    for (const child of tree.children(dir)) {
      if (child.startsWith('.') || NEVER_SOURCE.has(child)) continue;
      const path = dir === '.' ? child : `${dir}/${child}`;
      if (tree.isFile(path)) {
        if (isSourceFile(path)) yield path;
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
