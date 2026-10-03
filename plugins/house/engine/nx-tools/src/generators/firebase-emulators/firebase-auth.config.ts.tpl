// Firebase AUTH provider — one of the per-service siblings of firebase.config.ts.
//
// Provide it where Auth is actually needed. `provideAppFirebase()` (the Firebase app) must be provided
// at root either way; this adds Auth to whatever injector you put it in:
//
//   app.config.ts                    → Auth in the initial bundle (measured: 342 kB total for a fresh app
//                                      providing this and nothing else, vs 238 kB with none)
//   a LAZILY-LOADED routes file      → Auth in that lazy chunk, off the critical path
//
// AUTH IS THE ONE THAT USUALLY BELONGS AT ROOT — and it should be a decision, not a default. The reason
// is BUNDLING, not injection: a guard NAMED in the eager app.routes.ts is statically imported by the
// initial chunk, so its `inject(Auth)` pins @angular/fire/auth there regardless of where the provider is
// declared. An app that gates its routes on sign-in therefore has Auth on its critical path by
// construction — provide it at root and accept the bytes honestly, or move the guard into the
// lazily-loaded routes file along with the provider.
//
// (Route providers ARE visible to that route's own `canActivate` — measured against Angular 22. Only a
// CHILD route's providers are invisible to a parent's guard. Do not reach for root on the DI argument.)
//
// GENERATOR-OWNED — rewritten in full on every `--sync`. See firebase.config.ts for the full contract.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';

import { emulatorFor, offsetUrl, portOffset } from './firebase.config';

declare const ngDevMode: boolean;

// Emulator wiring must happen ONCE PER SDK INSTANCE — and the latch is keyed to the instance, not to
// this module. A plain module-level boolean looks equivalent and is not: it survives the SDK instance.
// Tear the Firebase app down and re-create it in the same JS realm — `deleteApp()` in a TestBed
// `afterEach`, then provide again — and the boolean still reads `true`, so the NEW instance is never
// connected and silently talks to the REAL backend from a dev/test run. Measured, not theorised.
// A WeakSet keyed on the instance answers the question actually being asked ("has THIS one been
// connected?"), tree-shakes exactly the same way, and cannot outlive what it is tracking.
const emulatorConnected = new WeakSet<object>();

/** Firebase Auth, wired to the Auth emulator in dev when `environment` asks for it. */
export function provideAppAuth(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAuth(() => {
      const auth = getAuth();
      // `if (ngDevMode)` folds to `if (false)` in prod → this block (and emulatorFor) is stripped.
      if (ngDevMode && !emulatorConnected.has(auth)) {
        const e = emulatorFor('auth');
        if (e) {
          // proxied (default for new scaffolds) — point the SDK at the app's OWN origin; proxy.conf.mjs
          // relays the Auth emulator's API prefixes (identitytoolkit / securetoken / googleapis / emulator)
          // to it, offset-shifted. The host browser then needs only the port the app loaded on, and it's
          // inherently port-offset-correct (no offset math). This matters MORE than functions: an app
          // usually gates every route on auth readiness, so a squatted/forwarded :9099 leaves the app blank
          // AND sign-in hanging — one cause, two faces. direct — dial the emulator's own URL, port-shifted.
          const proxied = (e as { proxied?: boolean }).proxied;
          const url =
            proxied && typeof window !== 'undefined'
              ? window.location.origin
              : offsetUrl(e.url, portOffset);
          connectAuthEmulator(auth, url, { disableWarnings: true });
          emulatorConnected.add(auth);
        }
      }
      return auth;
    }),
  ]);
}
