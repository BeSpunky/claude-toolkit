// The per-service Firebase provider files — ONE declaration of what they are, shared by the generator
// that writes them and the migration that wires them into an existing app.
//
// Why shared rather than restated: the migration and the generator answer two halves of the same
// question, and they run at DIFFERENT times. The house sync sequence is
// `probe → install → migrate → detect → generate`, so at migration time these files do not exist yet —
// the generator writes them minutes later. A migration that only inserted the imports would leave a
// project that runs `nx migrate` on its own (without the generators behind it) importing files that
// aren't there. So the migration WRITES ANY MISSING FILE from the same templates, and the generator
// overwrites them identically afterwards. Two callers, one list, one set of templates: the names,
// symbols and import paths cannot drift apart.
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
   * Approximate raw kB this service adds to the INITIAL chunk when provided at root. Quoted in the
   * app.config.ts note so the choice of where to provide it is made with the number in view.
   */
  readonly initialKb: number;
  /** One line on where this service usually belongs, for the same note. */
  readonly placement: string;
}

export const FIREBASE_SERVICE_CONFIGS: readonly FirebaseServiceConfig[] = [
  {
    service: 'auth',
    fileName: 'firebase-auth.config.ts',
    providerFn: 'provideAppAuth',
    importFrom: './firebase-auth.config',
    template: 'firebase-auth.config.ts.tpl',
    initialKb: 85,
    placement: 'usually root: a route GUARD cannot get Auth from the route it guards',
  },
  {
    service: 'firestore',
    fileName: 'firebase-firestore.config.ts',
    providerFn: 'provideAppFirestore',
    importFrom: './firebase-firestore.config',
    template: 'firebase-firestore.config.ts.tpl',
    initialKb: 235,
    placement: 'the heaviest by far; prefer the lazy route that reads it',
  },
  {
    service: 'storage',
    fileName: 'firebase-storage.config.ts',
    providerFn: 'provideAppStorage',
    importFrom: './firebase-storage.config',
    template: 'firebase-storage.config.ts.tpl',
    initialKb: 22,
    placement: 'the lazy route that uploads or reads files',
  },
  {
    service: 'functions',
    fileName: 'firebase-functions.config.ts',
    providerFn: 'provideAppFunctions',
    importFrom: './firebase-functions.config',
    template: 'firebase-functions.config.ts.tpl',
    initialKb: 35,
    placement: 'the lazy route that calls a callable — often none, so often nowhere',
  },
];

/**
 * Write every per-service provider file under `<appRoot>/src/app/`.
 *
 * Generator-owned and unconditional: these files carry no per-project values (exactly like
 * firebase.config.ts), so there is no "is it customized?" guess to get wrong and no reason to preserve
 * an older copy. `--sync`'s git backup covers a project that edited one anyway.
 *
 * @returns the paths written.
 */
export function writeFirebaseServiceConfigs(tree: Tree, appRoot: string): string[] {
  return FIREBASE_SERVICE_CONFIGS.map(({ fileName, template }) => {
    const path = `${appRoot}/src/app/${fileName}`;
    tree.write(path, readFileSync(join(__dirname, template), 'utf8'));
    return path;
  });
}

/**
 * The comment left in a NEW app's `app.config.ts`, directly under `provideAppFirebase()`.
 *
 * A newly scaffolded app provides the Firebase APP and no service, so its initial bundle carries none of
 * the SDK beyond `@firebase/app`. The cost of that default is a `NullInjectorError` on the first
 * `inject(Firestore)` — so the fix has to be sitting in the file the developer opens, naming both moves
 * (down into a lazy route, or uncommented here) and what each one costs.
 */
export function firebaseProvidersNote(): string {
  const lines = FIREBASE_SERVICE_CONFIGS.map(
    ({ providerFn, initialKb, placement }) =>
      `  ${`${providerFn}(),`.padEnd(24)}~${initialKb} kB — ${placement}`
  );
  return [
    'Firebase SERVICES are provided where they are USED — each has its own file, so a service this app',
    "doesn't reference never reaches the initial bundle. For each one you need, either:",
    '  • move it into the `providers` of the LAZILY-LOADED routes file that needs it (keeps it off the',
    '    critical path — it must be the file behind `loadChildren`, not the eager app.routes.ts), or',
    '  • uncomment it here, accepting its weight in the initial bundle.',
    '',
    ...lines,
  ].join('\n');
}
