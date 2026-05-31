// Firebase initialization for the app.
//
// Switches between the local emulator suite (dev) and a real Firebase project
// (prod) by reading from `src/environments/environment.ts` — Angular's
// canonical environment-files pattern. The build swaps environment.ts →
// environment.prod.ts in production via project.json's
// `targets.build.configurations.production.fileReplacements`.
//
// Tree-shaking: `environment.production` is a literal `false` in the dev file
// and a literal `true` in the prod file. @angular/build (esbuild-based)
// evaluates the conditions in this file against the bundled environment
// constant and removes the dead branches — so the `connect*Emulator(...)`
// calls and emulator endpoints disappear from the prod bundle, and the
// fail-loud guard below disappears from the dev bundle.
//
// To wire a real project, edit `apps/<app>/src/environments/environment.prod.ts`
// — that file ships the step-by-step recipe in its header. This file is
// generator-owned; never edit it by hand.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';

import { environment } from '../environments/environment';

export function provideAppFirebase(): EnvironmentProviders {
  // Fail-loud guard for production builds with an unfilled web config —
  // ships only in the prod bundle (the `environment.production` literal is
  // `true` after fileReplacements), so a half-wired deploy throws at bootstrap
  // with the recipe in the error. In dev bundles `environment.production` is
  // `false` → DCE removes the whole block, zero dev-side cost.
  if (
    environment.production &&
    (!environment.firebase.projectId ||
      !environment.firebase.apiKey ||
      !environment.firebase.appId)
  ) {
    throw new Error(
      '[firebase.config.ts] environment.firebase is not filled in — cannot bootstrap Firebase for production.\n' +
        '  To wire a real project (one-time setup):\n' +
        '    1) firebase login\n' +
        '    2) firebase use --add                                  (picks from your account; writes .firebaserc)\n' +
        '    3) firebase apps:sdkconfig WEB <appId> --project <id>  (prints the real web config)\n' +
        '  Paste the returned firebaseConfig fields into apps/<app>/src/environments/environment.prod.ts and rebuild.'
    );
  }

  return makeEnvironmentProviders([
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const auth = getAuth();
      // `&& environment.emulators` narrows the optional so the access below
      // is type-safe — and in prod (where `emulators` is omitted from the env
      // file) DCE strips this whole block on the `!environment.production`
      // literal-false.
      if (!environment.production && environment.emulators) {
        connectAuthEmulator(auth, environment.emulators.auth, { disableWarnings: true });
      }
      return auth;
    }),
    provideFirestore(() => {
      const db = getFirestore();
      if (!environment.production && environment.emulators) {
        connectFirestoreEmulator(db, environment.emulators.firestore.host, environment.emulators.firestore.port);
      }
      return db;
    }),
    provideStorage(() => {
      const storage = getStorage();
      if (!environment.production && environment.emulators) {
        connectStorageEmulator(storage, environment.emulators.storage.host, environment.emulators.storage.port);
      }
      return storage;
    }),
    provideFunctions(() => {
      const functions = getFunctions();
      if (!environment.production && environment.emulators) {
        connectFunctionsEmulator(functions, environment.emulators.functions.host, environment.emulators.functions.port);
      }
      return functions;
    }),
  ]);
}
