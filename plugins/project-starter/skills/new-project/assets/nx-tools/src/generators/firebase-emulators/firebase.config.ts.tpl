// Firebase initialization for the app.
// Uses Angular's `ngDevMode` global to point at the local emulator suite during dev
// (started automatically by `nx serve`) and at your real Firebase project in production builds.
//
// `ngDevMode` is `true` in dev builds and tree-shaken to `false` in production by `@angular/build`,
// so the emulator config and the `connect*Emulator(...)` calls are removed from the prod bundle.
//
// To deploy against a real project, replace `productionFirebaseConfig` below with your web config
// (Firebase console -> Project settings -> Your apps -> the web app config object).
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';

declare const ngDevMode: boolean;

const emulatorFirebaseConfig = {
  projectId: 'demo-{{workspaceName}}',
  apiKey: 'demo',
  appId: 'demo',
};

const productionFirebaseConfig = {
  // TODO: paste your Firebase web config here (Firebase console -> Project settings -> Your apps).
  projectId: '',
  apiKey: '',
  appId: '',
};

export function provideAppFirebase(): EnvironmentProviders {
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
