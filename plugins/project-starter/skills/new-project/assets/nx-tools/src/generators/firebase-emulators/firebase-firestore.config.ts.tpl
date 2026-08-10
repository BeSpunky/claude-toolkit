// Firebase FIRESTORE provider — one of the per-service siblings of firebase.config.ts.
//
// THE HEAVIEST SERVICE: measured at 413 kB initial for a fresh app providing this and nothing else, against
// 238 kB with no service at all (@firebase/firestore plus its webchannel transport, on top of the Firebase
// core the first service always brings). Provide it where it is actually read:
//
//   app.config.ts               → Firestore in the initial bundle
//   a LAZILY-LOADED routes file → Firestore in that lazy chunk, fetched in parallel with the route that
//                                 needs it rather than blocking bootstrap
//
// Note the second form only helps if the `providers: [provideAppFirestore()]` lives in the file behind
// `loadChildren` — a providers array written in the EAGER app.routes.ts is imported by the initial chunk
// and pins Firestore there regardless.
//
// GENERATOR-OWNED — rewritten in full on every `--sync`. See firebase.config.ts for the full contract.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { getApp } from '@angular/fire/app';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';

import { environment } from '../environments/environment';
import { emulatorFor, portOffset } from './firebase.config';

declare const ngDevMode: boolean;

// Emulator wiring must happen ONCE PER SDK INSTANCE — and the latch is keyed to the instance, not to
// this module. A plain module-level boolean looks equivalent and is not: it survives the SDK instance.
// Tear the Firebase app down and re-create it in the same JS realm — `deleteApp()` in a TestBed
// `afterEach`, then provide again — and the boolean still reads `true`, so the NEW instance is never
// connected and silently talks to the REAL backend from a dev/test run. Measured, not theorised.
// A WeakSet keyed on the instance answers the question actually being asked ("has THIS one been
// connected?"), tree-shakes exactly the same way, and cannot outlive what it is tracking.
const emulatorConnected = new WeakSet<object>();

/** Cloud Firestore, wired to the Firestore emulator in dev when `environment` asks for it. */
export function provideAppFirestore(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFirestore(() => {
      // Target a named Firestore database when the environment names one (a per-environment build — e.g.
      // environment.staging.ts with `databaseId: 'staging'` — isolates that env's client data in the same
      // project); omitted → the project's `(default)` database.
      const databaseId = (environment.firebase as { databaseId?: string }).databaseId;
      const db = databaseId ? getFirestore(getApp(), databaseId) : getFirestore();
      if (ngDevMode && !emulatorConnected.has(db)) {
        const e = emulatorFor('firestore');
        if (e) {
          connectFirestoreEmulator(db, e.host, e.port + portOffset);
          emulatorConnected.add(db);
        }
      }
      return db;
    }),
  ]);
}
