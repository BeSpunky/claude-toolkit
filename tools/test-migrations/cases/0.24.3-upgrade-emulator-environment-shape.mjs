// 0.24.3 — the interface's "already current" guard, against the shapes that really shipped before it.
//
// The guard once asked only "does every member declare `default:`?". Two shipped templates answer yes without being
// the target: 0.1.0–0.6.0 (703ca41 … 46d6436, no `proxied?` at all) and 0.7.x (eddc392 / 907329b, `proxied?` on
// functions only). Both were skipped, so `auth` never gained `proxied?` — the INBOUND-HANDOFF-2 our-journey bug. The
// interface is write-if-absent since 6b56f49, so both still sit in projects whose floor is below this rung.
const RUNG = '0.24.3/upgrade-emulator-environment-shape';
const DIR = 'apps/web/src/environments';

/** The interface around its `emulators` member — identical in every shape, so only the member can differ. */
const iface = (emulators) => `export interface Environment {
  production: boolean;
  firebase: { projectId: string; apiKey: string; appId: string; authDomain?: string };
  // Our own top-level field.
  google?: { oauthClientId: string };
  ${emulators}
}
`;

/** What 0.24.3 writes (`interfaceMemberText`, two-space indent) — the current shape. */
const CURRENT = `emulators?: {
    // PER-SERVICE, and the whole block is optional (a production env file omits it → every service
    // talks to the real backend). Each service carries its local endpoint AND its committed
    // \`default\` — whether it is emulated out of the box. firebase.config.ts resolves
    // \`default ⊕ runtime-override\` (see src/app/emulator-overrides.ts) and connects a service to
    // its emulator only when the result is ON, and only in dev. A service that resolves OFF (or has
    // no entry here) uses the real project in \`firebase\`.
    // \`proxied\` (auth + functions): reach the emulator through the dev-server's OWN origin
    // (proxy.conf.mjs relays it, offset-shifted) instead of dialing host:port directly.
    auth?: { url: string; default: boolean; proxied?: boolean };
    firestore?: { host: string; port: number; default: boolean };
    storage?: { host: string; port: number; default: boolean };
    functions?: { host: string; port: number; default: boolean; proxied?: boolean };
  };`;

/** nx-tools 0.1.0–0.6.0 (703ca41 … 46d6436): `default` everywhere, no `proxied`. */
const S1 = `emulators?: {
    auth?: { url: string; default: boolean };
    firestore?: { host: string; port: number; default: boolean };
    storage?: { host: string; port: number; default: boolean };
    functions?: { host: string; port: number; default: boolean };
  };`;

/** nx-tools 0.7.0 / 0.7.1 (eddc392, 907329b): `proxied?` on functions only. */
const S2 = `emulators?: {
    auth?: { url: string; default: boolean };
    firestore?: { host: string; port: number; default: boolean };
    storage?: { host: string; port: number; default: boolean };
    // \`proxied\` (functions only): reach the emulator through the dev-server's OWN origin (its
    // proxy.conf.mjs relays callables, offset-shifted) instead of dialing host:port directly — dodges a
    // squatted/forwarded :5001 on the host and stays correct under worktree port offsets. Omitted → direct.
    functions?: { host: string; port: number; default: boolean; proxied?: boolean };
  };`;

/** A per-service dev file (nothing for the rung to do in it). */
const ENV = `import type { Environment } from './environment.interface';
export const environment: Environment = {
  production: false,
  firebase: { projectId: 'demo-web', apiKey: 'demo', appId: 'demo' },
  emulators: {
    auth: { url: 'http://localhost:9099', default: true },
    firestore: { host: 'localhost', port: 8080, default: true },
    storage: { host: 'localhost', port: 9199, default: true },
    functions: { host: 'localhost', port: 5001, default: true },
  },
};
`;

const bundle = (emulators) => (tree) => {
  tree.write('firebase.json', '{ "emulators": {} }\n');
  tree.write(`${DIR}/environment.ts`, ENV);
  tree.write(`${DIR}/environment.interface.ts`, iface(emulators));
};

export default {
  name: '0.24.3 · upgrade-emulator-environment-shape (interface guard)',
  ladder: [RUNG],
  cases: [
    {
      name: 'the current interface: untouched — and every shipped `default`-only shape converges to it',
      setup: bundle(CURRENT),
      expect: (tree, t) => {
        t.equal(t.read(`${DIR}/environment.interface.ts`), iface(CURRENT), 'the interface');
        t.equal(t.read(`${DIR}/environment.ts`), ENV, 'the value file');
      },
      historicalShapes: [
        { name: 'nx-tools 0.1.0–0.6.0 template (703ca41 … 46d6436): no `proxied?`', setup: bundle(S1) },
        { name: 'nx-tools 0.7.x template (907329b): `proxied?` on functions only', setup: bundle(S2) },
      ],
    },
    {
      name: 'a `default`-only member carrying a key of the project\'s own: left whole, and reported',
      setup: bundle(S1.replace('auth?: { url: string; default: boolean }', 'auth?: { url: string; default: boolean; tenantId?: string }')),
      expect: (tree, t, log) => {
        t.has(`${DIR}/environment.interface.ts`, 'tenantId?: string');
        t.ok(log.some((line) => line.includes('auth.tenantId')), 'the project-owned key is named in the report');
      },
    },
  ],
};
