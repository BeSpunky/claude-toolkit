// The Angular adapter's FIREBASE port — the client half of the Firebase layer, for an Angular app.
//
// The emulator suite, Cloud Functions, App Hosting config and the scripts are framework-neutral and belong to
// the `firebase-emulators` core. What an ANGULAR app needs on top of them is this:
//   - environment files (Angular's environment-files pattern, per-service emulator-aware) — WRITE-IF-ABSENT,
//     because every one holds real per-project values; carrying an older shape is a migration's job
//     (0.24.1/0.24.2/0.24.3 run BEFORE any generator);
//   - src/app/firebase.config.ts + one file per SDK service + emulator-overrides.ts — GENERATOR-OWNED, rewritten
//     in full every run (they hold no per-project values: config lives in environment.ts, providers in
//     app.config.ts) — see ../../generators/firebase-emulators/service-configs;
//   - proxy.conf.mjs — the dev-server proxy relaying Functions callables through the app's own origin;
//   - the per-env build configurations (through this adapter's `env` port) and provideAppFirebase() (through
//     its `providers` port);
//   - the browser SDK: `firebase` + `@angular/fire`.
//
// The TEMPLATES stay beside the firebase-emulators generator on purpose: shipped migrations (0.24.2) resolve
// them by that path, and a migration must keep finding what it was written against.
import { type Tree, addDependenciesToPackageJson, readJson, readProjectConfiguration, logger } from '@nx/devkit';
import type { FirebaseClientPort } from '../stack-adapter';
import {
  firebaseProvidersNote,
  firebaseTemplate,
  writeFirebaseConfigs,
} from '../../generators/firebase-emulators/service-configs';
import { angular } from './index';

/** Blank the credential placeholders: a half-wired prod/staging build must fail loud, not silently use dev. */
const blankCredentials = (source: string): string =>
  ['projectId', 'apiKey', 'appId', 'authDomain'].reduce((text, key) => text.split(`{{${key}}}`).join(''), source);

export const angularFirebaseClient: FirebaseClientPort = {
  // The browser SDK and Angular have no place in the functions runtime.
  serverBannedImports: ['@angular/*'],

  isWired(tree, project) {
    return tree.exists(`${readProjectConfiguration(tree, project).root}/src/app/firebase.config.ts`);
  },

  attach(tree, project, { workspaceName, staging, wireProviders }) {
    const env = angular.env!.files(tree, project);
    const appRoot = readProjectConfiguration(tree, project).root;
    const substitute = (text: string) => text.split('{{workspaceName}}').join(workspaceName);

    // 1) Environment files — all WRITE-IF-ABSENT (see the header). The shared shape is one a project EXTENDS.
    if (!tree.exists(env.shape!)) tree.write(env.shape!, firebaseTemplate('environment.interface.ts.tpl'));
    if (!tree.exists(env.dev)) tree.write(env.dev, substitute(firebaseTemplate('environment.ts.tpl')));
    if (!tree.exists(env.prod)) tree.write(env.prod, blankCredentials(firebaseTemplate('environment.prod.ts.tpl')));
    if (staging && !tree.exists(env.staging)) {
      tree.write(env.staging, blankCredentials(firebaseTemplate('environment.staging.ts.tpl')));
    }

    // 2) The generator-owned client glue — rewritten in full, every run.
    tree.write(`${appRoot}/src/app/emulator-overrides.ts`, firebaseTemplate('emulator-overrides.ts.tpl'));
    if (tree.exists(`${appRoot}/src/app/firebase.config.ts`)) {
      logger.info(
        `[firebase-emulators] Rewrote ${appRoot}/src/app/firebase.config.ts to the current generator-owned shape (it holds no ` +
          `per-project values — customize via environment.ts for config, app.config.ts for providers, never this file).`,
      );
    }
    writeFirebaseConfigs(tree, appRoot);
    // Baked with THIS app's env path so it reads the project id from its single source of truth.
    tree.write(`${appRoot}/proxy.conf.mjs`, firebaseTemplate('proxy.conf.mjs.tpl').split('{{appEnvPath}}').join(env.dev));

    // 3) Per-env build configuration: production (and, opted in, staging) swap the dev env file.
    if (!angular.env!.selectFor(tree, project, 'production', env.dev, env.prod)) {
      logger.warn(
        `[firebase-emulators] No \`build\` target on project \`${project}\` — skipped registering the ` +
          `environment-files fileReplacements. Add it manually: the production configuration swaps ` +
          `"${env.dev}" → "${env.prod}".`,
      );
    } else if (staging) {
      angular.env!.selectFor(tree, project, 'staging', env.dev, env.staging, 'production');
    }

    // 4) provideAppFirebase() — the Firebase APP only; the four SDK services stay a commented menu beneath it.
    const result = angular.providers!.wire(tree, project, {
      providerFn: 'provideAppFirebase',
      importFrom: './firebase.config',
      ensuring: wireProviders,
      note: firebaseProvidersNote(),
    });
    if (result === 'unrecognized') {
      logger.warn(
        `[firebase-emulators] Could not auto-wire ${angular.providers!.bootstrapFile(tree, project)}. ` +
          `Add \`import { provideAppFirebase } from './firebase.config';\` and ` +
          `include \`provideAppFirebase()\` in your providers array manually.`,
      );
    }

    // 5) The browser SDK. Existing entries are never overwritten (preserves user pins on --sync).
    const rootPkg = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
      tree,
      'package.json',
    );
    const missing = Object.fromEntries(
      Object.entries({ firebase: 'latest', '@angular/fire': 'latest' }).filter(
        ([name]) => !rootPkg.dependencies?.[name] && !rootPkg.devDependencies?.[name],
      ),
    );
    return addDependenciesToPackageJson(tree, missing, {});
  },
};
