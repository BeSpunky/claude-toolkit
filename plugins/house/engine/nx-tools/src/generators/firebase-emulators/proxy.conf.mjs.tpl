// Dev-server proxy — the browser reaches EVERY Firebase emulator through the app's OWN origin, and this file
// relays each one to the suite inside the container. GENERATOR-OWNED (rewritten on every upgrade); don't edit.
// YOUR OWN ROUTES (an /api relay, say) go in proxy.local.mjs beside this file — seeded once, never rewritten, and
// merged below — or, if the dev server must keep a proxy config of its own, include `emulatorRoutes` from here
// in it (see the end of this file).
//
// Why: the browser is the one party that cannot know the emulators' ports. It runs on the HOST, where the editor
// forwards container ports to whatever host port is free (4200→4201, 8080→8081, …) without telling anything in
// the container; and on a worktree's shifted stack every emulator sits at basePort + offset. The page's own
// origin is the one address that is right in every one of those cases — the browser just loaded the app from
// it. So firebase.config.ts connects every emulated service to `location`, and this table sends each service's
// paths on to its emulator:
//   - Auth — its Google-API-shaped prefixes. All four are needed: sign-in (identitytoolkit), the per-session
//     ID-token refresh (securetoken — long after sign-in), the legacy relyingparty API (www.googleapis.com), and
//     /emulator/ (config + the popup/redirect OAuth handler).
//   - Firestore — its WebChannel streams (Listen/Write, under /google.firestore.v1.Firestore/) and its unary REST
//     calls (commit, batchGet, runQuery…, under /v1/projects/<any id>/databases/). Plain HTTP streaming, which
//     the dev server's proxy passes through unbuffered.
//   - Storage — /v0/b/. Its resumable upload hands the browser an ABSOLUTE upload URL built from the Host header
//     the emulator saw — the emulator's own port behind a plain relay, 127.0.0.1:<port> behind the worktree-domains
//     proxy — so the relay rewrites it to a path, which the browser resolves against the page's origin.
//   - Functions callables — /<any id>/<a Cloud Functions region>/<function>.
//   - The emulator hub's list of running emulators, at /__bespunky/emulator-hub/emulators — firebase.config.ts
//     asks it once at startup, so a dev server that does NOT relay (a proxy config that leaves these routes out)
//     or a suite that is not running is said out loud in the console instead of hanging Firestore offline.
//
// ANCHORED, SO NO APP ROUTE IS TAKEN. Every match ends at a path-segment boundary (`/emulator/` is not
// `/emulators`, `/v0/b/` is not `/v0/blog`), and nothing keys on the project id: the two routes that carry one
// (Firestore REST, Functions) match its POSITION — the segment after /v1/projects/, the segment before a region
// name — so they hold for whichever id the client runs under, emulated or real. A route of the app's own that
// looks like one of these shapes is the only collision left: `/<x>/us-central1/<y>`, say.
//
// The relay is plain http, like the SDK's emulator connections themselves — firebase.config.ts says so in the
// console, at bootstrap, when the page is served over https.
//
// Offset-aware — the dev engine exports PORT_OFFSET for a shifted (worktree) stack, so each emulator runs at
// basePort + offset. A HARDCODED port would silently relay a worktree's traffic to a DIFFERENT tree's emulator;
// targetOf() shifts every target by the same offset.
import { existsSync, readFileSync } from 'node:fs';

// The stack's port offset (0 for the base stack; the dev engine sets it only for a shifted one).
const rawOffset = Number(process.env.PORT_OFFSET ?? 0);
const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

// Emulator ports — single-sourced from firebase.json at the workspace root (the dev-server's cwd), so changing a
// port in one place is enough. Falls back to the house default if unreadable.
let firebaseJson = {};
try {
  firebaseJson = JSON.parse(readFileSync('firebase.json', 'utf8'));
} catch {
  // keep the defaults — a project without a readable firebase.json isn't running the emulators anyway.
}
const targetOf = (service, fallback) => {
  const port = firebaseJson?.emulators?.[service]?.port;
  return `http://localhost:${(Number.isInteger(port) ? port : fallback) + offset}`;
};

// Storage's resumable-upload URL, made origin-relative (see the header). Hooked for every proxy engine an Angular
// dev server may run: Vite's (`configure`), and webpack-dev-server's http-proxy-middleware — `on.proxyRes` from v3
// (webpack-dev-server 6, @angular-devkit/build-angular 22), `onProxyRes` before it. Each engine reads its own key
// and ignores the others.
const relativeUploadUrl = (proxyRes) => {
  const url = proxyRes.headers['x-goog-upload-url'];
  if (typeof url !== 'string' || url.startsWith('/')) return;
  try {
    const { pathname, search } = new URL(url);
    proxyRes.headers['x-goog-upload-url'] = `${pathname}${search}`;
  } catch {
    // not a URL — leave it as the emulator sent it
  }
};
const rewriteUploadUrl = {
  configure: (proxy) => proxy.on('proxyRes', relativeUploadUrl),
  on: { proxyRes: relativeUploadUrl },
  onProxyRes: relativeUploadUrl,
};

// The hub serves /emulators; the probe's own prefix is stripped on the way (Angular turns `pathRewrite` into Vite's
// `rewrite`; http-proxy-middleware reads it natively; a bare Vite config reads `rewrite`).
const HUB_PROBE = '/__bespunky/emulator-hub';
const toHub = { pathRewrite: { [`^${HUB_PROBE}`]: '' }, rewrite: (path) => path.slice(HUB_PROBE.length) };

// Every Cloud Functions region is `<area>-<name><digit>` — us-central1, europe-west1, me-central2, …
const AREAS = ['africa', 'asia', 'australia', 'europe', 'me', 'northamerica', 'southamerica', 'us'];

/**
 * One row per relayed path family. `prefix` is a plain leading path (every proxy engine reads it alike); `glob`
 * and `regex` are the same match for a path whose middle varies — a glob for Angular's proxy config and
 * http-proxy-middleware, a `^` regex for a bare Vite config.
 */
const ROUTES = [
  { service: 'auth', port: 9099, prefix: '/identitytoolkit.googleapis.com/' },
  { service: 'auth', port: 9099, prefix: '/securetoken.googleapis.com/' },
  { service: 'auth', port: 9099, prefix: '/www.googleapis.com/' },
  { service: 'auth', port: 9099, prefix: '/emulator/' },
  { service: 'firestore', port: 8080, prefix: '/google.firestore.v1.Firestore/' },
  { service: 'firestore', port: 8080, glob: '/v1/projects/*/databases/**', regex: '^/v1/projects/[^/]+/databases/' },
  { service: 'storage', port: 9199, prefix: '/v0/b/', extra: rewriteUploadUrl },
  {
    service: 'functions',
    port: 5001,
    glob: `/*/{${AREAS.join(',')}}-*[0-9]/**`,
    regex: `^/[^/]+/(?:${AREAS.join('|')})-[^/]*[0-9]/`,
  },
  { service: 'hub', port: 4400, prefix: `${HUB_PROBE}/`, extra: toHub },
];

const routesBy = (keyOf) =>
  Object.fromEntries(
    ROUTES.map(({ service, port, extra, ...match }) => [
      keyOf(match),
      { target: targetOf(service, port), secure: false, changeOrigin: true, ...extra },
    ]),
  );

/** The house's emulator routes, as Angular's proxy config and webpack-dev-server read them. */
export const emulatorRoutes = routesBy(({ prefix, glob }) => prefix ?? glob);

/** The same routes in a bare Vite config's dialect (`server.proxy`), where a key starting with `^` is a RegExp. */
export const viteEmulatorRoutes = routesBy(({ prefix, regex }) => prefix ?? regex);

// The project's own routes — proxy.local.mjs beside this file (object form, or webpack's array form), merged
// AFTER the house's: a key of its own that repeats one of these replaces it.
const localFile = new URL('./proxy.local.mjs', import.meta.url);
const local = existsSync(localFile) ? ((await import(localFile.href)).default ?? {}) : {};
const asObject = (config) =>
  Array.isArray(config)
    ? Object.fromEntries(config.flatMap(({ context, ...options }) => [context].flat().map((path) => [path, options])))
    : config;

// A dev server that must keep a proxy config of its own instead of this file includes the routes there:
//   import { emulatorRoutes } from './proxy.conf.mjs';      // a path relative to that file
//   export default { ...emulatorRoutes, '/api': { target: 'http://localhost:3000' } };
export default { ...emulatorRoutes, ...asObject(local) };
