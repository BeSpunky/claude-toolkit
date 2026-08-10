// Firebase FIRESTORE provider — one of the per-service siblings of firebase.config.ts.
//
// THE HEAVIEST SERVICE BY FAR: ~235 kB raw on the initial chunk when provided at root (@firebase/firestore
// plus its webchannel transport). Provide it where it is actually read:
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

// Latched so the emulator is connected once per SDK instance even when this provider is used in more
// than one injector (two sibling lazy routes, say) — see firebase-auth.config.ts for the full note.
// Connecting Firestore twice is the sharp case: once the instance has been used, changing its settings
// throws. DEV ONLY — tree-shaken from prod with the rest of the emulator wiring.
let emulatorConnected = false;

/** Cloud Firestore, wired to the Firestore emulator in dev when `environment` asks for it. */
export function provideAppFirestore(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFirestore(() => {
      // Target a named Firestore database when the environment names one (a per-environment build — e.g.
      // environment.staging.ts with `databaseId: 'staging'` — isolates that env's client data in the same
      // project); omitted → the project's `(default)` database.
      const databaseId = (environment.firebase as { databaseId?: string }).databaseId;
      const db = databaseId ? getFirestore(getApp(), databaseId) : getFirestore();
      if (ngDevMode && !emulatorConnected) {
        const e = emulatorFor('firestore');
        if (e) {
          connectFirestoreEmulator(db, e.host, e.port + portOffset);
          emulatorConnected = true;
        }
      }
      return db;
    }),
  ]);
}
