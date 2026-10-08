// Dev-server proxy — the browser reaches EVERY Firebase emulator through the app's OWN origin, and this file
// relays each one to the suite inside the container. GENERATOR-OWNED (rewritten on every upgrade); don't edit.
// YOUR OWN ROUTES (an /api relay, say) go in proxy.local.mjs beside this file — seeded once, never rewritten, and
// merged below — or, if the dev server must keep a proxy config of its own, include `emulatorRoutes` from here
// in it (see the end of this file). Which export a dev server reads:
//   - Angular's dev server (Vite or webpack-dev-server): `proxyConfig` → this file; it reads the default export.
//   - a bare Vite config: `server: { proxy: viteProxy }` — the same routes and the same proxy.local.mjs, in Vite's
//     dialect.
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
//     That one path and NOTHING ELSE of the hub: the rest of it is the suite's control API (/_admin/export writes
//     an export to whatever path it is sent, /functions/*BackgroundTriggers, /dataconnect/clearData), and the
//     app's origin is the port that is always forwarded to the host. firebase-tools' own guard does not stop it —
//     it answers an Origin-bearing export with a 403 and then runs the export anyway.
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

// The stack's port offset — set by the dev engine for every process of a stack (0 on the base stack).
const rawOffset = Number(process.env.PORT_OFFSET ?? 0);
const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
// A dev server the engine did not start (`nx run <app>:dev-server`, the leaf, run by hand) belongs to no stack: it
// relays to the BASE ports' suite — in a worktree, ANOTHER tree's emulators, holding another tree's data. Said loudly.
if (!process.env.DEV_STACK_DIR) {
  console.error(
    '[proxy] This dev server is not part of a dev stack (no DEV_STACK_DIR): its emulator relay targets the BASE ports' +
      `${offset ? ` + ${offset}` : ''} — whichever suite holds them, which in a worktree is another tree's. Serve with \`nx serve <app>\` (or tools/dev/dev serve).`,
  );
}

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
// `rewrite`; http-proxy-middleware reads it natively; a bare Vite config reads `rewrite`). Its route is EXACT (see
// the header): a plain key is a prefix to every engine, so it is a glob that matches the one path — `@(emulators)`,
// the extglob for "exactly this segment", which picomatch (Angular's Vite) and micromatch (http-proxy-middleware)
// both read — and, for a bare Vite config, a regex anchored at both ends.
const HUB_PROBE = '/__bespunky/emulator-hub';
const toHub = { pathRewrite: { [`^${HUB_PROBE}`]: '' }, rewrite: (path) => path.slice(HUB_PROBE.length) };

// Every Cloud Functions region is `<area>-<name><digit>` — us-central1, europe-west1, me-central2, …
const AREAS = ['africa', 'asia', 'australia', 'europe', 'me', 'northamerica', 'southamerica', 'us'];

/**
 * One row per relayed path family. `prefix` is a plain leading path (every proxy engine reads it alike); `glob`
 * and `regex` are the same match for a path a prefix can't express — a glob for Angular's proxy config and
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
  { service: 'hub', port: 4400, glob: `${HUB_PROBE}/@(emulators)`, regex: `^${HUB_PROBE}/emulators$`, extra: toHub },
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

// The project's own routes — proxy.local.mjs beside this file, merged AFTER the house's, in each dialect. Its contract
// is the one thing every engine reads ALIKE, so the file means the same to Angular's Vite, webpack-dev-server and a
// bare Vite: each key a PLAIN PATH PREFIX, each entry ordinary http-proxy options (`pathRewrite` as an object, which
// Angular's Vite turns into `rewrite` and so does viteProxy). A glob is a glob to Angular and http-proxy-middleware
// but a literal prefix to Vite, a `^` key a RegExp to Vite but a literal path to webpack-dev-server, and a function
// `context` (webpack's array form) is no path at all — each would be a route that silently never matches somewhere,
// so each is refused here, at dev-server start, with the reason. Webpack's array form (`context` a path or a list of
// paths) is read as the same object.
const localFile = new URL('./proxy.local.mjs', import.meta.url);
const local = existsSync(localFile) ? ((await import(localFile.href)).default ?? {}) : {};
const NOT_A_PREFIX = /[*?[\]{}()!+@]|^\^/;

/** One `[path, options]` per route proxy.local.mjs declares — refused with the reason when a key is not a plain prefix. */
const localEntries = (config) => {
  const refuse = (what, why) => {
    throw new Error(
      `[proxy.conf.mjs] proxy.local.mjs: ${what} ${why}. Key every route by a plain path prefix ending at a segment ` +
        `boundary ('/api/') — the one match Angular's Vite, webpack-dev-server and a bare Vite all read alike. A ` +
        `dev server that needs another kind of match keeps a proxy config of its own and includes this file's ` +
        `emulatorRoutes (or viteEmulatorRoutes) in it.`,
    );
  };
  const entries = Array.isArray(config)
    ? config.flatMap(({ context, ...options }, at) => {
        const paths = [context].flat();
        if (paths.length === 0 || !paths.every((path) => typeof path === 'string')) {
          refuse(`entry ${at}'s context (${typeof context === 'function' ? 'a function' : String(context)})`, 'is not a path or a list of paths');
        }
        return paths.map((path) => [path, options]);
      })
    : Object.entries(config);
  for (const [path] of entries) {
    if (!path.startsWith('/') || NOT_A_PREFIX.test(path)) refuse(`the route '${path}'`, 'is not a plain path prefix');
  }
  return entries;
};
const ownRoutes = localEntries(local);

// A route of the project's own may REPLACE one of the house's (same key) — said once, at dev-server start, because
// the hub probe in the page only ever asks the hub route, so a replaced emulator route would otherwise go unseen.
const replaced = ownRoutes.map(([path]) => path).filter((path) => path in emulatorRoutes);
if (replaced.length > 0) {
  console.warn(
    `[proxy.conf.mjs] proxy.local.mjs replaces the house's emulator route${replaced.length > 1 ? 's' : ''} ` +
      `${replaced.join(', ')} — that emulator is no longer relayed by the house.`,
  );
}

// `pathRewrite` (object form) → Vite's `rewrite`, exactly as Angular's Vite dev server converts it.
const asVite = (options) => {
  const { pathRewrite, ...rest } = options;
  if (!pathRewrite || typeof pathRewrite !== 'object' || rest.rewrite) return options;
  const rules = Object.entries(pathRewrite).map(([pattern, value]) => [new RegExp(pattern), value]);
  return {
    ...rest,
    rewrite: (path) => {
      for (const [pattern, value] of rules) {
        const updated = path.replace(pattern, value);
        if (updated !== path) return updated;
      }
      return path;
    },
  };
};

/** Everything a bare Vite config relays — `server: { proxy: viteProxy }`: the house's routes, then proxy.local.mjs. */
export const viteProxy = { ...viteEmulatorRoutes, ...Object.fromEntries(ownRoutes.map(([path, options]) => [path, asVite(options)])) };

// A dev server that must keep a proxy config of its own instead of this file includes the routes there:
//   import { emulatorRoutes } from './proxy.conf.mjs';      // a path relative to that file
//   export default { ...emulatorRoutes, '/api': { target: 'http://localhost:3000' } };
export default { ...emulatorRoutes, ...Object.fromEntries(ownRoutes) };
