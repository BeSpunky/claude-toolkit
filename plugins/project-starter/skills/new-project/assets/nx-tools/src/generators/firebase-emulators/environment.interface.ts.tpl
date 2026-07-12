// Shape every environment file must satisfy. Kept as a real interface (not
// inferred from one file) so TypeScript sees the same widened types in
// environment.ts and environment.prod.ts.
//
// `authDomain` is required for any OAuth provider sign-in (popup and redirect
// both refuse to run without it — including against the Auth emulator). It's
// optional in the type only so older user-owned environment files keep
// compiling across `--repair`; every generated file fills it in.
//
// `messagingSenderId` / `vapidKey` are only needed for FCM web push — add them
// to the real-project environment files (from `firebase apps:sdkconfig`) when used.
//
// `emulators` is PER-SERVICE and the whole block is OPTIONAL (environment.prod.ts
// omits it → every service talks to the real backend). Each service that CAN be
// emulated carries its local endpoint AND its committed `default` (whether it's
// emulated out of the box). The endpoint is always present even when `default` is
// false, so a runtime `?emulate=<service>` override can turn it on too.
// firebase.config.ts resolves `default ⊕ runtime-override` (see
// src/app/emulator-overrides.ts) and connects each service to its emulator only when
// the result is ON — and only in dev. A service that resolves OFF (or has no entry
// here) uses the real project in `firebase` — the SINGLE "go real" path, whether that
// happens per-service (EMULATE map) or wholesale (`?emulate=none` / `?real=all`), so
// fill `firebase` with real/STAGING credentials before turning one off.
export interface Environment {
  production: boolean;
  firebase: {
    projectId: string;
    apiKey: string;
    appId: string;
    authDomain?: string;
    storageBucket?: string;
    messagingSenderId?: string;
    measurementId?: string;
    vapidKey?: string;
    // Named Firestore database to target within the project (Firestore multi-database). Omit → the
    // project's `(default)` database. Set it (e.g. `'staging'`) so a per-environment build points at an
    // isolated DB in the SAME project (see environment.staging.ts, added by `--staging`). firebase.config.ts
    // reads this to pick `getFirestore(app, databaseId)` vs `getFirestore()`. Requires a matching entry in
    // firebase.json's `firestore` array + the named DB created in the console.
    databaseId?: string;
    // Cloud Functions callable region (e.g. 'us-central1', 'europe-west1'). Set it so a per-environment
    // build pins callables to a region; omit → the SDK default. firebase.config.ts reads this to pick
    // getFunctions(app, region). Configuration, not logic — it's the reason firebase.config.ts (which is
    // generator-owned and rewritten every --repair) never needs a hand-edit for region.
    functionsRegion?: string;
  };
  // This interface is app-owned after the first scaffold (the generator writes it only if absent):
  // add app-specific top-level fields here freely — e.g. `google?: { oauthClientId: string }` for a
  // Google API (Calendar) OAuth client id. They survive `--repair`.
  emulators?: {
    auth?: { url: string; default: boolean };
    firestore?: { host: string; port: number; default: boolean };
    storage?: { host: string; port: number; default: boolean };
    // `proxied` (functions only): reach the emulator through the dev-server's OWN origin (its
    // proxy.conf.mjs relays callables, offset-shifted) instead of dialing host:port directly — dodges a
    // squatted/forwarded :5001 on the host and stays correct under worktree port offsets. Omitted → direct.
    functions?: { host: string; port: number; default: boolean; proxied?: boolean };
  };
}
