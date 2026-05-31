// Production environment. Selected at build time via
// `targets.build.configurations.production.fileReplacements` in project.json
// (Angular's classic environment-files pattern). `nx build <app>` runs the
// production configuration by default; `nx build <app> --configuration=development`
// keeps the dev `environment.ts` instead.
//
// === To wire a real Firebase project (App Hosting — the framework-aware product) ===
//   1) Log in:                          firebase login
//   2) Link the project:                firebase use --add                                            (picks from your account; writes .firebaserc)
//   3) Create the App Hosting backend:  firebase apphosting:backends:create --project <projectId>     (one-time; interactive)
//   4) Fetch the web config:            firebase apps:sdkconfig WEB <appId> --project <projectId>     (prints the real web config for client-side SDK init)
//   5) Paste the returned firebaseConfig fields below into `firebase`.
//
// After the backend exists, App Hosting deploys are GitHub-driven (push to the
// configured branch). App Hosting build/runtime config lives in
// `apphosting.yaml` at the workspace root.
//
// Do NOT hand-fabricate this. The CLI is the source of truth for cloud state.
// The placeholders below are intentionally empty so a half-wired prod build
// fails LOUDLY at bootstrap (provideAppFirebase() throws with the recipe in
// the error) instead of silently pointing at the wrong project.
import type { Environment } from './environment.interface';

export const environment: Environment = {
  production: true,
  firebase: {
    projectId: '{{projectId}}',
    apiKey: '{{apiKey}}',
    appId: '{{appId}}',
  },
  // Emulator endpoints are kept on the shape so the Environment interface stays
  // identical across env files (simpler types, no `emulators?:`). They're never
  // accessed in production — provideAppFirebase() gates emulator wiring behind
  // `!environment.production`, which @angular/build tree-shakes out of the prod
  // bundle.
  emulators: {
    auth:      'http://localhost:9099',
    firestore: { host: 'localhost', port: 8080 },
    storage:   { host: 'localhost', port: 9199 },
    functions: { host: 'localhost', port: 5001 },
  },
};
