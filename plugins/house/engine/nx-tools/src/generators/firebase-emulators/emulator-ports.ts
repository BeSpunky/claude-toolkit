// THE EMULATOR SUITE'S PORTS — one table, read by everything that needs to know where the suite listens:
// the canonical `firebase.json` block this generator asserts, the dev declaration's `emulators` process (the
// ports the engine shifts as one block), and the devcontainer's forwarded ports. They used to be three
// hand-copied lists, and the devcontainer's never read `firebase.json` at all.
//
// WHERE THE SUITE IS: `firebase.json`'s `emulators` when it has them (the project's suite as configured), else the
// house suite — the emulators the canonical block enables, each on firebase-tools' own default port. (The
// devcontainer is composed before the core writes that block on the run that ensures Firebase.)
import type { Tree } from '@nx/devkit';

/** firebase-tools' own defaults, for an emulator firebase.json enables without naming a port. */
export const FIREBASE_DEFAULT_PORTS: Readonly<Record<string, number>> = {
  ui: 4000,
  hub: 4400,
  logging: 4500,
  hosting: 5000,
  functions: 5001,
  apphosting: 5002,
  firestore: 8080,
  pubsub: 8085,
  database: 9000,
  auth: 9099,
  storage: 9199,
  eventarc: 9299,
  dataconnect: 9399,
  tasks: 9499,
};

/** The emulators the house suite enables — the canonical firebase.json block, on firebase-tools' ports. */
export const HOUSE_EMULATORS = ['auth', 'firestore', 'storage', 'functions', 'ui'] as const;

/** Firestore's WebSocket listener (the Emulator UI's live view) — its own key, `firestore.websocketPort`. */
const FIRESTORE_WEBSOCKET_DEFAULT = 9150;

/** Always occupied by a running suite — tools/emulators.sh pins them (shifted) even when firebase.json is silent. */
const ALWAYS_ON = ['hub', 'logging'];

type EmulatorsJson = Record<string, unknown>;

function emulatorsOf(tree: Tree): EmulatorsJson {
  const json = tree.exists('firebase.json')
    ? (JSON.parse(tree.read('firebase.json', 'utf8') ?? '{}') as { emulators?: EmulatorsJson })
    : {};
  // No suite configured yet — the core asserts the canonical block on its run, so that is the suite there will be.
  return json.emulators ?? Object.fromEntries(HOUSE_EMULATORS.map((name) => [name, { port: FIREBASE_DEFAULT_PORTS[name] }]));
}

/** The enabled emulators and their ports, by name (`firebase.json`, or the house suite). */
function configured(tree: Tree): { name: string; port: number; entry: Record<string, unknown> }[] {
  const out: { name: string; port: number; entry: Record<string, unknown> }[] = [];
  for (const [name, value] of Object.entries(emulatorsOf(tree))) {
    if (!value || typeof value !== 'object') continue; // singleProjectMode and other settings
    const entry = value as Record<string, unknown>;
    if (entry.enabled === false) continue;
    const port = Number(entry.port ?? FIREBASE_DEFAULT_PORTS[name]);
    if (Number.isInteger(port) && port > 0 && /^[a-z][a-z0-9_-]*$/.test(name)) out.push({ name, port, entry });
  }
  return out;
}

/** Every port a running suite occupies, by emulator name — what the dev engine shifts as one block. */
export function emulatorPorts(tree: Tree): Record<string, number> {
  const ports: Record<string, number> = Object.fromEntries(configured(tree).map(({ name, port }) => [name, port]));
  for (const name of ALWAYS_ON) ports[name] ??= FIREBASE_DEFAULT_PORTS[name];
  return ports;
}

/**
 * The ports a HOST browser dials — the emulators' own listeners (the Firebase SDK inside a host-loaded page calls
 * hardcoded `localhost:<port>`), plus Firestore's WebSocket. Not the hub or logging ports: nothing outside the
 * container dials them. `label` is for the devcontainer's port attributes.
 */
export function hostDialledPorts(tree: Tree): { name: string; port: number; label: string }[] {
  const out: { name: string; port: number; label: string }[] = [];
  // The UI first — the one a person opens; then the services in firebase.json's order.
  const suite = configured(tree).sort((a, b) => Number(b.name === 'ui') - Number(a.name === 'ui'));
  for (const { name, port, entry } of suite) {
    if (ALWAYS_ON.includes(name)) continue;
    out.push({ name, port, label: name === 'ui' ? 'Firebase Emulator UI' : `${title(name)} Emulator` });
    if (name === 'firestore') {
      const ws = Number(entry.websocketPort ?? FIRESTORE_WEBSOCKET_DEFAULT);
      if (Number.isInteger(ws) && ws > 0) out.push({ name: 'firestore-websocket', port: ws, label: 'Firestore WebSocket' });
    }
  }
  return out;
}

const TITLES: Readonly<Record<string, string>> = { apphosting: 'App Hosting', dataconnect: 'Data Connect', pubsub: 'Pub/Sub', database: 'Realtime Database' };
const title = (name: string) => TITLES[name] ?? `${name[0].toUpperCase()}${name.slice(1)}`;
