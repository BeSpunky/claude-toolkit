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

// Latched so the emulator is connected once per SDK instance even when this provider is used in more
// than one injector — see firebase-auth.config.ts for the full note. DEV ONLY.
let emulatorConnected = false;

/** Callable Cloud Functions, wired to the Functions emulator in dev when `environment` asks for it. */
export function provideAppFunctions(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFunctions(() => {
      // Optional per-environment callable region (e.g. a staging build pinned to europe-west1). Read
      // defensively so a project whose interface predates this field still compiles — it's optional config,
      // not logic. Omitted → the SDK default region.
      const region = (environment.firebase as { functionsRegion?: string }).functionsRegion;
      const functions = region ? getFunctions(getApp(), region) : getFunctions();
      if (ngDevMode && !emulatorConnected) {
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
          emulatorConnected = true;
        }
      }
      return functions;
    }),
  ]);
}
