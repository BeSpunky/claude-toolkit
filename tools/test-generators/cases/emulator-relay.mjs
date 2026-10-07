// THE EMULATOR RELAY — proxy.conf.mjs as the dev server loads it: which paths reach which emulator, and which reach
// the APP. Every emulated service goes through the page's origin, so a route that captures an app path is a deep link
// that returns emulator JSON (R4-2: `/emulators`, `/v0/blog`, `/<projectId>-landing` all did), and a route keyed on a
// project id the client is not running under relays nothing (R4-4).
//
// The three dialects a dev server reads the table in, each modelled by the rule its engine applies:
//   - Angular's proxy config (`emulatorRoutes`, the default export): a key with glob characters is a glob (Angular
//     compiles it with picomatch for Vite; webpack-dev-server hands it to http-proxy-middleware, which uses
//     micromatch) — minimatch stands in for both here; any other key is a plain leading path.
//   - a bare Vite config (`viteEmulatorRoutes`): a key starting with `^` is a RegExp tested on the URL, any other a
//     plain `startsWith`.
// The engines themselves were exercised end to end (Angular's Vite dev server, webpack-dev-server 6 +
// http-proxy-middleware 4) — docs/features/2026-10-07-house-firebase-handoff/impl/FD.md.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const { minimatch } = requireFromRepo('minimatch');

const isGlob = (key) => /[*?{}[\]]|[@!+]\(/.test(key); // an extglob — `@(…)` — is a glob to both engines too
const pathOf = (url) => new URL(url, 'http://x').pathname;
const DIALECTS = {
  angular: (key, url) => (isGlob(key) ? minimatch(pathOf(url), key) : pathOf(url).startsWith(key)),
  vite: (key, url) => (key[0] === '^' ? new RegExp(key).test(url) : url.startsWith(key)),
};

const RELAYED = {
  '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo': 9099,
  '/securetoken.googleapis.com/v1/token?key=demo': 9099,
  '/www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig': 9099,
  '/emulator/auth/handler?apiKey=demo': 9099,
  '/google.firestore.v1.Firestore/Listen/channel?VER=8&database=x': 8080,
  '/v1/projects/demo-coach/databases/(default)/documents:runQuery': 8080,
  '/v1/projects/coach-prod/databases/staging/documents:commit': 8080,
  '/v0/b/demo-coach.appspot.com/o?name=a.png&uploadType=resumable': 9199,
  '/demo-coach/us-central1/hello': 5001,
  '/coach-prod/europe-west1/hello': 5001,
  '/coach-prod/me-central2/hook/sub/path': 5001,
  '/__bespunky/emulator-hub/emulators': 4400,
};
const APP = [
  '/emulators',
  '/emulator-settings',
  '/v0/blog',
  '/v0/blog/post-1',
  '/demo-coach-landing',
  '/demo-coach/about',
  '/v1/projects',
  '/v1/projects/42',
  '/about/us',
  '/shop/us-sizes/10',
  '/',
];
// The hub's control API — never reachable through the app's origin (S3-10): firebase-tools runs an Origin-bearing
// export after answering it 403. Nor anything else under the probe's prefix.
const HUB_CONTROL = [
  '/__bespunky/emulator-hub/_admin/export',
  '/__bespunky/emulator-hub/functions/disableBackgroundTriggers',
  '/__bespunky/emulator-hub/functions/enableBackgroundTriggers',
  '/__bespunky/emulator-hub/dataconnect/clearData',
  '/__bespunky/emulator-hub/',
  '/__bespunky/emulator-hub/emulators/x',
  '/__bespunky/emulator-hub/emulatorsx',
];

const OFFSET = 1000;

async function load(tree, local, warned = []) {
  const dir = mkdtempSync(join(tmpdir(), 'emulator-relay-'));
  const cwd = process.cwd();
  const offset = process.env.PORT_OFFSET;
  const warn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    writeFileSync(join(dir, 'proxy.conf.mjs'), tree.read('apps/web/proxy.conf.mjs', 'utf8'));
    writeFileSync(join(dir, 'proxy.local.mjs'), local ?? tree.read('apps/web/proxy.local.mjs', 'utf8'));
    writeFileSync(join(dir, 'firebase.json'), JSON.stringify({ emulators: { firestore: { port: 8085 } } }));
    process.chdir(dir); // the dev server's cwd is the workspace root, where firebase.json is read
    process.env.PORT_OFFSET = String(OFFSET);
    return await import(`${pathToFileURL(join(dir, 'proxy.conf.mjs')).href}?${Date.now()}${Math.random()}`);
  } finally {
    console.warn = warn;
    process.chdir(cwd);
    if (offset === undefined) delete process.env.PORT_OFFSET;
    else process.env.PORT_OFFSET = offset;
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The target port a URL is relayed to under `routes` in `dialect` — first match wins, as in both engines — or null. */
const relayOf = (routes, dialect, url) => {
  const key = Object.keys(routes).find((k) => DIALECTS[dialect](k, url));
  return key ? Number(new URL(routes[key].target).port) : null;
};

export default {
  name: 'emulator relay · proxy.conf.mjs routes each emulator, and nothing of the app',
  cases: [
    {
      name: 'R4-2/R4-4 — every emulator path relayed (any project id, offset-shifted); /emulators, /v0/blog, /<id>-landing reach the app',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ctx.load('generators/firebase-emulators/service-configs').writeFirebaseClientGlue(tree, 'apps/web');
        ctx.proxy = await load(tree);
      },
      expect: (tree, t, ctx) => {
        const { emulatorRoutes, viteEmulatorRoutes, default: served } = ctx.proxy;
        t.equal(Object.keys(served), Object.keys(emulatorRoutes), 'a seeded (empty) proxy.local.mjs adds nothing');
        for (const [dialect, routes] of [['angular', emulatorRoutes], ['vite', viteEmulatorRoutes]]) {
          for (const [url, base] of Object.entries(RELAYED)) {
            // firebase.json moves Firestore to 8085: the relay follows it.
            const want = (base === 8080 ? 8085 : base) + OFFSET;
            t.equal(relayOf(routes, dialect, url), want, `${dialect}: ${url}`);
          }
          for (const url of APP) t.equal(relayOf(routes, dialect, url), null, `${dialect}: ${url} reaches the app`);
          for (const url of HUB_CONTROL) t.equal(relayOf(routes, dialect, url), null, `${dialect}: ${url} is not relayed to the hub`);
        }
        t.equal(Object.keys(ctx.proxy.viteProxy), Object.keys(viteEmulatorRoutes), 'viteProxy: a seeded proxy.local.mjs adds nothing');
        const storage = Object.values(emulatorRoutes).find((r) => r.target.endsWith(`:${9199 + OFFSET}`));
        t.ok(storage.configure && storage.on?.proxyRes && storage.onProxyRes, 'the upload-URL rewrite is hooked for Vite, hpm >= 3 and hpm 2');
        const hub = emulatorRoutes['/__bespunky/emulator-hub/@(emulators)'];
        t.equal(hub.rewrite('/__bespunky/emulator-hub/emulators'), '/emulators', 'the hub probe is rewritten to /emulators');
        t.equal(hub.pathRewrite, { '^/__bespunky/emulator-hub': '' }, '…and for engines that read pathRewrite');
      },
    },
    {
      name: "R4-1 — proxy.local.mjs is merged after the house's routes, object or webpack array form",
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ctx.load('generators/firebase-emulators/service-configs').writeFirebaseClientGlue(tree, 'apps/web');
        ctx.object = (await load(tree, "export default { '/api/': { target: 'http://localhost:3000' } };\n")).default;
        ctx.array = (await load(tree, "export default [{ context: ['/api/', '/auth/'], target: 'http://localhost:3000' }];\n")).default;
      },
      expect: (tree, t, ctx) => {
        t.equal(ctx.object['/api/'], { target: 'http://localhost:3000' }, 'object form');
        t.ok(Object.keys(ctx.object).indexOf('/api/') === Object.keys(ctx.object).length - 1, 'after the house routes');
        t.equal([ctx.array['/api/']?.target, ctx.array['/auth/']?.target], ['http://localhost:3000', 'http://localhost:3000'], 'array form');
        t.ok('/v0/b/' in ctx.array, 'the house routes stay');
      },
    },
    {
      name: 'S3-21 — a bare Vite config reads proxy.local.mjs too (viteProxy), pathRewrite as Vite\'s rewrite',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ctx.load('generators/firebase-emulators/service-configs').writeFirebaseClientGlue(tree, 'apps/web');
        ctx.proxy = await load(tree, "export default { '/api/': { target: 'http://localhost:3000', pathRewrite: { '^/api': '' } } };\n");
      },
      expect: (tree, t, ctx) => {
        const { viteProxy, viteEmulatorRoutes, default: served } = ctx.proxy;
        const keys = Object.keys(viteProxy);
        t.equal(keys.slice(0, -1), Object.keys(viteEmulatorRoutes), "the house's Vite routes first");
        t.equal(keys.at(-1), '/api/', '…then the project\'s');
        t.equal(viteProxy['/api/'].rewrite?.('/api/users'), '/users', 'pathRewrite became rewrite');
        t.equal(served['/api/'].pathRewrite, { '^/api': '' }, 'the Angular form keeps pathRewrite (Angular converts it itself)');
        t.equal(relayOf(viteProxy, 'vite', '/api/users'), 3000, 'vite: /api/ relayed');
        for (const url of HUB_CONTROL) t.equal(relayOf(viteProxy, 'vite', url), null, `vite: ${url} is not relayed to the hub`);
      },
    },
    {
      name: 'S3-15 — a route proxy.local.mjs cannot key by a plain prefix is refused at load, with the reason; a replaced house route is said',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ctx.load('generators/firebase-emulators/service-configs').writeFirebaseClientGlue(tree, 'apps/web');
        const refusal = async (local) => {
          try {
            await load(tree, local);
            return null;
          } catch (error) {
            return String(error.message);
          }
        };
        ctx.refused = {
          fn: await refusal("export default [{ context: (path) => path.startsWith('/api'), target: 'http://localhost:3000' }];\n"),
          none: await refusal("export default [{ target: 'http://localhost:3000' }];\n"),
          glob: await refusal("export default { '/api/**': { target: 'http://localhost:3000' } };\n"),
          regex: await refusal("export default { '^/api/': { target: 'http://localhost:3000' } };\n"),
          relative: await refusal("export default { 'api/': { target: 'http://localhost:3000' } };\n"),
        };
        ctx.warned = [];
        ctx.replacing = (await load(tree, "export default { '/emulator/': { target: 'http://localhost:3000' }, '/api/': { target: 'http://localhost:3000' } };\n", ctx.warned)).default;
      },
      expect: (tree, t, ctx) => {
        t.ok(ctx.refused.fn?.includes('a function') && ctx.refused.fn.includes('plain path prefix'), `function context: ${ctx.refused.fn}`);
        t.ok(ctx.refused.none?.includes('is not a path'), `missing context: ${ctx.refused.none}`);
        for (const kind of ['glob', 'regex', 'relative']) {
          t.ok(ctx.refused[kind]?.includes('is not a plain path prefix'), `${kind}: ${ctx.refused[kind]}`);
        }
        t.equal(ctx.replacing['/emulator/']?.target, 'http://localhost:3000', 'a same-key route still replaces the house\'s');
        t.equal(ctx.warned.length, 1, `said once: ${ctx.warned.join(' | ')}`);
        t.ok(ctx.warned[0]?.includes('/emulator/') && !ctx.warned[0].includes('/api/'), 'naming exactly the replaced house route');
      },
    },
  ],
};
