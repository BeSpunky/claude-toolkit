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
// NODE IS PART OF THE PAIR: a firebase is installable only on a Node its whole dependency closure accepts (firebase 13's
// `@firebase/ai@3.0.0` needs `>=24.12.0`; yarn refuses the install on Node 22). The table records what each firebase
// range installs and the Node majors it needs; a pair whose firebase the project's Node cannot install is never chosen,
// and the refusal says so — naming the requirement, the package that states it, and the project's Node.
//
// EVERY MESSAGE THAT RESTS ON THE TABLE IS DATED: a project's toolkit is pinned exactly, so its table is a snapshot, and
// "no stable @angular/fire yet" would claim a live fact it cannot know.
import type * as FirebaseCompat from '../../generators/_utils/firebase-compat';

type AngularFireRelease = FirebaseCompat.AngularFireRelease;
type FirebaseResolution = FirebaseCompat.FirebaseResolution;

/** The table the judge reads — the live projection, or a migration's frozen copy. */
export interface AngularFireTable {
  asOf: string;
  byMajor: Readonly<Record<number, { stable: AngularFireRelease | null; prerelease: AngularFireRelease | null }>>;
  newestAngular: number;
  /** The house's own firebase-tools pin the table was projected against. */
  firebaseTools: string;
  /** What firebase declared by an npm dist-tag installed as of the table, and the Node it needs — per tag. */
  firebaseByTag: Readonly<Record<string, FirebaseResolution>>;
}

/** The live projection as one table. */
export function tableOf(compat: typeof FirebaseCompat, firebaseTools: string): AngularFireTable {
  return { asOf: compat.ANGULARFIRE_TABLE_AS_OF, byMajor: compat.ANGULARFIRE_BY_ANGULAR_MAJOR, newestAngular: compat.ANGULARFIRE_TABLE_NEWEST_ANGULAR, firebaseTools, firebaseByTag: compat.FIREBASE_BY_DIST_TAG };
}

/** Everything the pair is judged on — read once, from the tree (or from a manifest a caller is still editing). */
export interface BrowserSdkFacts {
  angular: { version: string; major: number; from: 'installed' | 'declared' } | null;
  declared: { fire?: string; firebase?: string };
  /** The @angular/fire in node_modules, with the firebase range it carries (its own `dependencies.firebase`). */
  installedFire: { version: string; major: number; firebase: string | null } | null;
  /** The project's Node major and where it is declared (`.nvmrc` …); null when the project declares none yet. */
  node: { major: number; from: string } | null;
  /**
   * The ROOT firebase in node_modules, with every `engines.node` in its installed closure that refuses the project's
   * Node (empty when it runs there, or the Node is unknown).
   */
  installedFirebase: { version: string; refusedBy: NodeNeed[] } | null;
}

/** One `engines.node` requirement and the packages that state it. */
export type NodeNeed = { range: string; packages: string[] };

/**
 * Why `resolution` cannot be installed on the project's Node — undefined when it can, or when the project's Node is
 * not known (nothing to judge against).
 */
export function firebaseNodeGap(resolution: FirebaseResolution | undefined, node: BrowserSdkFacts['node']): string | undefined {
  if (!resolution || !node || resolution.nodeMajors.includes(node.major)) return undefined;
  return nodeRefusal(`firebase ${resolution.firebase}`, resolution.nodeNeeds.filter((need) => !need.nodeMajors.includes(node.major)), node);
}

/** "firebase 13.0.0 needs Node >=24.12.0 (@firebase/ai@3.0.0 and 8 more); this project's Node is 22 (.nvmrc) — …". */
export function nodeRefusal(what: string, needs: NodeNeed[], node: { major: number; from: string }): string {
  const said = needs
    .map(({ range, packages }) => `${range} (${packages[0]}${packages.length > 1 ? ` and ${packages.length - 1} more` : ''})`)
    .join(' and ');
  return (
    `${what} needs Node ${said}; this project's Node is ${node.major} (${node.from}) — yarn refuses that install outright, ` +
    `npm and pnpm warn and install a firebase that is not built for it`
  );
}

/** The table's release for an exact @angular/fire version (stable or prerelease row), if it knows it. */
function releaseOf(angularfire: string, table: AngularFireTable): AngularFireRelease | undefined {
  const row = table.byMajor[majorOf(angularfire)];
  return [row?.stable, row?.prerelease].find((r): r is AngularFireRelease => r?.angularfire === angularfire);
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
  const { node, installedFirebase } = facts;
  // A release whose firebase the project's Node cannot install is never chosen — and every refusal says why.
  const gapOf = (release: AngularFireRelease | undefined) => firebaseNodeGap(release?.firebaseResolves, node);
  const notOffered: string[] = [];
  const installedGap = installedFire ? gapOf(releaseOf(installedFire.version, table)) : undefined;
  // (An installed version is always exact, so it is a pin as it stands.)
  if (installedFire?.firebase && installedFire.major === major && !installedGap) {
    return { pair: { angularfire: installedFire.version, firebase: installedFire.firebase, why: `the installed release for Angular ${major}`, firebaseTools: toolsFor(installedFire.version, table) } };
  }
  if (installedFire?.firebase && installedGap) notOffered.push(`the installed @angular/fire ${installedFire.version}'s range "${installedFire.firebase}" installs ${installedGap}`);
  const where = `this workspace has @angular/core ${angular.version} (${angular.from})`;
  const row = table.byMajor[major];
  const stable = row?.stable;
  const stableGap = gapOf(stable ?? undefined);
  if (stable && compare(angular.version, stable.minAngular) >= 0 && !stableGap) {
    return { pair: { angularfire: stable.angularfire, firebase: stable.firebase, why: `the house's release for Angular ${major}`, firebaseTools: stable.firebaseToolsPin } };
  }

  const choices: string[] = [];
  let what: string;
  if (stable && stableGap) {
    what = `@angular/fire ${stable.angularfire} (the release for Angular ${major}) carries firebase "${stable.firebase}", and ${stableGap} (as of ${table.asOf}); ${where}.`;
    const majors = stable.firebaseResolves.nodeMajors.filter((m) => m > node!.major);
    if (majors.length) {
      choices.push(
        `Move this project to Node ${majors[0]} or later (${node!.from}; it builds the devcontainer and CI), rebuild the container, ` +
          'then re-run the house upgrade — it pins the pair.',
      );
    }
  } else if (stable) {
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
    const prereleaseGap = gapOf(row.prerelease ?? undefined);
    if (row.prerelease && prereleaseGap) notOffered.push(`the prerelease @angular/fire ${row.prerelease.angularfire}'s range "${row.prerelease.firebase}" installs ${prereleaseGap}`);
    if (row.prerelease && !prereleaseGap) {
      choices.push(
        `Use the prerelease built for Angular ${major}, deliberately: "@angular/fire": "${row.prerelease.angularfire}", ` +
          `"firebase": "${row.prerelease.firebase}" (its own range; it needs @angular/core >= ${row.prerelease.minAngular}).`,
      );
    }
  }
  if (installedFire?.firebase && installedFire.major !== major && !stable && !installedGap) {
    choices.push(
      `Pin the installed @angular/fire ${installedFire.version} with the firebase range it carries: "@angular/fire": "${installedFire.version}", ` +
        `"firebase": "${installedFire.firebase}" — one SDK, nothing floats.${rootFirebaseNote(installedFire.firebase, installedFirebase, releaseOf(installedFire.version, table))} ` +
        `@angular/fire ${installedFire.version} is built for Angular ${installedFire.major}, so the install warns about its Angular peer ` +
        `(npm refuses without --legacy-peer-deps). A toolkit whose table has a stable @angular/fire for Angular ${major} names it on the next house upgrade.`,
    );
  }
  const supported = newestStable(table, node);
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
  if (notOffered.length) what += ` Not offered, because this project's Node cannot install it: ${notOffered.join('; ')}.`;
  return { refusal: { level: 'warn', what, choices } };
}

/**
 * What pinning `range` does to the ROOT firebase installed today — said, never assumed: "what is installed" is the
 * @angular/fire, and the root firebase may be another release entirely (a floating `latest` pulled in firebase 13
 * while @angular/fire 20 carries ^11.8.0).
 */
function rootFirebaseNote(range: string, installed: BrowserSdkFacts['installedFirebase'], release: AngularFireRelease | undefined): string {
  if (!installed) return '';
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  const inside = caret ? majorOf(installed.version) === Number(caret[1]) && compare(installed.version, range.trim().slice(1)) >= 0 : undefined;
  if (inside === true) return ` It keeps the root firebase installed today (${installed.version}, inside that range).`;
  const target = release ? `firebase ${release.firebaseResolves.firebase} (as of the table)` : 'the newest firebase inside it';
  const facts = [inside === false ? 'outside that range' : '', installed.refusedBy.length ? 'needs a newer Node than this project\'s' : ''].filter(Boolean);
  const said = facts.length ? ` (${facts.join(', and ')})` : '';
  return inside === false
    ? ` The root firebase installed today is ${installed.version}${said}: the reinstall replaces it with ${target}.`
    : ` The root firebase installed today is ${installed.version}${said}; the reinstall resolves that range to ${target}.`;
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
  return releaseOf(angularfire, table)?.firebaseToolsPin ?? null;
}

function newestStable(table: AngularFireTable, node: BrowserSdkFacts['node']) {
  return Object.entries(table.byMajor)
    .filter(([, { stable }]) => stable && !firebaseNodeGap(stable.firebaseResolves, node))
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
