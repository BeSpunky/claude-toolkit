// Shape every environment file must satisfy. Kept as a real interface (not
// inferred from one file) so TypeScript sees the same widened types in
// environment.ts, environment.no-emulators.ts and environment.prod.ts.
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
// and environment.no-emulators.ts omit it → every service talks to the real backend).
// Each service that CAN be emulated carries its local endpoint AND its committed
// `default` (whether it's emulated out of the box). The endpoint is always present
// even when `default` is false, so a runtime `?emulate=<service>` override can turn
// it on too. firebase.config.ts resolves `default ⊕ runtime-override` (see
// src/app/emulator-overrides.ts) and connects each service to its emulator only when
// the result is ON — and only in dev. A service that resolves OFF (or has no entry
// here) uses the real project in `firebase`, so fill that with real/STAGING
// credentials before turning one off.
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
  };
  // This interface is app-owned after the first scaffold (the generator writes it only if absent):
  // add app-specific top-level fields here freely — e.g. `google?: { oauthClientId: string }` for a
  // Google API (Calendar) OAuth client id. They survive `--repair`.
  emulators?: {
    auth?: { url: string; default: boolean };
    firestore?: { host: string; port: number; default: boolean };
    storage?: { host: string; port: number; default: boolean };
    functions?: { host: string; port: number; default: boolean };
  };
}
