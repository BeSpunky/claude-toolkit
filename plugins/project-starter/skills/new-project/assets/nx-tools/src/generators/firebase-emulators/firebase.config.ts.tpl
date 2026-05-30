// Firebase initialization for the app.
// Uses Angular's `ngDevMode` global to point at the local emulator suite during dev
// (started automatically by `nx serve`) and at your real Firebase project in production builds.
//
// `ngDevMode` is `true` in dev builds and tree-shaken to `false` in production by `@angular/build`,
// so the emulator config and the `connect*Emulator(...)` calls are removed from the prod bundle.
//
// === To wire a real Firebase project (when you're ready to deploy) ===
//   1) Log in:                 firebase login
//   2) Link the project:       firebase use --add        (picks from your account; writes .firebaserc)
//   3) Fetch the web config:   firebase apps:sdkconfig WEB <appId> --project <projectId>
//   4) Paste the returned `firebaseConfig` object below into `productionFirebaseConfig`.
//
// Do NOT hand-fabricate the production config — the values must match what your Firebase
// account actually has, and the CLI is the source of truth. The `productionFirebaseConfig`
// placeholders below are left intentionally empty so a half-wired prod build fails loudly
// instead of silently pointing at the wrong project.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';

declare const ngDevMode: boolean;

// Local emulator config. The `demo-` prefix is Firebase's convention for "offline only,
// no cloud calls" — it matches the `--project=demo-{{workspaceName}}` flag the Nx
// `emulators` targets pass, so emulator data and CLI invocations agree on one id.
const emulatorFirebaseConfig = {
  projectId: 'demo-{{workspaceName}}',
  apiKey: 'demo',
  appId: 'demo',
};

// TODO: paste your real Firebase web config here, fetched via:
//   firebase apps:sdkconfig WEB <appId> --project <projectId>
// (see the file header for the full flow). Leave empty until you actually have a project —
// an empty prod config fails loudly, which is better than silently pointing at nothing.
const productionFirebaseConfig = {
  projectId: '',
  apiKey: '',
  appId: '',
};

export function provideAppFirebase(): EnvironmentProviders {
  // Fail-loud guard: silently shipping a broken Firebase app is impossible.
  // Production mode + an unfilled productionFirebaseConfig → bootstrap throws immediately
  // with the recipe in the error. The check sits inside the `!ngDevMode` branch — kept in
  // prod, tree-shaken in dev — so there's zero dev-side cost and full prod-side safety.
  if (
    !ngDevMode &&
    (!productionFirebaseConfig.projectId ||
      !productionFirebaseConfig.apiKey ||
      !productionFirebaseConfig.appId)
  ) {
    throw new Error(
      '[firebase.config.ts] productionFirebaseConfig is not filled in — cannot bootstrap Firebase for production.\n' +
        '  To wire a real project (one-time setup):\n' +
        '    1) firebase login\n' +
        '    2) firebase use --add                                  (picks from your account; writes .firebaserc)\n' +
        '    3) firebase apps:sdkconfig WEB <appId> --project <id>  (prints the real web config)\n' +
        '  Then paste the returned firebaseConfig into productionFirebaseConfig and rebuild.'
    );
  }

  const firebaseConfig = ngDevMode ? emulatorFirebaseConfig : productionFirebaseConfig;
  return makeEnvironmentProviders([
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideAuth(() => {
      const auth = getAuth();
      if (ngDevMode) connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      return auth;
    }),
    provideFirestore(() => {
      const db = getFirestore();
      if (ngDevMode) connectFirestoreEmulator(db, 'localhost', 8080);
      return db;
    }),
    provideStorage(() => {
      const storage = getStorage();
      if (ngDevMode) connectStorageEmulator(storage, 'localhost', 9199);
      return storage;
    }),
    provideFunctions(() => {
      const functions = getFunctions();
      if (ngDevMode) connectFunctionsEmulator(functions, 'localhost', 5001);
      return functions;
    }),
  ]);
}
