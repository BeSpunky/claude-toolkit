// WHICH @angular/fire AND WHICH firebase an Angular workspace gets — derived, never `latest`.
//
// The chain is fixed by the packages themselves: @angular/fire peers ONE Angular major, and carries `firebase` as a
// DEPENDENCY. So the house reads the workspace's Angular (installed, else declared), takes the @angular/fire built for
// that major from the projected table (generators/_utils/firebase-compat.ts), and declares `firebase` as exactly that
// release's own range — the package manager then keeps ONE Firebase SDK. Pinning either independently is how a house
// app got firebase 12 at the root and 11 nested under @angular/fire ("No Firebase App '[DEFAULT]'").
//
// WHEN THERE IS NO ANSWER — an Angular major with no stable @angular/fire (21 and 22 as of 0.50.0), one newer than
// the table, an Angular below what the release accepts — it REFUSES, naming what is true and the choices the developer
// has, in the order the house recommends them. Writing something anyway would be the bug this exists to remove.
//
// ONE VOICE. Everything that judges this pair — the Angular firebase client (every upgrade) and the 0.50.0
// `pin-floating-dependencies` migration (once) — reads the same FACTS (`readBrowserSdkFacts`) and speaks through the
// same judges (`coherentPair`, `browserSdkFindings`) and renderer (`renderAdvice`). They once disagreed: the migration
// said "choose an @angular/fire for Angular 22 or move to 20", the generator said "set firebase to ^11.8.0" — and
// after following the latter, a floating `@angular/fire: latest` stood with nothing left reporting it.
import { type GeneratorCallback, type Tree, logger, readJson, writeJson } from '@nx/devkit';
import { dirname, join } from 'node:path';
import { ANGULARFIRE_BY_ANGULAR_MAJOR, ANGULARFIRE_TABLE_NEWEST_ANGULAR } from '../../generators/_utils/firebase-compat';
import { FIREBASE_TOOLS_VERSION } from '../../generators/_utils/versions';
import { declareDependencies, declaredSpec, isPinnedSpec } from '../../generators/_utils/dependencies';

const TAG = '[firebase-client]';

/** The workspace's Angular version: the one installed, else the lowest the declared range allows. */
export function workspaceAngular(tree: Tree, declared: (name: string) => string | undefined = (name) => declaredSpec(tree, name)):
  { version: string; from: 'installed' | 'declared' } | null {
  const installed = installedVersion(tree, '@angular/core');
  if (installed) return { version: installed, from: 'installed' };
  const range = declared('@angular/core')?.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return range ? { version: `${range[1]}.${range[2] ?? 0}.${range[3] ?? 0}`, from: 'declared' } : null;
}

/** The version of `name` resolved in the workspace's node_modules, or null. */
export function installedVersion(tree: Tree, name: string): string | null {
  const manifest = installedManifest(tree, name);
  return typeof manifest?.version === 'string' ? manifest.version : null;
}

function installedManifest(tree: Tree, name: string): { version?: unknown; dependencies?: Record<string, string> } | null {
  try {
    return JSON.parse(tree.read(`node_modules/${name}/package.json`, 'utf8') ?? '');
  } catch {
    return null;
  }
}

/** Everything the pair is judged on — read once, from the tree (or from a manifest a caller is still editing). */
export interface BrowserSdkFacts {
  angular: { version: string; major: number; from: 'installed' | 'declared' } | null;
  declared: { fire?: string; firebase?: string };
  /** The @angular/fire in node_modules, with the firebase range it carries (its own `dependencies.firebase`). */
  installedFire: { version: string; major: number; firebase: string | null } | null;
}

export function readBrowserSdkFacts(
  tree: Tree,
  declared: (name: string) => string | undefined = (name) => declaredSpec(tree, name),
): BrowserSdkFacts {
  const angular = workspaceAngular(tree, declared);
  const fire = installedManifest(tree, '@angular/fire');
  return {
    angular: angular && { ...angular, major: majorOf(angular.version) },
    declared: { fire: declared('@angular/fire'), firebase: declared('firebase') },
    installedFire:
      typeof fire?.version === 'string'
        ? { version: fire.version, major: majorOf(fire.version), firebase: fire.dependencies?.firebase ?? null }
        : null,
  };
}

/** A problem (or a plain fact) about the pair, with what to do — `choices` in the order the house recommends them. */
export interface SdkAdvice {
  level: 'warn' | 'info';
  what: string;
  choices: string[];
}

/** The one rendering both voices use. */
export function renderAdvice(tag: string, advice: SdkAdvice): string {
  if (!advice.choices.length) return `${tag} ${advice.what}`;
  const many = advice.choices.length > 1;
  return (
    `${tag} ${advice.what}${many ? ' Choose one (most recommended first), then reinstall:' : ' To fix it, then reinstall:'}` +
    advice.choices.map((choice, i) => `\n  ${many ? `${i + 1}.` : '•'} ${choice}`).join('')
  );
}

export type Pair = { angularfire: string; firebase: string; why: string };

/**
 * The coherent pair for this workspace's Angular — the installed @angular/fire when it is THIS major's release line
 * (no surprise upgrade; firebase = its own range), else the house's release for the major — or, when there is none,
 * the refusal: what is true, and the choices.
 */
export function coherentPair(facts: BrowserSdkFacts): { pair: Pair } | { refusal: SdkAdvice } {
  const { angular, installedFire } = facts;
  if (!angular) {
    return {
      refusal: {
        level: 'warn',
        what: '@angular/core is neither installed nor declared in the root package.json, so there is no Angular major to choose @angular/fire for.',
        choices: ['Install the workspace\'s dependencies (or add Angular), then re-run the house upgrade.'],
      },
    };
  }
  const { major } = angular;
  if (installedFire?.firebase && installedFire.major === major && isPinnedSpec(installedFire.version)) {
    return { pair: { angularfire: installedFire.version, firebase: installedFire.firebase, why: `the installed release for Angular ${major}` } };
  }
  const where = `this workspace has @angular/core ${angular.version} (${angular.from})`;
  const row = ANGULARFIRE_BY_ANGULAR_MAJOR[major];
  const stable = row?.stable;
  if (stable && compare(angular.version, stable.minAngular) >= 0) {
    return { pair: { angularfire: stable.angularfire, firebase: stable.firebase, why: `the house's release for Angular ${major}` } };
  }

  const choices: string[] = [];
  let what: string;
  if (stable) {
    what = `@angular/fire ${stable.angularfire} (the release for Angular ${major}) needs @angular/core >= ${stable.minAngular}; ${where}.`;
    choices.push(`Update Angular within ${major}.x to ${stable.minAngular} or later, then re-run the house upgrade — it pins the pair.`);
  } else if (!row && major > ANGULARFIRE_TABLE_NEWEST_ANGULAR) {
    what = `Angular ${major} is newer than this toolkit's @angular/fire table (it knows Angular up to ${ANGULARFIRE_TABLE_NEWEST_ANGULAR}); ${where}.`;
    choices.push('Update the toolkit and run /bespunky-house:upgrade — a newer table may have the release.');
  } else if (!row) {
    what = `Angular ${major} is older than any @angular/fire the house supports; ${where}.`;
    choices.push('Upgrade Angular (`nx migrate`), then re-run the house upgrade.');
  } else {
    what =
      `No stable @angular/fire supports Angular ${major} yet; ${where}. The house will not guess a version: @angular/fire ` +
      `peers exactly one Angular major, and firebase must be the range that release declares.`;
    if (row.prerelease) {
      choices.push(
        `Use the prerelease built for Angular ${major}, deliberately: "@angular/fire": "${row.prerelease.angularfire}", ` +
          `"firebase": "${row.prerelease.firebase}" (its own range; it needs @angular/core >= ${row.prerelease.minAngular}).`,
      );
    }
  }
  if (installedFire?.firebase && installedFire.major !== major && !stable) {
    choices.push(
      `Pin what is installed and runs today: "@angular/fire": "${installedFire.version}", "firebase": "${installedFire.firebase}" — ` +
        `one SDK, nothing floats. It is built for Angular ${installedFire.major}, so the install warns about its Angular peer ` +
        `(npm refuses without --legacy-peer-deps); every house upgrade says when a stable @angular/fire for Angular ${major} ships.`,
    );
  }
  const supported = newestStable();
  if (supported && supported.major !== major && !stable) {
    choices.push(
      `Move to Angular ${supported.major}, the newest with a stable @angular/fire: "@angular/fire": "${supported.release.angularfire}", ` +
        `"firebase": "${supported.release.firebase}" — fully supported, but a framework downgrade.`,
    );
  }
  choices.push(
    'Declare another @angular/fire release yourself, with "firebase" EXACTLY the range it lists in its own dependencies ' +
      '(`npm view @angular/fire@<version> dependencies.firebase`) — the house keeps what the project declares.',
  );
  return { refusal: { level: 'warn', what, choices } };
}

/**
 * What is wrong (or worth knowing) about the pair AS DECLARED — a floating spec, a firebase that is not the range the
 * @angular/fire carries (two SDKs), an @angular/fire built for another Angular major. Empty for a coherent pair.
 */
export function browserSdkFindings(facts: BrowserSdkFacts): SdkAdvice[] {
  const { declared, installedFire, angular } = facts;
  const findings: SdkAdvice[] = [];
  const verdict = coherentPair(facts);
  const fix: string[] =
    'pair' in verdict
      ? [`Declare "@angular/fire": "${verdict.pair.angularfire}" and "firebase": "${verdict.pair.firebase}" (${verdict.pair.why}).`]
      : verdict.refusal.choices;

  const floating = (['fire', 'firebase'] as const)
    .filter((key) => declared[key] !== undefined && !isPinnedSpec(declared[key]!))
    .map((key) => `"${key === 'fire' ? '@angular/fire' : 'firebase'}": "${declared[key]}"`);
  if (floating.length) {
    findings.push({
      level: 'warn',
      what:
        `package.json declares ${floating.join(' and ')} — ${floating.length > 1 ? 'versions nobody chose; they move' : 'a version nobody chose; it moves'} with no commit behind it, and ` +
        `firebase drifting from the range @angular/fire carries is the two-SDK crash ("No Firebase App '[DEFAULT]'").` +
        ('refusal' in verdict ? ` There is no coherent pair to pin for you: ${verdict.refusal.what}` : ''),
      choices: fix,
    });
    return findings; // what follows judges pinned specs only
  }
  if (!declared.fire) return findings;

  // The @angular/fire actually in play: the installed one when it is what is declared, else the declared version.
  const fireVersion =
    installedFire && declared.fire.replace(/^[~^]/, '') === installedFire.version ? installedFire.version : declared.fire.replace(/^[~^]/, '');
  const fireMajor = majorOf(fireVersion);
  if (angular && fireMajor !== angular.major) {
    findings.push(
      'pair' in verdict
        ? {
            level: 'warn',
            what: `@angular/fire ${fireVersion} is built for Angular ${fireMajor}, but this workspace runs Angular ${angular.version}.`,
            choices: fix,
          }
        : {
            level: 'info',
            what:
              `@angular/fire ${fireVersion} (built for Angular ${fireMajor}) runs on Angular ${angular.version}: no stable ` +
              `@angular/fire for Angular ${angular.major} exists yet. Every house upgrade checks again and names the release when it ships.`,
            choices: [],
          },
    );
  }
  const carried = installedFire && installedFire.version === fireVersion ? installedFire.firebase : null;
  if (carried && declared.firebase && declared.firebase !== carried) {
    findings.push({
      level: 'warn',
      what:
        `package.json declares firebase "${declared.firebase}", but @angular/fire ${fireVersion} carries firebase "${carried}" — ` +
        `two Firebase SDKs ("No Firebase App '[DEFAULT]'").`,
      choices: [`Set "firebase": "${carried}".`],
    });
  }
  return findings;
}

/**
 * The @angular/fire release for this workspace's Angular — or an Error saying exactly why there is none and what to
 * do about it.
 */
export function angularFireFor(tree: Tree): Pair {
  const verdict = coherentPair(readBrowserSdkFacts(tree));
  if ('refusal' in verdict) throw new Error(renderAdvice(TAG, verdict.refusal));
  const row = ANGULARFIRE_BY_ANGULAR_MAJOR[majorOf(verdict.pair.angularfire)]?.stable;
  if (row && row.angularfire === verdict.pair.angularfire && !row.firebaseToolsOk) {
    logger.warn(
      `${TAG} @angular/fire ${row.angularfire} declares an optional peer firebase-tools@"${row.firebaseTools}", but ` +
        `the house pins firebase-tools ${FIREBASE_TOOLS_VERSION}. yarn only warns; npm refuses the install (ERESOLVE). ` +
        `Moving to Angular 20+ resolves it; otherwise pin firebase-tools to a version in that range in package.json.`,
    );
  }
  return verdict.pair;
}

/**
 * Declare whichever of @angular/fire / firebase the project lacks, coherently. With @angular/fire already installed,
 * firebase follows THAT release's own range; otherwise both come from the release for the workspace's Angular major
 * (which refuses, with the choices, when there is none). Then — every upgrade — whatever is still wrong with the pair
 * as declared is named, with the same advice the 0.50.0 migration gives.
 */
export function declareBrowserSdk(tree: Tree): GeneratorCallback {
  const before = readBrowserSdkFacts(tree);
  const { fire, firebase } = before.declared;
  let install: GeneratorCallback = () => undefined;
  if (!fire || !firebase) {
    const carried = fire && before.installedFire?.firebase;
    if (carried) install = declareDependencies(tree, 'firebase-client', { firebase: carried });
    else {
      const pair = angularFireFor(tree);
      install = declareDependencies(tree, 'firebase-client', { '@angular/fire': pair.angularfire, firebase: pair.firebase });
    }
  }
  for (const advice of browserSdkFindings(readBrowserSdkFacts(tree))) {
    logger[advice.level](renderAdvice(TAG, advice));
  }
  return install;
}

function newestStable() {
  return Object.entries(ANGULARFIRE_BY_ANGULAR_MAJOR)
    .filter(([, { stable }]) => stable)
    .map(([m, { stable }]) => ({ major: Number(m), release: stable! }))
    .sort((a, b) => b.major - a.major)[0];
}

function majorOf(version: string): number {
  return Number(/\d+/.exec(version)?.[0]);
}

/**
 * CREATION TIME ONLY: a workspace that will wear Firebase and has not chosen its Angular yet is created at the NEWEST
 * Angular major that has a stable @angular/fire (and that the installed @nx/angular can create) — the flagship
 * Angular + Firebase project must always be creatable, even while AngularFire lags Angular. A workspace that already
 * declares @angular/core keeps its own; the client refuses there, with the choices, if it cannot follow.
 *
 * HOW the major is chosen is Nx's own mechanism: @nx/angular's generators pick every Angular package version from the
 * DECLARED @angular/core major (its `versions(tree)` → `backwardCompatibleVersions[major]`). So this declares
 * @angular/core at exactly @nx/angular's range for that major — and realigns the @angular-devkit/core its init added at
 * the latest major — and @nx/angular's application generator does the rest.
 */
export function pinAngularForFirebase(tree: Tree): void {
  if (declaredSpec(tree, '@angular/core') || !tree.exists('package.json')) return;
  const nx = nxAngularVersionTable(tree);
  const candidates = Object.entries(ANGULARFIRE_BY_ANGULAR_MAJOR)
    .filter(([, { stable }]) => stable)
    .map(([major]) => Number(major))
    .filter((major) => nx.supported.includes(major))
    .sort((a, b) => b - a);
  const major = candidates[0];
  if (major === undefined) {
    throw new Error(
      `${TAG} No Angular major has both a stable @angular/fire and support in the installed @nx/angular ` +
        `(it supports ${nx.supported.join(', ')}). Install an @nx/angular that supports Angular ` +
        `${Object.entries(ANGULARFIRE_BY_ANGULAR_MAJOR).filter(([, r]) => r.stable).map(([m]) => m).join('/')} and re-run.`,
    );
  }
  const versions = nx.versionsFor(major);
  writeJson(tree, 'package.json', withDependency(readJson(tree, 'package.json'), '@angular/core', versions.angularVersion));
  if (declaredSpec(tree, '@angular-devkit/core')) {
    writeJson(tree, 'package.json', withDependency(readJson(tree, 'package.json'), '@angular-devkit/core', versions.angularDevkitVersion));
  }
  if (major < nx.latest) {
    logger.info(
      `${TAG} Angular ${major} — the newest major @angular/fire supports; upgrade when AngularFire ships ${major + 1}+ ` +
        `(\`nx migrate\`, then /bespunky-house:upgrade re-pins @angular/fire and firebase).`,
    );
  }
}

/** `pkg` with `name` set to `spec` in the block that already declares it (else `dependencies`). */
function withDependency(pkg: Record<string, any>, name: string, spec: string): Record<string, any> {
  const block = pkg.devDependencies?.[name] !== undefined ? 'devDependencies' : 'dependencies';
  return { ...pkg, [block]: { ...pkg[block], [name]: spec } };
}

/**
 * The installed @nx/angular's own Angular version table: which majors it can create, and the package versions it
 * uses for each. Not on its public surface (its exports map hides src/utils since Nx 23), so it is read from the
 * package's files — and if Nx moves them, this fails loudly, naming the path, instead of guessing versions.
 */
function nxAngularVersionTable(tree: Tree): {
  supported: number[];
  latest: number;
  versionsFor: (major: number) => { angularVersion: string; angularDevkitVersion: string };
} {
  let root: string;
  try {
    root = dirname(require.resolve('@nx/angular/package.json', { paths: [tree.root] }));
  } catch {
    throw new Error(`${TAG} @nx/angular is not installed — the angular layer's Nx plugin creates the app. Run \`nx add @nx/angular\` first.`);
  }
  const candidates = ['dist/src/utils', 'src/utils'].map((dir) => join(root, dir));
  let cause = '';
  for (const dir of candidates) {
    try {
      const latest = require(join(dir, 'versions.js')) as { angularVersion: string; angularDevkitVersion: string };
      const compat = require(join(dir, 'backward-compatible-versions.js')) as {
        supportedVersions: number[];
        backwardCompatibleVersions: Record<number, { angularVersion: string; angularDevkitVersion: string }>;
      };
      const latestMajor = Number(/\d+/.exec(latest.angularVersion)?.[0]);
      return {
        supported: compat.supportedVersions,
        latest: latestMajor,
        versionsFor: (major) => (major >= latestMajor ? latest : compat.backwardCompatibleVersions[major]),
      };
    } catch (error) {
      cause = (error as Error).message.split('\n')[0]; // try the next layout
    }
  }
  throw new Error(
    `${TAG} Could not read @nx/angular's Angular version table (looked in ${candidates.join(', ')}: ${cause}) — this Nx moved it. ` +
      `Declare "@angular/core" in package.json at the Angular major you want (one with a stable @angular/fire) and re-run.`,
  );
}

/** Numeric x.y.z comparison (prerelease tails ignored — the table's minimums are releases). */
function compare(a: string, b: string): number {
  const parts = (v: string) => v.split('-')[0].split('.').map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}
