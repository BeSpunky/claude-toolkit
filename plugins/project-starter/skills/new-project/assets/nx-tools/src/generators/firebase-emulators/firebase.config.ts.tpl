// Firebase initialization for the app.
//
// Reads `src/environments/environment.ts` (Angular's environment-files pattern) and connects each
// service to the local emulator or the real backend, PER SERVICE. The build swaps the environment
// file via project.json fileReplacements:
//   - production               → environment.prod.ts   (no emulators; real project)
//   - dev (default / nx serve) → environment.ts        (per-service emulator defaults)
//
// Which services are emulated is `committed default ⊕ per-session override`:
//   - committed default: each `environment.emulators.<service>.default` (the EMULATE map in
//     environment.ts).
//   - per-session override: `?emulate=`/`?real=` in the URL or localStorage — see
//     src/app/emulator-overrides.ts. Lets you run e.g. Firestore emulated + real Auth without a rebuild,
//     or go FULLY real with `?emulate=none` / `?real=all` (every service → the `firebase` block; this is
//     what `serve --no-emulators` relies on — there's no separate no-emulators env file or build config).
//
// Tree-shaking: EVERY emulator concern here is gated on `ngDevMode` — Angular's dev-mode flag, which
// the optimizer folds to a literal `false` in production builds. That collapses the emulate
// resolution to all-off and the `if (ngDevMode)` wiring blocks to nothing, so the emulator-overrides
// module, the per-service resolver, every `connect*Emulator(...)` call, and all emulator addresses
// are dead-code-eliminated from the production artifact. We deliberately do NOT gate this on
// `environment.production`: that's a const-object property the esbuild-based builder does not reliably
// inline, so it leaves the override resolver in the prod bundle — `ngDevMode` is the only signal the
// Angular optimizer guarantees to fold.
//
// GENERATOR-OWNED — this file is rewritten IN FULL on every `--repair`, so never edit it by hand: a
// future repair silently reverts it. It carries no per-project values by design, so everything you'd want
// to change lives elsewhere:
//   • per-environment CONFIG (emulator toggles, the `firebase` web config, `databaseId`, `functionsRegion`,
//     functions `proxied`) → environment.ts / environment.<env>.ts;
//   • app-specific PROVIDERS → app.config.ts, added beside `provideAppFirebase()`.
// Because it holds no config, it is safe to always rewrite — which is exactly what keeps it from silently
// drifting behind template improvements (there is no "is it customized?" guess to get wrong).
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { getApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';

import { environment } from '../environments/environment';
import { resolveEmulated, resolvePortOffset, type EmulatorService } from './emulator-overrides';

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

// Per-session emulator PORT OFFSET (0 unless the app was opened with `?portOffset=`). It shifts
// every emulator port so the app connects to an ISOLATED stack (started by
// `<app>:serve --portOffset`) rather than the base ports. DEV ONLY — `ngDevMode` folds to
// `false` in prod, collapsing this to 0 and tree-shaking `resolvePortOffset` out with the rest.
const portOffset: number = ngDevMode ? resolvePortOffset() : 0;

// Shift the port inside an emulator URL (Auth is configured by URL, not host+port). Only reached
// from inside the `if (ngDevMode)` blocks below, so it tree-shakes out of prod.
function offsetUrl(url: string, offset: number): string {
  if (!offset) return url;
  try {
    const u = new URL(url);
    if (u.port) u.port = String(Number(u.port) + offset);
    return u.toString();
  } catch {
    return url;
  }
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

  // Dev guard: a service set to REAL (auth: false in the EMULATE map, or ?real=/?emulate= at runtime)
  // talks to the real Firebase backend, which needs real credentials. The `demo` placeholder only
  // works against the emulators, so a real service + demo config fails cryptically
  // (`auth/api-key-not-valid`, etc.). Surface it at bootstrap with a LOUD, actionable console error —
  // deliberately NOT a throw: bricking the whole dev app over one misconfigured service is worse than
  // the cryptic error it replaces. The app still loads; the developer sees exactly what to fix. Dev-only
  // (`ngDevMode` → tree-shaken from prod, where the separate prod guard above DOES throw to stop a
  // broken deploy).
  if (ngDevMode) {
    const usingDemoConfig =
      environment.firebase.apiKey === 'demo' || environment.firebase.projectId.startsWith('demo-');
    const realServices = (['auth', 'firestore', 'storage', 'functions'] as EmulatorService[]).filter(
      (service) => !emulate[service]
    );
    if (usingDemoConfig && realServices.length > 0) {
      console.error(
        `[firebase.config.ts] ${realServices.join(', ')} ${realServices.length > 1 ? 'are' : 'is'} set to use the REAL ` +
          `Firebase backend, but environment.ts still has the demo config (apiKey: 'demo'). The demo values only work ` +
          `against the emulators, so the real backend rejects them (e.g. auth/api-key-not-valid).\n` +
          `  Fill the \`firebase\` block in src/environments/environment.ts with your real/STAGING web config:\n` +
          `    firebase login\n` +
          `    firebase apps:sdkconfig WEB <appId> --project <your-staging-project>\n` +
          `  …or keep emulating the service (set it back to true in the EMULATE map / drop the ?real=/?emulate= override).`
      );
    }
  }

  return makeEnvironmentProviders([
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const auth = getAuth();
      // `if (ngDevMode)` folds to `if (false)` in prod → this block (and emulatorFor) is stripped.
      if (ngDevMode) {
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
        }
      }
      return auth;
    }),
    provideFirestore(() => {
      // Target a named Firestore database when the environment names one (a per-environment build — e.g.
      // environment.staging.ts with `databaseId: 'staging'` — isolates that env's client data in the same
      // project); omitted → the project's `(default)` database.
      const databaseId = (environment.firebase as { databaseId?: string }).databaseId;
      const db = databaseId ? getFirestore(getApp(), databaseId) : getFirestore();
      if (ngDevMode) {
        const e = emulatorFor('firestore');
        if (e) connectFirestoreEmulator(db, e.host, e.port + portOffset);
      }
      return db;
    }),
    provideStorage(() => {
      const storage = getStorage();
      if (ngDevMode) {
        const e = emulatorFor('storage');
        if (e) connectStorageEmulator(storage, e.host, e.port + portOffset);
      }
      return storage;
    }),
    provideFunctions(() => {
      // Optional per-environment callable region (e.g. a staging build pinned to europe-west1). Read
      // defensively so a project whose interface predates this field still compiles — it's optional config,
      // not logic. Omitted → the SDK default region.
      const region = (environment.firebase as { functionsRegion?: string }).functionsRegion;
      const functions = region ? getFunctions(getApp(), region) : getFunctions();
      if (ngDevMode) {
        const e = emulatorFor('functions');
        if (e) {
          // Two ways to reach the Functions emulator (see environment.ts's `proxied`):
          //   • proxied (default for new scaffolds) — connect to the app's OWN origin; the dev-server's
          //     proxy.conf.mjs relays /<projectId>/** to the emulator, shifted by the same PORT_OFFSET.
          //     Dodges a squatted/forwarded :5001 on the host and is inherently port-offset-correct, so it
          //     needs no `portOffset` math here.
          //   • direct — dial the emulator host:port, shifted by the session port offset.
          const proxied = (e as { proxied?: boolean }).proxied;
          if (proxied && typeof window !== 'undefined') {
            const port = Number(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80);
            connectFunctionsEmulator(functions, window.location.hostname, port);
          } else {
            connectFunctionsEmulator(functions, e.host, e.port + portOffset);
          }
        }
      }
      return functions;
    }),
  ]);
}
