// Firebase AUTH provider — one of the per-service siblings of firebase.config.ts.
//
// Provide it where Auth is actually needed. `provideAppFirebase()` (the Firebase app) must be provided
// at root either way; this adds Auth to whatever injector you put it in:
//
//   app.config.ts                    → Auth in the initial bundle (measured: 342 kB total for a fresh app
//                                      providing this and nothing else, vs 238 kB with none; app-check
//                                      rides in with it)
//   a LAZILY-LOADED routes file      → Auth in that lazy chunk, off the critical path
//
// AUTH IS THE ONE THAT USUALLY BELONGS AT ROOT — and it should be a decision, not a default. A route
// GUARD runs BEFORE the route it protects activates, so it cannot receive Auth from that route's own
// `providers`. An app that gates its routes on sign-in has Auth on its critical path by definition:
// provide it at root and accept the bytes honestly. What does NOT work is writing the provider in a lazy
// routes file while a guard in the EAGER app.routes.ts imports something that reaches for Auth — the
// static import pins @firebase/auth into the initial chunk regardless of where the provider is declared.
//
// GENERATOR-OWNED — rewritten in full on every `--sync`. See firebase.config.ts for the full contract.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';

import { emulatorFor, offsetUrl, portOffset } from './firebase.config';

declare const ngDevMode: boolean;

// Emulator wiring must happen ONCE per underlying SDK instance. `getAuth()` returns the same instance
// every time, but this provider's factory runs once per injector that provides it — and providing a
// service in two sibling lazy routes is a normal thing to do. Re-connecting an already-connected
// instance is at best redundant and at worst throws, so the connect is latched. DEV ONLY: `ngDevMode`
// folds to `false` in prod and this whole concern tree-shakes away.
let emulatorConnected = false;

/** Firebase Auth, wired to the Auth emulator in dev when `environment` asks for it. */
export function provideAppAuth(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAuth(() => {
      const auth = getAuth();
      // `if (ngDevMode)` folds to `if (false)` in prod → this block (and emulatorFor) is stripped.
      if (ngDevMode && !emulatorConnected) {
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
          emulatorConnected = true;
        }
      }
      return auth;
    }),
  ]);
}
