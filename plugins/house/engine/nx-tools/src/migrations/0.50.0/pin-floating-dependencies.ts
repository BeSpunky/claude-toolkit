// 0.50.0 — pin every `"latest"` a house generator wrote, to a version that is COHERENT, not merely fixed.
//
// WHY. Up to 0.49.x four generators wrote `"latest"`: the Firebase client (`firebase` + `@angular/fire`), the navigation
// kernel (`@bespunky/typescript-utils`), adopt-extracted (the adopted package) and the functions build (`@nx/esbuild`,
// where `nx` was undeclared). From 0.50.0 no generator writes a floating spec (generators/_utils/dependencies.ts) — but a
// dependency is project state, so the `latest` already on disk moves only here.
//
// THE FIREBASE PAIR IS NOT "PIN WHAT'S INSTALLED" (the 0.35.0 pin-playwright rule). The bug state IS what is installed:
// firebase 12 at the root, firebase 11 nested under @angular/fire 20 — two SDKs, "No Firebase App '[DEFAULT]'". Freezing
// that would seal the bug behind a pin. So the pair is DERIVED from the workspace's INSTALLED ANGULAR MAJOR:
//   - @angular/fire: the installed one when it is the release line for that Angular major (no surprise upgrade), else the
//     house's release for that major (generators/_utils/firebase-compat.ts — the SAME table the Angular firebase client
//     reads every upgrade; a later toolkit running this rung knows more releases, and the installed Angular major is
//     what decides, so the newer table only ever yields a pair that is coherent for THIS project);
//   - firebase: EXACTLY the range that @angular/fire release declares in its own dependencies — never the installed root
//     firebase. The package manager then keeps ONE SDK, after a reinstall.
// Where Angular's major has no stable @angular/fire (21, 22 as of 0.50.0), there is no coherent pair to write: the
// `latest` stays, and the report NAMES each floating entry, says what is true and lists the choices, most recommended
// first. The judging and the wording are the Angular adapter's (adapters/angular/angularfire.ts), so this rung and the
// generator that runs right after it can never again give a project two different answers.
//
// ONLY the literal `"latest"` is rewritten — it is what the house wrote. Any other spec is the project's own choice; a
// floating one (`next`, `*`, …) is REPORTED with what to do, never rewritten.
import { type Tree, getProjects, logger } from '@nx/devkit';
import { browserSdkFindings, coherentPair, readBrowserSdkFacts, renderAdvice } from '../../adapters/angular/angularfire';
import { applyJsonChanges } from '../../generators/_utils/json-edits';

const TAG = '[0.50.0 pin-floating-dependencies]';

/** @bespunky/typescript-utils as of 0.50.0 (the only published version). */
const TYPESCRIPT_UTILS_AS_OF_0_50_0 = '0.1.0-alpha.0';

const PINNED = /^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const FLOATING_TAG = /^(?:latest|next|canary|beta|alpha|rc|\*|x|)$/;
const BLOCKS = ['dependencies', 'devDependencies'] as const;

type Manifest = Partial<Record<(typeof BLOCKS)[number], Record<string, string>>> & Record<string, unknown>;

export default function pinFloatingDependencies(tree: Tree): void {
  if (!tree.exists('package.json')) return;
  const text = tree.read('package.json', 'utf8') ?? '';
  let pkg: Manifest;
  try {
    pkg = JSON.parse(text);
  } catch {
    logger.warn(`${TAG} package.json is not valid JSON — not inspected.`);
    return;
  }
  const spec = (name: string) => BLOCKS.map((block) => pkg[block]?.[name]).find((value) => value !== undefined);
  const changed: string[] = [];
  const set = (name: string, version: string, why: string) => {
    for (const block of BLOCKS) {
      if (pkg[block]?.[name] === 'latest') {
        pkg[block]![name] = version;
        changed.push(`${block}.${name}: "latest" -> "${version}" (${why})`);
      }
    }
  };
  const installed = (name: string): { version?: string; dependencies?: Record<string, string> } | undefined => {
    try {
      return JSON.parse(tree.read(`node_modules/${name}/package.json`, 'utf8') ?? '');
    } catch {
      return undefined;
    }
  };
  const reports: string[] = [];
  /** Names a step has already spoken for — step 5 does not report them again. */
  const handled = new Set<string>();

  // 1) The Firebase browser SDK pair.
  if (spec('firebase') === 'latest' || spec('@angular/fire') === 'latest') {
    if (pinFirebasePair(tree, spec, set, reports)) handled.add('firebase').add('@angular/fire');
  }

  // 2) The navigation kernel's type utilities.
  if (spec('@bespunky/typescript-utils') === 'latest') {
    const version = installed('@bespunky/typescript-utils')?.version;
    set('@bespunky/typescript-utils', version ?? TYPESCRIPT_UTILS_AS_OF_0_50_0, version ? 'the version installed' : 'the house version');
  }

  // 3) @nx/esbuild moves in lockstep with Nx.
  if (spec('@nx/esbuild') === 'latest') {
    const nx = spec('nx');
    const version = nx && PINNED.test(nx) ? nx : installed('nx')?.version ?? installed('@nx/esbuild')?.version;
    if (version) set('@nx/esbuild', version, nx && PINNED.test(nx) ? "the workspace's declared nx" : 'the version installed');
    else {
      handled.add('@nx/esbuild');
      reports.push('@nx/esbuild is "latest" and neither nx nor @nx/esbuild is installed — pin it to exactly your Nx version.');
    }
  }

  // 4) Packages adopt-extracted declared (its default was "latest"): named by a library's extraction marker.
  for (const name of adoptedPackages(tree)) {
    if (spec(name) !== 'latest') continue;
    const version = installed(name)?.version;
    if (version) set(name, `^${version}`, 'the version installed (adopt-extracted)');
    else {
      handled.add(name);
      reports.push(`${name} is "latest" (adopt-extracted's old default) and is not installed — pin it to the published version you adopted.`);
    }
  }

  // 5) Every other floating spec is the project's own — named, never rewritten. A workspace package's `*` is the
  //    npm-workspaces LINK to it (written by the linking port), not a version: it is skipped.
  const local = workspacePackageNames(tree);
  for (const block of BLOCKS) {
    for (const [name, value] of Object.entries(pkg[block] ?? {})) {
      if (typeof value !== 'string' || PINNED.test(value) || !FLOATING_TAG.test(value.trim())) continue;
      if (handled.has(name) || local.has(name)) continue;
      reports.push(`${block}.${name} is "${value}" — a version nobody chose; it moves with no commit behind it. Pin it.`);
    }
  }

  if (changed.length) {
    // In place: only the entries that changed, in the file's own form (a new one at its sorted place).
    tree.write('package.json', applyJsonChanges(text, JSON.parse(text), pkg));
    logger.info(`${TAG} package.json:\n  ${changed.join('\n  ')}`);
    logger.info(`${TAG} REINSTALL now (yarn / npm / pnpm install) so the lockfile and node_modules follow these pins${changed.some((c) => c.includes('firebase')) ? ' — the Firebase SDK then dedupes to ONE copy' : ''}.`);
  }
  for (const line of reports) logger.warn(`${TAG} ${line}`);
}

/**
 * Rewrites the house-written `latest`s to the coherent pair, then reports — in the Angular adapter's own words —
 * whatever is still wrong with the pair as declared (a `latest` with no pair to pin, a firebase that is not the range
 * the @angular/fire carries). Returns whether it spoke for the pair (false: not an Angular workspace — the house never
 * wrote these there).
 */
function pinFirebasePair(
  tree: Tree,
  spec: (name: string) => string | undefined,
  set: (name: string, version: string, why: string) => void,
  reports: string[],
): boolean {
  const facts = () => readBrowserSdkFacts(tree, spec);
  const before = facts();
  if (!before.angular && !before.declared.fire) return false;
  const fire = before.declared.fire;
  if (fire && fire !== 'latest') {
    // The project chose @angular/fire itself: firebase follows THAT release — known once it is installed.
    const carried = before.installedFire;
    if (carried?.firebase && fire.replace(/^[~^]/, '') === carried.version) {
      set('firebase', carried.firebase, `the range the installed @angular/fire ${carried.version} declares`);
    }
  } else {
    const verdict = coherentPair(before);
    if ('pair' in verdict) {
      set('@angular/fire', verdict.pair.angularfire, verdict.pair.why);
      set('firebase', verdict.pair.firebase, `the range @angular/fire ${verdict.pair.angularfire} itself declares — never the installed root firebase`);
    }
  }
  for (const advice of browserSdkFindings(facts())) reports.push(renderAdvice('', advice).trimStart());
  return true;
}

/** The package names the workspace's own projects carry (their package.json `name`). */
function workspacePackageNames(tree: Tree): Set<string> {
  const names = new Set<string>();
  for (const [, project] of getProjects(tree)) {
    try {
      const name = (JSON.parse(tree.read(`${project.root}/package.json`, 'utf8') ?? '') as { name?: unknown }).name;
      if (typeof name === 'string') names.add(name);
    } catch {
      /* a project with no manifest has no package name */
    }
  }
  return names;
}

/** Every package a library's extraction marker names (extraction.json → ingestedPackage.name / proposedPackage). */
function adoptedPackages(tree: Tree): string[] {
  const names = new Set<string>();
  for (const [, project] of getProjects(tree)) {
    const marker = `${project.root}/extraction.json`;
    if (!tree.exists(marker)) continue;
    try {
      const json = JSON.parse(tree.read(marker, 'utf8') ?? '') as { ingestedPackage?: { name?: string }; proposedPackage?: string };
      for (const name of [json.ingestedPackage?.name, json.proposedPackage]) if (name) names.add(name);
    } catch {
      /* an unreadable marker names nothing */
    }
  }
  return [...names];
}
