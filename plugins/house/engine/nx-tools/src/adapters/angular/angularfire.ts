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
import { type GeneratorCallback, type Tree, logger, readJson } from '@nx/devkit';
import { dirname, join } from 'node:path';
import * as FIREBASE_COMPAT from '../../generators/_utils/firebase-compat';
import { ANGULAR_TYPESCRIPT_BY_MAJOR } from '../../generators/_utils/firebase-compat';
import { FIREBASE_TOOLS_VERSION } from '../../generators/_utils/versions';
import { isFloatingSpec } from '../../generators/_utils/version-spec';
import {
  type AngularFireTable,
  type BrowserSdkFacts,
  type Pair,
  type SdkAdvice,
  coherentPair,
  firebaseToolsAdvice,
  majorOf,
  renderAdvice,
  tableOf,
} from './angularfire-judge';
import { declareDependencies, declaredSpec, placeDependency, updateManifest } from '../../generators/_utils/dependencies';
import { installedManifest, workspaceAngular } from './workspace-angular';

/** The live compatibility table (the 0.50.0 migration judges with its own frozen copy). */
export const LIVE_ANGULARFIRE_TABLE: AngularFireTable = tableOf(FIREBASE_COMPAT, FIREBASE_TOOLS_VERSION);

const TAG = '[firebase-client]';

export function readBrowserSdkFacts(
  tree: Tree,
  declared: (name: string) => string | undefined = (name) => declaredSpec(tree, name),
): BrowserSdkFacts {
  const angular = workspaceAngular(tree, declared);
  const fire = installedManifest(tree, '@angular/fire');
  return {
    angular,
    declared: { fire: declared('@angular/fire'), firebase: declared('firebase') },
    installedFire:
      typeof fire?.version === 'string'
        ? { version: fire.version, major: majorOf(fire.version), firebase: fire.dependencies?.firebase ?? null }
        : null,
  };
}

/**
 * What is wrong (or worth knowing) about the pair AS DECLARED — a floating spec, a firebase that is not the range the
 * @angular/fire carries (two SDKs), an @angular/fire built for another Angular major. Empty for a coherent pair.
 */
export function browserSdkFindings(facts: BrowserSdkFacts, table: AngularFireTable = LIVE_ANGULARFIRE_TABLE): SdkAdvice[] {
  const { declared, installedFire, angular } = facts;
  const findings: SdkAdvice[] = [];
  const verdict = coherentPair(facts, table);
  const fix: string[] =
    'pair' in verdict
      ? [`Declare "@angular/fire": "${verdict.pair.angularfire}" and "firebase": "${verdict.pair.firebase}" (${verdict.pair.why}).`]
      : verdict.refusal.choices;

  const floating = (['fire', 'firebase'] as const)
    .filter((key) => declared[key] !== undefined && isFloatingSpec(declared[key]!))
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
              `@angular/fire for Angular ${angular.major} existed as of ${table.asOf} (this toolkit's table). Update the toolkit and ` +
              `run the house upgrade to check against a newer table — it names the release once one exists.`,
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
  const verdict = coherentPair(readBrowserSdkFacts(tree), LIVE_ANGULARFIRE_TABLE);
  if ('refusal' in verdict) throw new Error(renderAdvice(TAG, verdict.refusal));
  // house.sh's probe refuses this before an add-layer writes anything; here it is said on every run it still holds.
  const tools = firebaseToolsAdvice(verdict.pair, LIVE_ANGULARFIRE_TABLE, declaredSpec(tree, 'firebase-tools'));
  if (tools) logger.warn(renderAdvice(TAG, tools));
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
  const candidates = Object.entries(LIVE_ANGULARFIRE_TABLE.byMajor)
    .filter(([, { stable }]) => stable)
    .map(([major]) => Number(major))
    .filter((major) => nx.supported.includes(major))
    .sort((a, b) => b - a);
  const major = candidates[0];
  if (major === undefined) {
    throw new Error(
      `${TAG} No Angular major has both a stable @angular/fire and support in the installed @nx/angular ` +
        `(it supports ${nx.supported.join(', ')}). Install an @nx/angular that supports Angular ` +
        `${Object.entries(LIVE_ANGULARFIRE_TABLE.byMajor).filter(([, r]) => r.stable).map(([m]) => m).join('/')} and re-run.`,
    );
  }
  // ALL of Angular's runtime, not @angular/core alone: @nx/angular's ensureAngularDependencies adds the runtime set ONLY
  // when @angular/core is undeclared ("assume the workspace was already initialized") — so declaring core alone left a
  // workspace without @angular/common, compiler, router, rxjs, zone.js (verified against @nx/angular 23.3,
  // generators/utils/ensure-angular-dependencies.js). The set and its versions are that function's, for this major,
  // from @nx/angular's own table; zone.js as its application generator decides it (zoneless from Angular 21 on).
  const versions = nx.versionsFor(major);
  const runtime: Record<string, string | undefined> = {
    '@angular/common': versions.angularVersion,
    '@angular/compiler': versions.angularVersion,
    '@angular/core': versions.angularVersion,
    '@angular/forms': versions.angularVersion,
    '@angular/platform-browser': versions.angularVersion,
    '@angular/router': versions.angularVersion,
    rxjs: versions.rxjsVersion,
    tslib: versions.tsLibVersion,
    ...(major < 21 ? { 'zone.js': versions.zoneJsVersion } : {}),
  };
  const missing = Object.entries(runtime).filter(([, version]) => !version).map(([name]) => name);
  if (missing.length) throw new Error(`${TAG} @nx/angular's version table names no version for ${missing.join(', ')} on Angular ${major} — this Nx changed it; declare them by hand.`);
  updateManifest(tree, 'package.json', 'firebase-client', (pkg) => {
    let next = pkg;
    for (const [name, version] of Object.entries(runtime)) if (!declaredIn(next, name)) next = withDependency(next, name, version!);
    if (declaredIn(next, '@angular-devkit/core')) next = withDependency(next, '@angular-devkit/core', versions.angularDevkitVersion);
    // TypeScript: create-nx-workspace installs Nx's newest, which an older Angular compiler refuses outright.
    const typescript = ANGULAR_TYPESCRIPT_BY_MAJOR[major];
    if (typescript && declaredIn(next, 'typescript') && declaredIn(next, 'typescript') !== typescript.pin) next = withDependency(next, 'typescript', typescript.pin);
    return next;
  });
  if (major < nx.latest) {
    logger.info(
      `${TAG} Angular ${major} — the newest major @angular/fire supports; upgrade when AngularFire ships ${major + 1}+ ` +
        `(\`nx migrate\`, then /bespunky-house:upgrade re-pins @angular/fire and firebase).`,
    );
  }
}

function declaredIn(pkg: Record<string, any>, name: string): string | undefined {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
}

/** `pkg` with `name` set to `spec` in the block that already declares it (else `dependencies`). */
function withDependency(pkg: Record<string, any>, name: string, spec: string): Record<string, any> {
  const block = pkg.devDependencies?.[name] !== undefined ? 'devDependencies' : 'dependencies';
  return { ...pkg, [block]: placeDependency(pkg[block], name, spec) };
}

/** The entries of @nx/angular's version table the creation-time pin reads. */
type NxAngularVersions = { angularVersion: string; angularDevkitVersion: string; rxjsVersion?: string; tsLibVersion?: string; zoneJsVersion?: string };

/**
 * The installed @nx/angular's own Angular version table: which majors it can create, and the package versions it
 * uses for each. Not on its public surface (its exports map hides src/utils since Nx 23), so it is read from the
 * package's files — and if Nx moves them, this fails loudly, naming the path, instead of guessing versions.
 */
function nxAngularVersionTable(tree: Tree): {
  supported: number[];
  latest: number;
  versionsFor: (major: number) => NxAngularVersions;
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
      const latest = require(join(dir, 'versions.js')) as NxAngularVersions;
      const compat = require(join(dir, 'backward-compatible-versions.js')) as {
        supportedVersions: number[];
        backwardCompatibleVersions: Record<number, NxAngularVersions>;
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
