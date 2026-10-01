// The Firebase capability's fragment: the workspace emulator suite, served beside the app.
//
// It contributes:
//   - the `emulators` process — the workspace `firebase:emulators` target, which launches through
//     tools/emulators.sh. That script shifts the WHOLE suite by PORT_OFFSET (which the engine exports when the
//     stack is shifted), so the process declares its ports for the BLOCK SIZE (every port the suite occupies,
//     read from firebase.json, plus the hub/logging ports the script pins) rather than passing them as flags;
//   - the client's two URL switches: `?portOffset=N` on a shifted stack, so the app reaches the shifted
//     emulators, and `?emulate=none` when the suite is skipped, so every service resolves to the real backend;
//   - the OAuth-origin advice: real Google sign-in is registered for the base origin only, so when another
//     devcontainer owns that port, its owner is the one signing in there.
//
// Phase 4 (capability/adapter split) is the natural owner of this file: it belongs beside the Firebase core,
// which can then seed it when the capability is ensured. It lives here until that split lands.
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import type { DevFragment } from '../declaration';
import { NX_TREE_ENV, nxInvocation } from './nx';

/** firebase-tools' own defaults, for an emulator firebase.json enables without naming a port. */
const FIREBASE_DEFAULT_PORTS: Record<string, number> = {
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
/** Always occupied by a running suite — tools/emulators.sh pins them (shifted) even when firebase.json is silent. */
const ALWAYS_ON = ['hub', 'logging'];

export const FIREBASE_PROJECT = 'firebase';
export const EMULATORS_TARGET = 'emulators';

/** Every port a running suite occupies, by emulator name — read from firebase.json. */
export function emulatorPorts(tree: Tree): Record<string, number> {
  const json = JSON.parse(tree.read('firebase.json', 'utf8') ?? '{}') as { emulators?: Record<string, unknown> };
  const ports: Record<string, number> = {};
  for (const [name, value] of Object.entries(json.emulators ?? {})) {
    if (!value || typeof value !== 'object') continue; // singleProjectMode and other settings
    const entry = value as { port?: unknown; enabled?: unknown };
    if (entry.enabled === false) continue;
    const port = Number(entry.port ?? FIREBASE_DEFAULT_PORTS[name]);
    if (Number.isInteger(port) && port > 0 && /^[a-z][a-z0-9_-]*$/.test(name)) ports[name] = port;
  }
  for (const name of ALWAYS_ON) ports[name] ??= FIREBASE_DEFAULT_PORTS[name];
  return ports;
}

export function firebaseFragment(tree: Tree): DevFragment {
  if (!tree.exists('firebase.json')) return { processes: [] };
  try {
    if (!readProjectConfiguration(tree, FIREBASE_PROJECT).targets?.[EMULATORS_TARGET]) return { processes: [] };
  } catch {
    return { processes: [] };
  }
  return {
    processes: [
      {
        id: 'emulators',
        cmd: [nxInvocation(tree).bin, 'run', `${FIREBASE_PROJECT}:${EMULATORS_TARGET}`],
        env: { ...NX_TREE_ENV },
        ports: emulatorPorts(tree),
        url: [
          { param: 'portOffset', value: '${OFFSET}', when: 'offset' },
          { param: 'emulate', value: 'none', when: 'skipped' },
        ],
        advice: [
          {
            when: 'contended',
            text: 'Real Google OAuth sign-in is registered for that base origin only — sign in on the stack that owns it, or use the Auth emulator here.',
          },
        ],
      },
    ],
  };
}
