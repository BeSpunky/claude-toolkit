// The Firebase capability's dev fragment: the workspace emulator suite, served beside the app. It lives with the
// Firebase CORE (this generator), which owns the suite, and reaches the dev engine through the layer descriptor
// (`firebase.devFragment`) — the dev generator lists no capability by name.
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
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import type { DevFragment } from '../dev/declaration';
import { NX_TREE_ENV } from '../dev/fragments/nx';
import { nxInvocation } from '../_utils/nx-host';
import { emulatorPorts } from './emulator-ports';

export const FIREBASE_PROJECT = 'firebase';
export const EMULATORS_TARGET = 'emulators';

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
