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
// has. Writing something anyway would be the bug this exists to remove.
import { type GeneratorCallback, type Tree, logger } from '@nx/devkit';
import {
  ANGULARFIRE_BY_ANGULAR_MAJOR,
  ANGULARFIRE_TABLE_NEWEST_ANGULAR,
  type AngularFireRelease,
} from '../../generators/_utils/firebase-compat';
import { FIREBASE_TOOLS_VERSION } from '../../generators/_utils/versions';
import { declareDependencies, declaredSpec } from '../../generators/_utils/dependencies';

const TAG = '[firebase-client]';

/** The workspace's Angular version: the one installed, else the lowest the declared range allows. */
export function workspaceAngular(tree: Tree): { version: string; from: 'installed' | 'declared' } | null {
  const installed = installedVersion(tree, '@angular/core');
  if (installed) return { version: installed, from: 'installed' };
  const declared = declaredSpec(tree, '@angular/core')?.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return declared ? { version: `${declared[1]}.${declared[2] ?? 0}.${declared[3] ?? 0}`, from: 'declared' } : null;
}

/** The version of `name` resolved in the workspace's node_modules, or null. */
export function installedVersion(tree: Tree, name: string): string | null {
  try {
    const manifest = JSON.parse(tree.read(`node_modules/${name}/package.json`, 'utf8') ?? '') as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/** The firebase range the INSTALLED @angular/fire itself declares (its `dependencies.firebase`), or null. */
export function installedAngularFireFirebaseRange(tree: Tree): string | null {
  try {
    const manifest = JSON.parse(tree.read('node_modules/@angular/fire/package.json', 'utf8') ?? '') as {
      dependencies?: Record<string, string>;
    };
    return manifest.dependencies?.firebase ?? null;
  } catch {
    return null;
  }
}

/**
 * The @angular/fire release for this workspace's Angular — or an Error saying exactly why there is none and what to
 * do about it.
 */
export function angularFireFor(tree: Tree): AngularFireRelease {
  const angular = workspaceAngular(tree);
  if (!angular) {
    throw new Error(
      `${TAG} @angular/core is neither installed nor declared in the root package.json, so there is no Angular major to ` +
        `choose @angular/fire for. Install the workspace's dependencies (or add Angular), then re-run.`,
    );
  }
  const major = Number(angular.version.split('.')[0]);
  const where = `this workspace has @angular/core ${angular.version} (${angular.from})`;
  const row = ANGULARFIRE_BY_ANGULAR_MAJOR[major];
  const declareYourself =
    'declare "@angular/fire" and "firebase" in the root package.json yourself — firebase must be EXACTLY the range that ' +
    '@angular/fire release lists in its own dependencies (`npm view @angular/fire@<version> dependencies.firebase`), or ' +
    'the app ends up with two Firebase SDKs — install, and re-run: the generator keeps what the project declares.';
  if (!row) {
    throw new Error(
      major > ANGULARFIRE_TABLE_NEWEST_ANGULAR
        ? `${TAG} Angular ${major} is newer than this toolkit's @angular/fire table (it knows Angular up to ` +
            `${ANGULARFIRE_TABLE_NEWEST_ANGULAR}); ${where}. Update the toolkit and run /bespunky-house:upgrade, or ${declareYourself}`
        : `${TAG} Angular ${major} is older than any @angular/fire the house supports; ${where}. Upgrade Angular, or ${declareYourself}`,
    );
  }
  if (!row.stable) {
    const prerelease = row.prerelease
      ? `\n  • Use the prerelease DELIBERATELY: declare "@angular/fire": "${row.prerelease.angularfire}" and "firebase": ` +
        `"${row.prerelease.firebase}" (its own range; it needs @angular/core >= ${row.prerelease.minAngular}), install, re-run.`
      : '';
    const supported = Object.entries(ANGULARFIRE_BY_ANGULAR_MAJOR)
      .filter(([, { stable }]) => stable)
      .map(([m, { stable }]) => ({ m: Number(m), stable: stable! }))
      .pop();
    throw new Error(
      `${TAG} No stable @angular/fire supports Angular ${major} yet; ${where}. The house will not guess a version: ` +
        `@angular/fire peers exactly one Angular major, and firebase must be the range that release declares.${prerelease}` +
        (supported
          ? `\n  • Or use Angular ${supported.m}, whose stable @angular/fire is ${supported.stable.angularfire} (firebase ${supported.stable.firebase}).`
          : '') +
        `\n  • Or ${declareYourself}` +
        `\nWhen a stable @angular/fire for Angular ${major} ships, a toolkit release picks it up (tools/firebase-compat).`,
    );
  }
  if (compare(angular.version, row.stable.minAngular) < 0) {
    throw new Error(
      `${TAG} @angular/fire ${row.stable.angularfire} (the release for Angular ${major}) needs @angular/core >= ` +
        `${row.stable.minAngular}; ${where}. Update Angular within ${major}.x, then re-run.`,
    );
  }
  if (!row.stable.firebaseToolsOk) {
    logger.warn(
      `${TAG} @angular/fire ${row.stable.angularfire} declares an optional peer firebase-tools@"${row.stable.firebaseTools}", but ` +
        `the house pins firebase-tools ${FIREBASE_TOOLS_VERSION}. yarn only warns; npm refuses the install (ERESOLVE). ` +
        `Moving to Angular 20+ resolves it; otherwise pin firebase-tools to a version in that range in package.json.`,
    );
  }
  return row.stable;
}

/**
 * Declare whichever of @angular/fire / firebase the project lacks, coherently. With @angular/fire already installed,
 * firebase follows THAT release's own range; otherwise both come from the release for the workspace's Angular major
 * (which refuses, with the choices, when there is none). Both declared: nothing is written, but a firebase that
 * disagrees with what the installed @angular/fire carries is named — that is the two-SDK state.
 */
export function declareBrowserSdk(tree: Tree): GeneratorCallback {
  const declaredFire = declaredSpec(tree, '@angular/fire');
  const declaredFirebase = declaredSpec(tree, 'firebase');
  const carried = installedAngularFireFirebaseRange(tree);
  if (declaredFire && declaredFirebase) {
    if (carried && declaredFirebase !== carried) {
      logger.warn(
        `[firebase-client] package.json declares firebase "${declaredFirebase}", but the installed @angular/fire carries ` +
          `firebase "${carried}" — two Firebase SDKs ("No Firebase App '[DEFAULT]'"). Set "firebase": "${carried}" and reinstall.`,
      );
    }
    return () => undefined;
  }
  if (declaredFire && carried) return declareDependencies(tree, 'firebase-client', { firebase: carried });
  const release = angularFireFor(tree);
  if (declaredFire && declaredFire !== release.angularfire) {
    logger.warn(
      `[firebase-client] @angular/fire is declared as "${declaredFire}" but not installed; firebase is declared as ` +
        `"${release.firebase}", the range @angular/fire ${release.angularfire} carries. If yours carries another, set ` +
        `firebase to that range (\`npm view @angular/fire@<version> dependencies.firebase\`).`,
    );
  }
  return declareDependencies(tree, 'firebase-client', { '@angular/fire': release.angularfire, firebase: release.firebase });
}

/** Numeric x.y.z comparison (prerelease tails ignored — the table's minimums are releases). */
function compare(a: string, b: string): number {
  const parts = (v: string) => v.split('-')[0].split('.').map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}
