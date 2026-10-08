// Default (dev) environment — used by `nx serve <app>`, whose `serve` executor runs the app
// dev-server + the local emulator suite (`firebase:emulators`) in parallel. No real cloud project,
// login, or `.firebaserc` is needed when every service is emulated.
//
// Going all-real is a RUNTIME choice, not a separate env file: append `?emulate=none` (or `?real=all`)
// to the URL — every service then resolves to the `firebase` block below — and `serve --no-emulators`
// skips booting the suite. See src/app/emulator-overrides.ts.
//
// Build-time swap (Angular's environment-files pattern, via project.json fileReplacements):
//   - `nx build <app>` (production)  → environment.prod.ts
import type { Environment } from './environment.interface';

// ── Per-service emulator toggle (committed default for the whole team) ───────────────────────────
// Flip any to `false` to use the REAL Firebase backend for that service instead of the local
// emulator. Saving hot-reloads the dev server (~1s) — but committing a service real (or the last one back) moves the
// app onto another project id, so RESTART the stack too: the running suite says so, with the command. Example —
// Firestore emulated, real Auth:
//     auth: false        (then fill `firebase` below with real/STAGING web config so real Auth works)
// Prefer per-SESSION toggling without editing this file: append `?real=auth` or
// `?emulate=firestore,storage` to the URL, or `localStorage.setItem('emulate','firestore')`.
// See src/app/emulator-overrides.ts for the full override syntax and precedence.
const EMULATE = {
  auth: true,
  firestore: true,
  storage: true,
  functions: true,
};
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export const environment: Environment = {
  production: false,
  // `demo-` is Firebase's convention for "offline only, no cloud calls." Fill in your real/STAGING
  // web config the moment you turn any service to real (above) — the demo values only work against
  // the emulators. Emulating stays OFFLINE either way: the suite (tools/emulators.sh) and this app
  // (firebase.config.ts) both run under the `demo-` twin of this id (`my-app` → `demo-my-app`), and
  // switch to the real id only when the EMULATE map above commits a service to the real backend.
  firebase: {
    projectId: 'demo-{{workspaceName}}',
    apiKey: 'demo',
    appId: 'demo',
    // Required for ANY OAuth provider sign-in (Google, etc.) — the SDK refuses popup AND redirect
    // flows without an authDomain, even against the Auth emulator. Never resolved in dev when Auth
    // is emulated (the emulator intercepts the flow); it just has to be present.
    authDomain: 'demo-{{workspaceName}}.firebaseapp.com',
  },
  // Each emulated service's `default` comes from EMULATE above; the entry is always present so a runtime
  // `?emulate=<service>` can switch a defaulted-off service back on.
  //
  // THE BROWSER NEVER DIALS THESE ADDRESSES. In the browser every emulator is reached through the dev server's
  // OWN origin — its proxy.conf.mjs relays each one to the suite inside the container, shifted for a worktree's
  // stack — so a host browser needs only the port the app loaded on, whatever the editor forwarded it to. The
  // addresses below are where the suite listens INSIDE the container: what server-side code (SSR) dials, shifted
  // by the stack's PORT_OFFSET. Keep them in step with firebase.json at the workspace root.
  emulators: {
    auth: { url: 'http://localhost:9099', default: EMULATE.auth },
    firestore: { host: 'localhost', port: 8080, default: EMULATE.firestore },
    storage: { host: 'localhost', port: 9199, default: EMULATE.storage },
    functions: { host: 'localhost', port: 5001, default: EMULATE.functions },
  },
};
