// Firebase initialization for the app — the APP ITSELF, and the shared pieces every service needs.
//
// ── ONE FILE PER SERVICE, SPLIT BY WHEN THE SERVICE IS NEEDED ────────────────────────────────────
//
// This file provides the Firebase *app* (`initializeApp`) and nothing else. Each SDK service lives in
// its own sibling, generated beside this one:
//
//   provideAppAuth()       firebase-auth.config.ts
//   provideAppFirestore()  firebase-firestore.config.ts
//   provideAppStorage()    firebase-storage.config.ts
//   provideAppFunctions()  firebase-functions.config.ts
//
// WHY SEPARATE FILES rather than separate exports here: a static import is what pins a chunk. Splitting
// into exports would let an UNUSED service tree-shake, but it cannot DEFER a used one — a route's
// `providers` array sitting in an eagerly-loaded app.routes.ts still imports whatever it names, and that
// import lands in the initial bundle. A service only leaves the critical path when the `provideX` call
// lives in a file that ONLY a lazy chunk imports. One file per service is what makes that possible.
//
// So provide each service where it is actually needed:
//
//   • at ROOT (app.config.ts) — for a service the app cannot reach first paint without. It is then in
//     the initial bundle, which is the correct place for something bootstrap genuinely needs.
//   • in a LAZY ROUTE's `providers` — for everything else. Put the `providers: [provideAppFirestore()]`
//     inside the LAZILY-LOADED routes file (the one behind `loadChildren`), not in the eager app.routes.ts,
//     or the import pins the chunk anyway and nothing is saved.
//
// Rough weight of each service on the initial chunk when it is provided at root (raw, uncompressed):
// firestore ~235 kB (its webchannel transport included) · auth ~85 kB (pulls app-check in with it) ·
// storage ~22 kB · functions ~35 kB. This file's own cost is ~23 kB (@firebase/app + @firebase/util).
//
// AUTH IS THE SHARP ONE. A route guard runs BEFORE its route activates, so a guard that needs Auth
// cannot get it from the providers of the route it is guarding. An auth-gated app either provides Auth
// at root (honest: that app's critical path really does include Auth) or keeps its guard in a lazily
// loaded routes file. A guard imported by the eager app.routes.ts drags Auth into the initial chunk no
// matter where the provider is written.
//
// ── EMULATORS ────────────────────────────────────────────────────────────────────────────────────
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
// Tree-shaking: EVERY emulator concern here (and in the per-service siblings) is gated on `ngDevMode` —
// Angular's dev-mode flag, which the optimizer folds to a literal `false` in production builds. That
// collapses the emulate resolution to all-off and the `if (ngDevMode)` wiring blocks to nothing, so the
// emulator-overrides module, the per-service resolver, every `connect*Emulator(...)` call, and all
// emulator addresses are dead-code-eliminated from the production artifact. We deliberately do NOT gate
// this on `environment.production`: that's a const-object property the esbuild-based builder does not
// reliably inline, so it leaves the override resolver in the prod bundle — `ngDevMode` is the only signal
// the Angular optimizer guarantees to fold.
//
// GENERATOR-OWNED — this file (and every firebase-*.config.ts sibling) is rewritten IN FULL on every
// `--sync`, so never edit them by hand: a future sync silently reverts it. They carry no per-project
// values by design, so everything you'd want to change lives elsewhere:
//   • per-environment CONFIG (emulator toggles, the `firebase` web config, `databaseId`, `functionsRegion`,
//     functions `proxied`) → environment.ts / environment.<env>.ts;
//   • WHICH services are provided, and WHERE → app.config.ts and your lazy routes.
// Because they hold no config, they are safe to always rewrite — which is exactly what keeps them from
// silently drifting behind template improvements (there is no "is it customized?" guess to get wrong).
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';

import { environment } from '../environments/environment';
import { resolveEmulated, resolvePortOffset, type EmulatorService } from './emulator-overrides';

// Angular's dev-mode flag. The optimizer folds it to a literal `false` in production builds, which
// is what makes everything emulator-related below tree-shakeable out of prod. Declared locally —
// apps don't get a global type for it.
declare const ngDevMode: boolean;

/** The `environment.emulators` block, non-optional — the per-service endpoint records. */
export type EmulatorEndpoints = NonNullable<typeof environment.emulators>;

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

/**
 * The emulator endpoint to connect a service to, or `undefined` for the real backend. Called only from
 * inside `if (ngDevMode)` blocks (here and in the per-service siblings), so it — and `emulate` — tree-shake
 * out of production along with the callers.
 */
export function emulatorFor<S extends EmulatorService>(service: S): EmulatorEndpoints[S] | undefined {
  return emulate[service] ? environment.emulators?.[service] : undefined;
}

/**
 * Per-session emulator PORT OFFSET (0 unless the app was opened with `?portOffset=`). It shifts every
 * emulator port so the app connects to an ISOLATED stack (started by `<app>:serve --portOffset`) rather
 * than the base ports. DEV ONLY — `ngDevMode` folds to `false` in prod, collapsing this to 0 and
 * tree-shaking `resolvePortOffset` out with the rest.
 */
export const portOffset: number = ngDevMode ? resolvePortOffset() : 0;

/**
 * Shift the port inside an emulator URL (Auth is configured by URL, not host+port). Only reached from
 * inside `if (ngDevMode)` blocks, so it tree-shakes out of prod.
 */
export function offsetUrl(url: string, offset: number): string {
  if (!offset) return url;
  try {
    const u = new URL(url);
    if (u.port) u.port = String(Number(u.port) + offset);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * The Firebase APP — `initializeApp(environment.firebase)` and the bootstrap-time config guards.
 *
 * Provide this at ROOT (app.config.ts). Every service provider (`provideAppAuth()`,
 * `provideAppFirestore()`, …) calls `getApp()`, so the app must be initialised in an injector at or
 * above wherever the service is provided — root is the only place that is true for all of them.
 */
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

  return makeEnvironmentProviders([provideFirebaseApp(() => initializeApp(environment.firebase))]);
}
