// No-emulators dev environment — used by `nx run <app>:serve-no-emulators`, which serves
// the app WITHOUT booting the emulator suite. There is NO `emulators` block, so firebase.config.ts
// wires no emulator connections at all: every service talks to the REAL Firebase project in
// `firebase` below. (A runtime `?emulate=` override is a safe no-op here — there are no local
// endpoints to connect to.)
//
// Fill `firebase` with your real/STAGING web config (NEVER production for services you write to —
// a dev build would mutate live data). For pure UI work that never calls Firebase, leave it empty.
// Get the values with:  firebase apps:sdkconfig WEB <appId> --project <staging-projectId>
//
// production stays `false` (this is a dev build — source maps, no optimization); only
// environment.prod.ts sets it true. This file is written once (preserved across `--repair`).
import type { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  firebase: {
    projectId: '',
    apiKey: '',
    appId: '',
    authDomain: '',
  },
};
