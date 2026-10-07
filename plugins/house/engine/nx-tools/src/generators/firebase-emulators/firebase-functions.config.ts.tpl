// Firebase FUNCTIONS (callables) provider — one of the per-service siblings of firebase.config.ts.
//
// Measured at 327 kB initial for a fresh app providing this and nothing else, against 238 kB with no
// service at all. This is the service most often provided and never used: the house scaffolds a Cloud
// Functions app whether or not the CLIENT ever calls a callable, and an unused provider
// is still a pinned import. Provide it in the lazy routes file of the surface that calls one — or not at
// all until you do.
//
// GENERATOR-OWNED — rewritten in full on every upgrade. See firebase.config.ts for the full contract.
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { getApp } from '@angular/fire/app';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';

import { environment } from '../environments/environment';
import { emulatorEndpoint } from './firebase.config';

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
        // In the browser: the app's own origin (proxy.conf.mjs relays /<projectId>/**, where callables live);
        // server-side: the container address, shifted by the stack's offset. See emulatorEndpoint().
        const e = emulatorEndpoint('functions');
        if (e) {
          connectFunctionsEmulator(functions, e.host, e.port);
          emulatorConnected.add(functions);
        }
      }
      return functions;
    }),
  ]);
}
