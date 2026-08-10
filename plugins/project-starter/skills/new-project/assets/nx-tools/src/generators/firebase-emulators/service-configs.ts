// The per-service Firebase provider files — ONE declaration of what they are, shared by the generator
// that writes them and the migration that wires them into an existing app.
//
// Why shared rather than restated: the migration and the generator answer two halves of the same
// question, and they run at DIFFERENT times. The house sync sequence is
// `probe → install → migrate → detect → generate`, so at migration time these files do not exist yet —
// the generator writes them minutes later. A migration that only inserted the imports would leave a
// project that runs `nx migrate` on its own (without the generators behind it) importing files that
// aren't there. So the migration WRITES THE WHOLE SET from the same templates — unconditionally, not
// only the absent ones, exactly as the generator does — and the generator's later rewrite is byte-identical.
// Two callers, one list, one set of templates: the names, symbols and import paths cannot drift apart.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tree } from '@nx/devkit';

/** A Firebase SDK service the house generates a standalone provider file for. */
export interface FirebaseServiceConfig {
  /** The service key, matching `environment.emulators.<service>` and the EMULATE map. */
  readonly service: 'auth' | 'firestore' | 'storage' | 'functions';
  /** File name under the app's `src/app/`. */
  readonly fileName: string;
  /** The exported provider function. */
  readonly providerFn: string;
  /** Module specifier to import `providerFn` from, relative to `src/app/`. */
  readonly importFrom: string;
  /** Template file name, resolved beside this module. */
  readonly template: string;
  /**
   * MEASURED initial-bundle total (raw kB) for a freshly scaffolded house app providing
   * `provideAppFirebase()` plus THIS service and nothing else. Quoted in the app.config.ts note so the
   * choice of where to provide a service is made with the number in view.
   *
   * Deliberately a TOTAL, not a per-service delta: the deltas do not add up, and publishing them as if
   * they did would be a lie a reader could act on. About 74 kB of whichever service arrives FIRST is a
   * one-time @angular/fire base the other three then share, so the first costs ~89–174 kB and each one
   * after it is far cheaper — the four measured deltas sum to ~464 kB while all four together cost only
   * ~240 kB over the app-only baseline.
   */
  readonly initialKbWithThisOnly: number;
  /** One line on where this service usually belongs, for the same note. */
  readonly placement: string;
}

/** Measured initial-bundle totals (raw kB) for a fresh house app, as reference points for the note. */
export const FIREBASE_INITIAL_KB = {
  /** No Firebase providers at all. */
  none: 207,
  /** `provideAppFirebase()` alone — the Firebase app, the new scaffold default. */
  appOnly: 238,
  /** All four services at root — what `provideAppFirebase()` used to return on its own. */
  allFour: 479,
} as const;

export const FIREBASE_SERVICE_CONFIGS: readonly FirebaseServiceConfig[] = [
  {
    service: 'auth',
    fileName: 'firebase-auth.config.ts',
    providerFn: 'provideAppAuth',
    importFrom: './firebase-auth.config',
    template: 'firebase-auth.config.ts.tpl',
    initialKbWithThisOnly: 342,
    placement: 'usually root: a guard in the eager app.routes.ts pins Auth there anyway',
  },
  {
    service: 'firestore',
    fileName: 'firebase-firestore.config.ts',
    providerFn: 'provideAppFirestore',
    importFrom: './firebase-firestore.config',
    template: 'firebase-firestore.config.ts.tpl',
    initialKbWithThisOnly: 413,
    placement: 'the heaviest; prefer the lazy route that reads it',
  },
  {
    service: 'storage',
    fileName: 'firebase-storage.config.ts',
    providerFn: 'provideAppStorage',
    importFrom: './firebase-storage.config',
    template: 'firebase-storage.config.ts.tpl',
    initialKbWithThisOnly: 336,
    placement: 'the lazy route that uploads or reads files',
  },
  {
    service: 'functions',
    fileName: 'firebase-functions.config.ts',
    providerFn: 'provideAppFunctions',
    importFrom: './firebase-functions.config',
    template: 'firebase-functions.config.ts.tpl',
    initialKbWithThisOnly: 327,
    placement: 'the lazy route that calls a callable — often none, so often nowhere',
  },
];

/** The root config's file name and template — written alongside the siblings, never without them. */
export const FIREBASE_ROOT_CONFIG = {
  fileName: 'firebase.config.ts',
  template: 'firebase.config.ts.tpl',
} as const;

/**
 * Write the WHOLE generated Firebase config set under `<appRoot>/src/app/` — `firebase.config.ts` and
 * every per-service sibling.
 *
 * ALL FIVE OR NONE, and that is the point rather than a convenience. The siblings import
 * `emulatorFor` / `portOffset` / `offsetUrl` from `firebase.config.ts`, and those symbols are only
 * EXPORTED from 0.33.0 onwards — before that they were module-private. So writing the siblings beside an
 * older root file produces four files importing symbols that do not exist: the project stops compiling,
 * at `tsc`, nowhere near whatever wrote them. The migration hits exactly that if it writes only the
 * siblings — on a bare `nx migrate`, on a `SYNC_PARTIAL` run where the per-app generators are skipped,
 * and in any multi-app workspace, since the sync runs the generator against ONE app while the migration
 * necessarily visits them all. Keeping the set indivisible removes the failure instead of documenting it.
 *
 * Generator-owned and unconditional: these files carry no per-project values, so there is no "is it
 * customized?" guess to get wrong and no reason to preserve an older copy. `--sync`'s git backup covers a
 * project that edited one anyway.
 *
 * @returns the paths written, root file first.
 */
export function writeFirebaseConfigs(tree: Tree, appRoot: string): string[] {
  const write = ({ fileName, template }: { fileName: string; template: string }): string => {
    const path = `${appRoot}/src/app/${fileName}`;
    tree.write(path, readFileSync(join(__dirname, template), 'utf8'));
    return path;
  };
  return [write(FIREBASE_ROOT_CONFIG), ...FIREBASE_SERVICE_CONFIGS.map(write)];
}

/**
 * The comment left in a NEW app's `app.config.ts`, directly under `provideAppFirebase()`.
 *
 * A newly scaffolded app provides the Firebase APP and no service, so its initial bundle carries none of
 * the SDK beyond `@firebase/app`. The cost of that default is a `NullInjectorError` on the first
 * `inject(Firestore)` — so the fix has to be sitting in the file the developer opens.
 *
 * WHICH MEANS THE MENU HAS TO BE ACTUALLY USABLE. Each entry is three lines: the weight, the import, and
 * the call ALONE on its own line — because the one thing a reader will do is uncomment that line, and an
 * entry that carried its annotation inline (`// provideAppAuth(),  342 kB — usually root`) would hand
 * them a syntax error for following the instruction. The import gets its own line for the same reason:
 * the generator only imports `provideAppFirebase`, so uncommenting a call without adding the import fails
 * to compile, and a menu that omits that step is a menu that does not work.
 */
export function firebaseProvidersNote(): string {
  const entries = FIREBASE_SERVICE_CONFIGS.flatMap(
    ({ providerFn, importFrom, initialKbWithThisOnly, placement }) => [
      `── ${initialKbWithThisOnly} kB · ${placement}`,
      `   import { ${providerFn} } from '${importFrom}';   ← move this to the imports above`,
      `   ${providerFn}(),`,
      '',
    ]
  );
  return [
    'Firebase SERVICES are provided where they are USED — each has its own file, so a service this app',
    "doesn't reference never reaches the initial bundle. To use one, either:",
    '  • put it in the `providers` of the LAZILY-LOADED routes file that needs it (keeps it off the',
    '    critical path — it must be the file behind `loadChildren`; a providers array in the EAGER',
    '    app.routes.ts pins the chunk just as root does), or',
    '  • uncomment its call below and move its import up with the others, accepting its weight here.',
    '',
    `Measured initial bundle (raw) for a fresh app: ${FIREBASE_INITIAL_KB.none} kB with no Firebase,`,
    `${FIREBASE_INITIAL_KB.appOnly} kB as generated, ${FIREBASE_INITIAL_KB.allFour} kB with all four at root.`,
    'Each figure below is the total with THAT service alone — they do NOT add up, because whichever',
    "service arrives first drags in Firebase's shared core and the rest are much cheaper after it.",
    '',
    ...entries,
  ]
    .join('\n')
    .trimEnd();
}
