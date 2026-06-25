// Firebase initialization for the app.
//
// Reads `src/environments/environment.ts` (Angular's environment-files pattern) and connects each
// service to the local emulator or the real backend, PER SERVICE. The build swaps the environment
// file via project.json fileReplacements:
//   - production               → environment.prod.ts        (no emulators; real project)
//   - serve-no-emulators         → environment.no-emulators.ts  (no emulators; real project)
//   - dev (default / nx serve) → environment.ts             (per-service emulator defaults)
//
// Which services are emulated is `committed default ⊕ per-session override`:
//   - committed default: each `environment.emulators.<service>.default` (the EMULATE map in
//     environment.ts).
//   - per-session override: `?emulate=`/`?real=` in the URL or localStorage — see
//     src/app/emulator-overrides.ts. Lets you run e.g. Firestore emulated + real Auth without a rebuild.
//
// Tree-shaking: EVERY emulator concern here is gated on `ngDevMode` — Angular's dev-mode flag, which
// the optimizer folds to a literal `false` in production builds. That collapses the emulate
// resolution to all-off and the `if (ngDevMode)` wiring blocks to nothing, so the emulator-overrides
// module, the per-service resolver, every `connect*Emulator(...)` call, and all emulator addresses
// are dead-code-eliminated from the production artifact. We deliberately do NOT gate this on
// `environment.production`: that's a const-object property the esbuild-based builder does not reliably
// inline, so it leaves the override resolver in the prod bundle — `ngDevMode` is the only signal the
// Angular optimizer guarantees to fold. This file is generator-owned; never edit it by hand — change
// the committed defaults in environment.ts.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';

import { environment } from '../environments/environment';
import { resolveEmulated, type EmulatorService } from './emulator-overrides';

// Angular's dev-mode flag. The optimizer folds it to a literal `false` in production builds, which
// is what makes everything emulator-related below tree-shakeable out of prod. Declared locally —
// apps don't get a global type for it.
declare const ngDevMode: boolean;

type EmulatorEndpoints = NonNullable<typeof environment.emulators>;

// Resolved per-service emulator on/off (committed defaults ⊕ runtime override) — DEV ONLY. In a
// production build `ngDevMode` folds to `false`, so this becomes the literal all-off object and the
// `resolveEmulated(...)` branch — with the whole emulator-overrides module — is eliminated.
const emulate: Record<EmulatorService, boolean> = ngDevMode
  ? resolveEmulated({
      auth: environment.emulators?.auth?.default ?? false,
      firestore: environment.emulators?.firestore?.default ?? false,
      storage: environment.emulators?.storage?.default ?? false,
      functions: environment.emulators?.functions?.default ?? false,
    })
  : { auth: false, firestore: false, storage: false, functions: false };

// The emulator endpoint to connect a service to, or `undefined` for the real backend. Called only
// inside the `if (ngDevMode)` blocks below, so it (and `emulate`) tree-shake out of prod too.
function emulatorFor<S extends EmulatorService>(service: S): EmulatorEndpoints[S] | undefined {
  return emulate[service] ? environment.emulators?.[service] : undefined;
}

export function provideAppFirebase(): EnvironmentProviders {
  // Fail-loud guard: throws at bootstrap if a PRODUCTION build ships with an unfilled web config, so
  // a half-wired deploy fails fast with the recipe instead of silently misbehaving. This is prod-only
  // RUNTIME behavior (unlike the emulator wiring, it SHOULD ship), so it stays gated on
  // `environment.production` — the production env file sets it `true`; in dev it's false at runtime
  // and never fires.
  if (
    environment.production &&
    (!environment.firebase.projectId ||
      !environment.firebase.apiKey ||
      !environment.firebase.appId ||
      // authDomain is part of the web config and required for any OAuth provider sign-in (popup and
      // redirect both refuse without it).
      !environment.firebase.authDomain)
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
      // `if (ngDevMode)` folds to `if (false)` in prod → this block (and emulatorFor) is stripped.
      if (ngDevMode) {
        const e = emulatorFor('auth');
        if (e) connectAuthEmulator(auth, e.url, { disableWarnings: true });
      }
      return auth;
    }),
    provideFirestore(() => {
      const db = getFirestore();
      if (ngDevMode) {
        const e = emulatorFor('firestore');
        if (e) connectFirestoreEmulator(db, e.host, e.port);
      }
      return db;
    }),
    provideStorage(() => {
      const storage = getStorage();
      if (ngDevMode) {
        const e = emulatorFor('storage');
        if (e) connectStorageEmulator(storage, e.host, e.port);
      }
      return storage;
    }),
    provideFunctions(() => {
      const functions = getFunctions();
      if (ngDevMode) {
        const e = emulatorFor('functions');
        if (e) connectFunctionsEmulator(functions, e.host, e.port);
      }
      return functions;
    }),
  ]);
}
