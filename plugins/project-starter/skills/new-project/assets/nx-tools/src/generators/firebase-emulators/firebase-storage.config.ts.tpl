// Firebase STORAGE provider — one of the per-service siblings of firebase.config.ts.
//
// ~22 kB raw on the initial chunk when provided at root. Storage is usually reached from one or two
// surfaces (an upload screen, an avatar picker), which makes it a natural fit for the lazy routes file
// that owns those surfaces rather than app.config.ts.
//
// GENERATOR-OWNED — rewritten in full on every `--sync`. See firebase.config.ts for the full contract.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';

import { emulatorFor, portOffset } from './firebase.config';

declare const ngDevMode: boolean;

// Latched so the emulator is connected once per SDK instance even when this provider is used in more
// than one injector — see firebase-auth.config.ts for the full note. DEV ONLY.
let emulatorConnected = false;

/** Cloud Storage, wired to the Storage emulator in dev when `environment` asks for it. */
export function provideAppStorage(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideStorage(() => {
      const storage = getStorage();
      if (ngDevMode && !emulatorConnected) {
        const e = emulatorFor('storage');
        if (e) {
          connectStorageEmulator(storage, e.host, e.port + portOffset);
          emulatorConnected = true;
        }
      }
      return storage;
    }),
  ]);
}
