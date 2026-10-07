// 0.50.0 — every emulator through the app's own origin: the `proxied` switch and the browser's ?portOffset= retire.
//
// The rung edits SEEDED environment files — the project's own values — so the fixtures pin what must survive
// (custom ports, project keys, comments that are not the house's) as hard as what must go, and the one way a
// half-edit breaks the build: an interface without `proxied` against a value file that still has it.
import { createRequire } from 'node:module';

const { writeJson, readJson } = createRequire(import.meta.url)('@nx/devkit');

const RUNG = '0.50.0/route-emulators-through-origin';

/** The 0.49 environment.ts template, verbatim in its emulator part. */
const STOCK_ENV = `import type { Environment } from './environment.interface';

const EMULATE = {
  auth: true,
  firestore: true,
  storage: true,
  functions: true,
};

export const environment: Environment = {
  production: false,
  firebase: {
    projectId: 'demo-shop',
    apiKey: 'demo',
    appId: 'demo',
    authDomain: 'demo-shop.firebaseapp.com',
  },
  // Local emulator endpoints (match firebase.json at the workspace root — change a port there and
  // change it here too, AND in the devcontainer's forwardPorts). Each entry's \`default\` comes from
  // EMULATE above; the endpoint is always present so a runtime \`?emulate=<service>\` can switch a
  // defaulted-off service back on.
  emulators: {
    // \`proxied\` (auth + functions) routes the emulator through the dev-server's OWN origin (proxy.conf.mjs
    // relays it, offset-shifted) so the host browser needs only the port the app loaded on. It matters MOST
    // for auth: apps usually gate every route on auth readiness, so a squatted/forwarded :9099 leaves the app
    // blank AND sign-in hanging. Set false to dial the emulator port directly.
    auth: { url: 'http://localhost:9099', default: EMULATE.auth, proxied: true },
    firestore: { host: 'localhost', port: 8080, default: EMULATE.firestore },
    storage: { host: 'localhost', port: 9199, default: EMULATE.storage },
    // \`proxied\` routes Functions callables through the dev-server's OWN origin (its proxy.conf.mjs relays
    // them to this emulator, offset-shifted) instead of the browser dialing :5001 — dodging a squatted or
    // forwarded :5001 on the host (common on Windows) and staying correct under worktree port offsets.
    // Set false to dial the emulator port directly.
    functions: { host: 'localhost', port: 5001, default: EMULATE.functions, proxied: true },
  },
};
`;

/** The 0.49 environment.interface.ts emulators member, plus a project-added top-level field. */
const STOCK_INTERFACE = `export interface Environment {
  production: boolean;
  firebase: { projectId: string; apiKey: string; appId: string; authDomain?: string };
  google?: { oauthClientId: string };
  emulators?: {
    // \`proxied\` (auth too): reach the emulator through the dev-server's own origin (proxy.conf.mjs relays it).
    auth?: { url: string; default: boolean; proxied?: boolean };
    firestore?: { host: string; port: number; default: boolean };
    storage?: { host: string; port: number; default: boolean };
    // \`proxied\` (functions only): reach the emulator through the dev-server's OWN origin (its
    // proxy.conf.mjs relays callables, offset-shifted) instead of dialing host:port directly — dodges a
    // squatted/forwarded :5001 on the host and stays correct under worktree port offsets. Omitted → direct.
    functions?: { host: string; port: number; default: boolean; proxied?: boolean };
  };
}
`;

/** A pre-0.24.3-migrated project: no `proxied` anywhere — 0.24.3 left it off on purpose. */
const MIGRATED_ENV = `export const environment = {
  production: false,
  firebase: { projectId: 'demo-old', apiKey: 'demo', appId: 'demo' },
  emulators: {
    auth: { url: 'http://localhost:9099', default: true },
    firestore: { host: 'localhost', port: 8081, default: true },
  },
};
`;

const PROD_ENV = `import type { Environment } from './environment.interface';
export const environment: Environment = {
  production: true,
  firebase: { projectId: '', apiKey: '', appId: '' },
};
`;

/**
 * The our-journey bundle (INBOUND-HANDOFF-2): an interface whose every member declares `default` and none `proxied?`
 * (the nx-tools 0.1.0–0.6.0 template, 703ca41 … 46d6436 — which the pre-fix 0.24.3 guard judged current, so `auth`
 * never gained `proxied?`) — with `proxied?: boolean` then hand-added on `auth` ONLY, to make the documented one-word
 * opt-in compile; the value file opted `auth` in and nothing else. The
 * never-opted-in version of the same project is the canonical input it must converge to.
 */
const JOURNEY_INTERFACE = (authType) => `export interface Environment {
  production: boolean;
  firebase: { projectId: string; apiKey: string; appId: string; authDomain?: string };
  emulators?: {
    auth?: ${authType};
    firestore?: { host: string; port: number; default: boolean };
    storage?: { host: string; port: number; default: boolean };
    functions?: { host: string; port: number; default: boolean };
  };
}
`;
const JOURNEY_ENV = (auth) => `import type { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  firebase: { projectId: 'our-journey', apiKey: 'demo', appId: 'demo' },
  emulators: {
    auth: ${auth},
    firestore: { host: 'localhost', port: 8080, default: true },
    storage: { host: 'localhost', port: 9199, default: true },
    functions: { host: 'localhost', port: 5001, default: true },
  },
};
`;
/** dev.json as the house seeded it for a Firebase app — with and without the retired ?portOffset= switch. */
const journeyDevJson = (withSwitch) => ({
  apps: {
    journey: {
      processes: [
        { id: 'app', cmd: 'x', ports: { app: 4200 }, primary: true },
        {
          id: 'emulators',
          cmd: 'y',
          ports: { auth: 9099, firestore: 8080, storage: 9199, functions: 5001 },
          url: [
            ...(withSwitch ? [{ param: 'portOffset', value: '${OFFSET}', when: 'offset' }] : []),
            { param: 'emulate', value: 'none', when: 'skipped' },
          ],
        },
      ],
    },
  },
});
const journey = ({ opted }) => (tree) => {
  app(tree, 'apps/journey', {
    env: JOURNEY_ENV(`{ url: 'http://localhost:9099', default: true${opted ? ', proxied: true' : ''} }`),
    iface: JOURNEY_INTERFACE(`{ url: string; default: boolean${opted ? '; proxied?: boolean' : ''} }`),
  });
  writeJson(tree, '.bespunky/dev.json', journeyDevJson(opted));
};

function app(tree, root = 'apps/shop', { env = STOCK_ENV, iface = STOCK_INTERFACE } = {}) {
  tree.write('firebase.json', '{ "emulators": {} }\n');
  tree.write(`${root}/src/app/firebase.config.ts`, '// generator-owned\n');
  tree.write(`${root}/src/environments/environment.ts`, env);
  tree.write(`${root}/src/environments/environment.prod.ts`, PROD_ENV);
  if (iface) tree.write(`${root}/src/environments/environment.interface.ts`, iface);
}

const OLD_GITIGNORE = `# Isolated port-offset stacks (\`<app>:serve --portOffset\`): each gets its own data dir
# and a generated offset firebase.json. Ephemeral and machine-local.
/.emulator-data-*
/.firebase.offset-*.json
`;
const OLD_DEVCONTAINER = `{
  "portsAttributes": {
    "6119": { "label": "Shared Browser (noVNC)", "onAutoForward": "notify", "requireLocalPort": true },
    // Firebase forwards the dev server + emulator ports to the SAME host port: the Firebase SDK inside a
    // host-loaded page dials hardcoded localhost:<port> addresses that only resolve if the port is identical.
    // KNOWN LIMITATION: several Firebase devcontainers in parallel collide on these host ports (first come wins;
    // real Google OAuth is pinned to whichever holds the dev-server port). The shared browser runs INSIDE the
    // container and reaches them on loopback, so it works for every container.
    "4200": { "label": "Angular Dev Server", "onAutoForward": "openPreview" },
    "4000": { "label": "Firebase Emulator UI", "onAutoForward": "notify" }
  }
}
`;
const ENV = 'apps/shop/src/environments/environment.ts';
const IFACE = 'apps/shop/src/environments/environment.interface.ts';
const logged = (lines, needle) => lines.some((line) => line.includes(needle));

export default {
  name: '0.50.0 · route-emulators-through-origin',
  ladder: [RUNG],
  cases: [
    {
      name: 'the stock 0.49 bundle: `proxied` and its paragraphs gone, every value kept, the endpoints comment replaced',
      setup: (tree) => app(tree),
      expect: (tree, t) => {
        for (const path of [ENV, IFACE]) t.hasNot(path, 'proxied');
        t.has(ENV, "auth: { url: 'http://localhost:9099', default: EMULATE.auth },");
        t.has(ENV, "functions: { host: 'localhost', port: 5001, default: EMULATE.functions },");
        t.has(ENV, "firestore: { host: 'localhost', port: 8080, default: EMULATE.firestore },");
        t.has(ENV, 'THE BROWSER NEVER DIALS THESE ADDRESSES');
        t.hasNot(ENV, "devcontainer's forwardPorts");
        t.has(IFACE, 'auth?: { url: string; default: boolean };');
        t.has(IFACE, 'functions?: { host: string; port: number; default: boolean };');
        t.has(IFACE, 'google?: { oauthClientId: string };');
        t.equal(t.read('apps/shop/src/environments/environment.prod.ts'), PROD_ENV, 'the prod file (nothing to do) is untouched');
      },
    },
    {
      name: "the house's 0.49 words this change made false: the .gitignore flag and the devcontainer port comment retold; reworded ones kept",
      setup: (tree) => {
        app(tree);
        tree.write('.gitignore', `node_modules\n\n${OLD_GITIGNORE}`);
        tree.write('.devcontainer/devcontainer.json', OLD_DEVCONTAINER);
      },
      expect: (tree, t, lines) => {
        t.equal(
          t.read('.gitignore'),
          `node_modules\n\n${OLD_GITIGNORE.replace('`<app>:serve --portOffset`', '`nx serve <app> --port-offset=N`')}`,
          'only the flag line changed',
        );
        const dc = t.read('.devcontainer/devcontainer.json');
        t.ok(!dc.includes('SAME host port'), `the false comment is gone:\n${dc}`);
        t.ok(dc.includes("    // The app reaches every Firebase emulator through the dev server's own origin"), 'retold at its indentation');
        t.ok(dc.includes('"4200": { "label": "Angular Dev Server", "onAutoForward": "openPreview" },'), 'the entry under it untouched');
        t.ok(logged(lines, '.gitignore: rewrote') && logged(lines, 'devcontainer.json: rewrote'), `reported: ${lines}`);
      },
    },
    {
      name: 'a comment the project reworded is its own: left',
      setup: (tree) => {
        app(tree);
        tree.write('.gitignore', '# Isolated port-offset stacks (our own words): each gets its own data dir\n/.emulator-data-*\n');
      },
      expect: (tree, t) => t.has('.gitignore', '(our own words)'),
    },
    {
      // 0.24.3 left these projects on direct dialling. There is nothing to remove — and nothing to write.
      name: 'a project 0.24.3 migrated (no `proxied` at all): byte-for-byte untouched',
      setup: (tree) => app(tree, 'apps/old', { env: MIGRATED_ENV, iface: null }),
      expect: (tree, t) => t.equal(t.read('apps/old/src/environments/environment.ts'), MIGRATED_ENV, 'environment.ts'),
    },
    {
      name: '`proxied: false`, first member, on a custom port: removed, the port kept, the service named in the report',
      setup: (tree) =>
        app(tree, 'apps/shop', {
          env: STOCK_ENV.replace(
            "functions: { host: 'localhost', port: 5001, default: EMULATE.functions, proxied: true }",
            "functions: { proxied: false, host: '127.0.0.1', port: 15001, default: EMULATE.functions }",
          ),
        }),
      expect: (tree, t, log) => {
        t.has(ENV, "functions: { host: '127.0.0.1', port: 15001, default: EMULATE.functions }");
        t.ok(logged(log, '`functions` had `proxied: false`'), 'the direct-dialled service is reported');
      },
    },
    {
      // The interface would lose `proxied` while the value file keeps it: TS2353, a build break. All or nothing.
      name: 'a `proxied` this rung cannot reach: the whole directory left alone, and reported',
      setup: (tree) =>
        app(tree, 'apps/shop', {
          env: STOCK_ENV.replace("production: false,", "production: false,\n  relay: { proxied: true },"),
        }),
      expect: (tree, t, log) => {
        t.has(ENV, 'proxied: true },\n    firestore');
        t.has(IFACE, 'proxied?: boolean');
        t.ok(logged(log, 'Left apps/shop/src/environments unchanged'), 'the abort is reported');
      },
    },
    {
      name: 'a project comment that mentions proxied mid-paragraph is not the house\'s: kept',
      setup: (tree) =>
        app(tree, 'apps/shop', {
          env: STOCK_ENV.replace(
            "    firestore: { host: 'localhost', port: 8080",
            "    // our note: we once set proxied here\n    firestore: { host: 'localhost', port: 8080",
          ),
        }),
      expect: (tree, t) => {
        t.has(ENV, '// our note: we once set proxied here');
        t.hasNot(ENV, 'proxied: true');
      },
    },
    {
      name: "the project's own code importing a retired export, and an https dev server: reported, not edited",
      setup: (tree) => {
        app(tree);
        const own = "import { portOffset, emulatorFor as pick } from '../firebase.config';\nexport const x = portOffset;\n";
        tree.write('apps/shop/src/app/data/where.ts', own);
        writeJson(tree, 'apps/shop/project.json', { name: 'shop', targets: { 'dev-server': { options: { ssl: true } } } });
      },
      expect: (tree, t, log) => {
        t.has('apps/shop/src/app/data/where.ts', 'portOffset');
        t.ok(logged(log, 'where.ts imports `portOffset`, `emulatorFor`'), `the retired imports are reported: ${log.join(' | ')}`);
        t.ok(logged(log, '`dev-server` serves over https'), 'the https dev server is reported');
      },
    },
    {
      name: ".bespunky/dev.json: the house's ?portOffset= switch dropped, ?emulate=none kept, a project's own shape left",
      setup: (tree) => {
        app(tree);
        writeJson(tree, '.bespunky/dev.json', {
          apps: {
            shop: {
              processes: [
                { id: 'app', cmd: 'x', ports: { app: 4200 }, primary: true },
                {
                  id: 'emulators',
                  cmd: 'y',
                  ports: { auth: 9099 },
                  url: [
                    { param: 'portOffset', value: '${OFFSET}', when: 'offset' },
                    { param: 'emulate', value: 'none', when: 'skipped' },
                  ],
                },
              ],
            },
            other: { processes: [{ id: 'emulators', cmd: 'z', url: [{ param: 'portOffset', value: '1', when: 'always' }] }] },
          },
        });
      },
      expect: (tree, t) => {
        const d = readJson(tree, '.bespunky/dev.json');
        t.equal(d.apps.shop.processes[1].url, [{ param: 'emulate', value: 'none', when: 'skipped' }], 'shop emulators url');
        t.equal(d.apps.other.processes[0].url, [{ param: 'portOffset', value: '1', when: 'always' }], 'the project-shaped switch');
      },
    },
    {
      // The canonical input is the project that never opted in; the our-journey shape must end exactly there.
      name: 'our-journey: `proxied` on auth only (value + hand-added type) and the ?portOffset= switch — converges to never-opted-in',
      setup: journey({ opted: false }),
      expect: (tree, t) => {
        t.equal(t.read('apps/journey/src/environments/environment.ts'), JOURNEY_ENV("{ url: 'http://localhost:9099', default: true }"), 'environment.ts');
        t.equal(t.read('apps/journey/src/environments/environment.interface.ts'), JOURNEY_INTERFACE('{ url: string; default: boolean }'), 'the interface');
        t.equal(readJson(tree, '.bespunky/dev.json'), journeyDevJson(false), 'dev.json');
      },
      historicalShapes: [{ name: 'our-journey, nx-tools 0.47.0 (auth opted in by hand)', setup: journey({ opted: true }) }],
    },
    {
      // An UPGRADE_PARTIAL run skips the per-app generator, so the rung must not leave the 0.49 client reading a
      // `proxied` it just removed (it would silently dial :9099/:5001 again). Excerpt: a556912~1 firebase-auth.config.ts.tpl.
      name: 'the owned client glue is rewritten by the rung itself: nothing left reading `proxied`',
      setup: (tree) => {
        app(tree);
        tree.write('apps/shop/src/app/firebase-auth.config.ts', 'const proxied = (e as { proxied?: boolean }).proxied;\n');
        tree.write('apps/shop/proxy.conf.mjs', '// 0.49: relays auth + functions only when proxied\n');
      },
      expect: (tree, t) => {
        for (const file of ['firebase.config.ts', 'firebase-auth.config.ts', 'firebase-functions.config.ts', 'emulator-overrides.ts']) {
          t.exists(`apps/shop/src/app/${file}`);
          t.hasNot(`apps/shop/src/app/${file}`, 'proxied');
        }
        t.hasNot('apps/shop/proxy.conf.mjs', '0.49');
        t.has('apps/shop/proxy.conf.mjs', 'apps/shop/src/environments/environment.ts');
      },
    },
    {
      // 6106999 … 703ca41~1 wrote this comment above the pre-toggle block; 0.24.3 converted the values, not the comment.
      name: 'the pre-toggle endpoints comment (forwardPorts in step) is replaced too — without the EMULATE sentence',
      setup: (tree) =>
        app(tree, 'apps/old', {
          iface: null,
          env: MIGRATED_ENV.replace(
            '  emulators: {',
            "  // Emulator endpoints. Match `firebase.json` at the workspace root — if you\n  // change a port there, change it here too, AND in the devcontainer's\n  // `forwardPorts` (all three speak about the same local emulator suite;\n  // there's no auto-sync).\n  emulators: {",
          ),
        }),
      expect: (tree, t) => {
        const env = 'apps/old/src/environments/environment.ts';
        t.hasNot(env, 'forwardPorts');
        t.hasNot(env, 'EMULATE');
        t.has(env, '  // THE BROWSER NEVER DIALS THESE ADDRESSES.');
        t.has(env, "firestore: { host: 'localhost', port: 8081, default: true }");
      },
    },
    {
      name: 'no firebase.json: nothing is touched',
      setup: (tree) => {
        app(tree);
        tree.delete('firebase.json');
      },
      expect: (tree, t) => t.equal(t.read(ENV), STOCK_ENV, 'environment.ts'),
    },
  ],
};
