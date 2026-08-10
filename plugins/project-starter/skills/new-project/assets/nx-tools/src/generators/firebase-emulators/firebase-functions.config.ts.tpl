// Firebase FUNCTIONS (callables) provider — one of the per-service siblings of firebase.config.ts.
//
// Measured at 327 kB initial for a fresh app providing this and nothing else, against 238 kB with no
// service at all. This is the service most often provided and never used: the house scaffolds a Cloud
// Functions app (apps/functions) whether or not the CLIENT ever calls a callable, and an unused provider
// is still a pinned import. Provide it in the lazy routes file of the surface that calls one — or not at
// all until you do.
//
// GENERATOR-OWNED — rewritten in full on every `--sync`. See firebase.config.ts for the full contract.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { getApp } from '@angular/fire/app';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';

import { environment } from '../environments/environment';
import { emulatorFor, portOffset } from './firebase.config';

declare const ngDevMode: boolean;

// Emulator wiring must happen ONCE PER SDK INSTANCE — and the latch is keyed to the instance, not to
// this module. A plain module-level boolean looks equivalent and is not: it survives the SDK instance.
// Tear the Firebase app down and re-create it in the same JS realm — `deleteApp()` in a TestBed
// `afterEach`, then provide again — and the boolean still reads `true`, so the NEW instance is never
// connected and silently talks to the REAL backend from a dev/test run. Measured, not theorised.
// A WeakSet keyed on the instance answers the question actually being asked ("has THIS one been
// connected?"), tree-shakes exactly the same way, and cannot outlive what it is tracking.
const emulatorConnected = new WeakSet<object>();

/** Callable Cloud Functions, wired to the Functions emulator in dev when `environment` asks for it. */
export function provideAppFunctions(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFunctions(() => {
      // Optional per-environment callable region (e.g. a staging build pinned to europe-west1). Read
      // defensively so a project whose interface predates this field still compiles — it's optional config,
      // not logic. Omitted → the SDK default region.
      const region = (environment.firebase as { functionsRegion?: string }).functionsRegion;
      const functions = region ? getFunctions(getApp(), region) : getFunctions();
      if (ngDevMode && !emulatorConnected.has(functions)) {
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
          emulatorConnected.add(functions);
        }
      }
      return functions;
    }),
  ]);
}
