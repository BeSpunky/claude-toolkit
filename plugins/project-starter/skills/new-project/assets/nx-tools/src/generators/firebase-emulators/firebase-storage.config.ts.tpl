// Firebase STORAGE provider — one of the per-service siblings of firebase.config.ts.
//
// Measured at 336 kB initial for a fresh app providing this and nothing else, against 238 kB with no
// service at all — most of that is the Firebase core the FIRST service brings in, so Storage is cheap
// alongside another service and expensive on its own. Either way it is usually reached from one or two
// surfaces (an upload screen, an avatar picker), which makes it a natural fit for the lazy routes file
// that owns those surfaces rather than app.config.ts.
//
// GENERATOR-OWNED — rewritten in full on every `--sync`. See firebase.config.ts for the full contract.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';

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

/** Cloud Storage, wired to the Storage emulator in dev when `environment` asks for it. */
export function provideAppStorage(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideStorage(() => {
      const storage = getStorage();
      if (ngDevMode && !emulatorConnected.has(storage)) {
        const e = emulatorFor('storage');
        if (e) {
          connectStorageEmulator(storage, e.host, e.port + portOffset);
          emulatorConnected.add(storage);
        }
      }
      return storage;
    }),
  ]);
}
