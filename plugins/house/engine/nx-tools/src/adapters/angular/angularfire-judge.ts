// THE @angular/fire PAIRING JUDGE — pure, import-free, with the compatibility table passed in.
//
// Three readers judge the pair and must say the same thing: the Angular firebase client on every upgrade (with the live
// table, generators/_utils/firebase-compat.ts), the 0.50.0 `pin-floating-dependencies` migration once (with its FROZEN
// copy — a migration freezes the values it writes, and may share the mechanics that take them as parameters), and
// house.sh's probe (engine/house-probe.mts), which loads this file directly before anything is installed, so an
// `add-layer firebase` the house cannot pair is refused before anything is written. Tree I/O lives in ./angularfire.ts.
//
// THE PREMISE: the release line for Angular N is @angular/fire N.x (the judges compare majors); the projection
// (tools/firebase-compat/project.mjs) fails when an upstream release breaks it.
//
// EVERY MESSAGE THAT RESTS ON THE TABLE IS DATED: a project's toolkit is pinned exactly, so its table is a snapshot, and
// "no stable @angular/fire yet" would claim a live fact it cannot know.
import type * as FirebaseCompat from '../../generators/_utils/firebase-compat';

type AngularFireRelease = FirebaseCompat.AngularFireRelease;

/** The table the judge reads — the live projection, or a migration's frozen copy. */
export interface AngularFireTable {
  asOf: string;
  byMajor: Readonly<Record<number, { stable: AngularFireRelease | null; prerelease: AngularFireRelease | null }>>;
  newestAngular: number;
  /** The house's own firebase-tools pin the table was projected against. */
  firebaseTools: string;
}

/** The live projection as one table. */
export function tableOf(compat: typeof FirebaseCompat, firebaseTools: string): AngularFireTable {
  return { asOf: compat.ANGULARFIRE_TABLE_AS_OF, byMajor: compat.ANGULARFIRE_BY_ANGULAR_MAJOR, newestAngular: compat.ANGULARFIRE_TABLE_NEWEST_ANGULAR, firebaseTools };
}

/** Everything the pair is judged on — read once, from the tree (or from a manifest a caller is still editing). */
export interface BrowserSdkFacts {
  angular: { version: string; major: number; from: 'installed' | 'declared' } | null;
  declared: { fire?: string; firebase?: string };
  /** The @angular/fire in node_modules, with the firebase range it carries (its own `dependencies.firebase`). */
  installedFire: { version: string; major: number; firebase: string | null } | null;
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

/**
 * A coherent pair, and the firebase-tools a project on it declares (the house pin when its peer admits it, else the
 * newest inside the peer; null when the table does not know the release).
 */
export type Pair = { angularfire: string; firebase: string; why: string; firebaseTools: string | null };

/**
 * The coherent pair for this workspace's Angular — the installed @angular/fire when it is THIS major's release line
 * (no surprise upgrade; firebase = its own range), else the house's release for the major — or, when there is none,
 * the refusal: what is true, and the choices.
 */
export function coherentPair(facts: BrowserSdkFacts, table: AngularFireTable): { pair: Pair } | { refusal: SdkAdvice } {
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
  // (An installed version is always exact, so it is a pin as it stands.)
  if (installedFire?.firebase && installedFire.major === major) {
    return { pair: { angularfire: installedFire.version, firebase: installedFire.firebase, why: `the installed release for Angular ${major}`, firebaseTools: toolsFor(installedFire.version, table) } };
  }
  const where = `this workspace has @angular/core ${angular.version} (${angular.from})`;
  const row = table.byMajor[major];
  const stable = row?.stable;
  if (stable && compare(angular.version, stable.minAngular) >= 0) {
    return { pair: { angularfire: stable.angularfire, firebase: stable.firebase, why: `the house's release for Angular ${major}`, firebaseTools: stable.firebaseToolsPin } };
  }

  const choices: string[] = [];
  let what: string;
  if (stable) {
    what = `@angular/fire ${stable.angularfire} (the release for Angular ${major}) needs @angular/core >= ${stable.minAngular}; ${where}.`;
    choices.push(`Update Angular within ${major}.x to ${stable.minAngular} or later, then re-run the house upgrade — it pins the pair.`);
  } else if (!row && major > table.newestAngular) {
    what = `Angular ${major} is newer than this toolkit's @angular/fire table (it knows Angular up to ${table.newestAngular}, as of ${table.asOf}); ${where}.`;
    choices.push('Update the toolkit and run /bespunky-house:upgrade — a newer table may have the release.');
  } else if (!row) {
    what = `Angular ${major} is older than any @angular/fire the house supports; ${where}.`;
    choices.push('Upgrade Angular (`nx migrate`), then re-run the house upgrade.');
  } else {
    what =
      `No stable @angular/fire supported Angular ${major} as of ${table.asOf} (the date of this toolkit's table); ${where}. ` +
      `The house will not guess a version: @angular/fire ` +
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
        `(npm refuses without --legacy-peer-deps). A toolkit whose table has a stable @angular/fire for Angular ${major} names it on the next house upgrade.`,
    );
  }
  const supported = newestStable(table);
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
 * firebase-tools against the pair: undefined when the house pin fits, else the advice — @angular/fire peers
 * (optionally) a firebase-tools range the house pin is outside of, and npm refuses that install (ERESOLVE).
 */
export function firebaseToolsAdvice(pair: Pair, table: AngularFireTable, declaredTools: string | undefined): SdkAdvice | undefined {
  if (!pair.firebaseTools || pair.firebaseTools === table.firebaseTools) return undefined;
  if (declaredTools !== undefined && declaredTools !== table.firebaseTools) return undefined; // the project chose its own
  const release = Object.values(table.byMajor).map((row) => row.stable ?? row.prerelease).find((r) => r?.angularfire === pair.angularfire);
  return {
    level: 'warn',
    what:
      `@angular/fire ${pair.angularfire} (${pair.why}) peers firebase-tools "${release?.firebaseTools}", and the house's ` +
      `firebase-tools ${table.firebaseTools} is outside it — npm refuses that install (ERESOLVE); yarn and pnpm only warn.`,
    choices: [
      `Move to Angular 20 or later (\`nx migrate\`): its @angular/fire accepts firebase-tools ${table.firebaseTools}, the version the house tooling runs.`,
      `Declare "firebase-tools": "${pair.firebaseTools}" (the newest inside that peer) in devDependencies yourself — the house keeps a ` +
        `declared firebase-tools; its emulator and deploy tooling is verified on ${table.firebaseTools}.`,
    ],
  };
}

function toolsFor(angularfire: string, table: AngularFireTable): string | null {
  const row = table.byMajor[majorOf(angularfire)];
  const release = [row?.stable, row?.prerelease].find((r) => r?.angularfire === angularfire);
  return release ? release.firebaseToolsPin : null;
}

function newestStable(table: AngularFireTable) {
  return Object.entries(table.byMajor)
    .filter(([, { stable }]) => stable)
    .map(([m, { stable }]) => ({ major: Number(m), release: stable! }))
    .sort((a, b) => b.major - a.major)[0];
}

export function majorOf(version: string): number {
  return Number(/\d+/.exec(version)?.[0]);
}

/** Numeric x.y.z comparison (prerelease tails ignored — the table's minimums are releases). */
function compare(a: string, b: string): number {
  const parts = (v: string) => v.split('-')[0].split('.').map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}
