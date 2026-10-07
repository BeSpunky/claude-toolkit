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
// MEASURED initial-bundle totals for a freshly scaffolded house app (raw, uncompressed): 207 kB with no
// Firebase at all, 238 kB providing this file alone, and 479 kB with all four services at root — which is
// what this file used to return on its own. Per service, the total with THAT service and nothing else:
// firestore 413 kB · auth 342 kB · storage 336 kB · functions 327 kB.
//
// THOSE NUMBERS DO NOT ADD UP, and it matters. About 74 kB of whichever service you provide FIRST is a
// one-time @angular/fire base that all four then share, so the first costs ~89–174 kB and each one after
// it is far cheaper (measured increments once the base is paid: auth ~29, firestore ~100, storage ~24,
// functions ~15). The four deltas sum to ~464 kB while all four together cost ~240 kB. Practically: the
// saving is largest for a bundle that needs NO service on the critical path, and shrinks — it does not
// vanish — once one is there. Deferring is not quite free either: splitting hoists @firebase/app into a
// shared chunk, which cost ~9 kB on the initial bundle in the measured case.
//
// AUTH IS THE SHARP ONE, AND THE REASON IS BUNDLING, NOT INJECTION. A guard NAMED in the eager
// app.routes.ts is statically imported by the initial chunk, so its `inject(Auth)` pulls
// @angular/fire/auth in there no matter where the provider is written. An auth-gated app therefore has
// Auth on its critical path by construction: provide it at root and accept that honestly, or move the
// guard itself into the lazily-loaded routes file.
//
// (An earlier version of this note claimed a guard cannot RECEIVE Auth from the providers of the route
// it guards. That is false, and it was measured: Angular resolves `canActivate` — and `canMatch` and
// `resolve` — against the route's OWN providers injector. What a guard cannot see is a CHILD route's
// providers. The bundling argument above is the real one and stands on its own.)
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
// emulator-overrides module, the per-service resolver and every `connect*Emulator(...)` call this file
// and its siblings make are dead-code-eliminated from the production artifact. (The emulator ADDRESSES
// are absent for a different reason — environment.prod.ts simply has no `emulators` block. Add one and
// they ship as data, gate or no gate. And `connectFirestoreEmulator` still appears once in any Firestore
// build: it is a warning string inside the SDK's own retained code, not ours.) We deliberately do NOT gate
// this on `environment.production`: that's a const-object property the esbuild-based builder does not
// reliably inline, so it leaves the override resolver in the prod bundle — `ngDevMode` is the only signal
// the Angular optimizer guarantees to fold.
//
// GENERATOR-OWNED — this file (and every firebase-*.config.ts sibling) is rewritten IN FULL on every
// an upgrade, so never edit them by hand: a future sync silently reverts it. They carry no per-project
// values by design, so everything you'd want to change lives elsewhere:
//   • per-environment CONFIG (emulator toggles, the `firebase` web config, `databaseId`, `functionsRegion`)
//     → environment.ts / environment.<env>.ts;
//   • WHICH services are provided, and WHERE → app.config.ts and your lazy routes.
// Because they hold no config, they are safe to always rewrite — which is exactly what keeps them from
// silently drifting behind template improvements (there is no "is it customized?" guess to get wrong).
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';

import { environment } from '../environments/environment';
import { resolveEmulated, type EmulatorService } from './emulator-overrides';

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

/** Where THIS runtime reaches an emulator — what each `connect*Emulator(...)` call is handed. */
export interface EmulatorEndpoint {
  host: string;
  port: number;
  /** `http://host:port` — Auth is connected by URL, the other services by host + port. */
  origin: string;
}

/**
 * The endpoint to connect a service's emulator to, or `undefined` for the real backend. Called only from inside
 * `if (ngDevMode)` blocks (in the per-service siblings), so it — and `emulate` — tree-shake out of production.
 *
 * WHERE AN EMULATOR IS REACHED FROM DEPENDS ON WHERE THE CALLER RUNS, not on the service:
 *   • IN THE BROWSER — through the page's OWN origin. The dev server's proxy.conf.mjs relays every emulator's
 *     paths to the suite inside the container (shifted for a worktree's stack), so the browser needs no emulator
 *     port and no offset: only the address the app loaded on, whatever port the editor forwarded it to.
 *   • ON THE SERVER (SSR) — directly, at the container address in environment.ts, shifted by the stack's
 *     PORT_OFFSET, which the dev engine exports to every process of a shifted stack.
 * WHETHER a service is emulated is decided once, the same way in both (see emulator-overrides.ts): the browser
 * reads the URL the dev engine opened (`?emulate=none` when the suite is skipped), the server the same query from
 * the engine's DEV_URL_QUERY — so a server render and the page it hydrates talk to the same backend.
 */
export function emulatorEndpoint(service: EmulatorService): EmulatorEndpoint | undefined {
  const entry = emulate[service] ? environment.emulators?.[service] : undefined;
  if (!entry) return undefined;
  if (typeof window === 'undefined') return containerEndpoint(entry);
  checkTheRelay(service, window.location);
  return { host: window.location.hostname, port: Number(window.location.port) || 80, origin: window.location.origin };
}

/**
 * What the emulator hub says, through the page's origin, about the running suite: the emulators it runs, or the
 * sentence that explains why it could not be asked. Asked once per page load, by the first emulated service.
 */
let hubAnswer: Promise<string[] | string> | undefined;
/** Each sentence is said once, however many services it concerns. */
const said = new Set<string>();

/**
 * Check, for one emulated service, the relay it depends on — and say out loud, in the console, the three ways it
 * goes quiet otherwise: the page is served over https (the SDK dials an emulator over http only), the dev server
 * does not relay (its proxy config leaves proxy.conf.mjs's routes out: Firestore would hang offline, Auth fail with
 * a network error), or the suite does not run that emulator. A console error, never a throw — the same policy as
 * the dev guard in provideAppFirebase(): one broken service must not brick the dev app, and the error names the fix.
 */
function checkTheRelay(service: EmulatorService, page: Location): void {
  const say = (sentence: string): void => {
    if (said.has(sentence)) return;
    said.add(sentence);
    console.error(`[firebase.config.ts] ${sentence}`);
  };
  if (page.protocol !== 'http:') {
    say(
      `Emulated Firebase services will not connect: this page is served over ${page.protocol.replace(':', '')}, the ` +
        `browser reaches every emulator through the page's own origin, and the Firebase SDK reaches an emulator over ` +
        `plain http only.\n  Serve the dev server over http locally (drop \`ssl\` from its dev-server target), or open ` +
        `the app with ?emulate=none to use the real backend for every service.`,
    );
    return;
  }
  hubAnswer ??= fetch(`${page.origin}/__bespunky/emulator-hub/emulators`, { cache: 'no-store' }).then(
    async (response) => {
      if (response.ok && (response.headers.get('content-type') ?? '').includes('json')) {
        return Object.keys((await response.json()) as Record<string, unknown>);
      }
      return response.status >= 500
        ? `Emulated Firebase services will not connect: the emulator suite is not answering behind the dev server ` +
            `(HTTP ${response.status}) — is it running? \`nx serve\` starts it beside the app; served with ` +
            `--no-emulators, every service should resolve real (?emulate=none).`
        : `Emulated Firebase services will not connect: the dev server does not relay the emulators (HTTP ` +
            `${response.status} for the hub route). Its proxyConfig must be this app's proxy.conf.mjs — your own ` +
            `routes go in proxy.local.mjs beside it — or a config of yours that includes its \`emulatorRoutes\`.`;
    },
    (error: unknown) => `The emulator hub could not be asked through this page's origin (${String(error)}).`,
  );
  void hubAnswer.then((answer) => {
    if (typeof answer === 'string') say(answer);
    else if (!answer.includes(service)) {
      say(
        `${service} is emulated, but the running suite has no ${service} emulator (it runs: ${answer.join(', ')}). ` +
          `Enable it in firebase.json, or use the real ${service} with ?real=${service}.`,
      );
    }
  });
}

/** Server-side code's route: the container address from environment.ts, shifted by the stack's PORT_OFFSET. */
function containerEndpoint(entry: { url: string } | { host: string; port: number }): EmulatorEndpoint {
  const base = 'url' in entry ? new URL(entry.url) : { hostname: entry.host, port: String(entry.port) };
  const host = base.hostname;
  const port = Number(base.port) + serverPortOffset();
  return { host, port, origin: `http://${host}:${port}` };
}

/** The stack's PORT_OFFSET from the server's environment (0 for the base stack, and wherever there is no `process`). */
function serverPortOffset(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const offset = Number(env?.['PORT_OFFSET'] ?? 0);
  return Number.isInteger(offset) && offset > 0 ? offset : 0;
}

/**
 * The Firebase APP — `initializeApp(environment.firebase)` and the bootstrap-time config guards.
 *
 * Provide this at ROOT (app.config.ts). Every service provider (`provideAppAuth()`,
 * `provideAppFirestore()`, …) resolves the default Firebase app from the SDK when its factory runs, so the
 * app must already be initialised in an injector at or above wherever the service is provided — root is
 * the only place that is true for all of them.
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
        '  Paste the returned firebaseConfig fields into src/environments/environment.prod.ts (in this app) and rebuild.'
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
