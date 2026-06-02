// Default (dev) environment. Replaced at build time by environment.prod.ts when
// you build with `--configuration=production` (the default `nx build <app>`
// configuration) — see project.json's
// `targets.build.configurations.production.fileReplacements`.
//
// Points the app at the local Firebase emulator suite, which `nx serve` boots
// automatically via the `emulators` continuous task (serve's `dependsOn`). No real
// cloud project, login, or `.firebaserc` needed.
import type { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  // `demo-` is Firebase's convention for "offline only, no cloud calls" — it
  // matches the `--project=demo-{{workspaceName}}` flag the Nx `emulators`
  // targets pass, so emulator data and CLI invocations agree on one id.
  firebase: {
    projectId: 'demo-{{workspaceName}}',
    apiKey: 'demo',
    appId: 'demo',
  },
  // Emulator endpoints. Match `firebase.json` at the workspace root — if you
  // change a port there, change it here too. (Both files speak about the same
  // local emulator suite; there's no auto-sync.)
  emulators: {
    auth:      'http://localhost:9099',
    firestore: { host: 'localhost', port: 8080 },
    storage:   { host: 'localhost', port: 9199 },
    functions: { host: 'localhost', port: 5001 },
  },
};
