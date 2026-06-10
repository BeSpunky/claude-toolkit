// Cloud Functions entry point — `nx build functions` bundles this file (esbuild, CJS)
// into dist/apps/functions, which is what the functions emulator loads and what
// `nx run functions:deploy` ships to the cloud.
//
// Module boundaries: this is a `platform:server` project — the server-only
// `firebase-admin` / `firebase-functions` SDKs may ONLY be imported here (never in
// browser/Angular code), and the browser `firebase` / `@angular/*` packages are banned
// here. ESLint enforces both directions.
//
// The starter export below proves the build → emulate → deploy pipeline end-to-end.
// Replace it with your real functions; keep using the v2 API (firebase-functions/v2/*).
import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

/** Minimal health-check callable: `httpsCallable(getFunctions(), 'ping')()` from the app. */
export const ping = onCall(() => {
  logger.info('ping');
  return { ok: true };
});
