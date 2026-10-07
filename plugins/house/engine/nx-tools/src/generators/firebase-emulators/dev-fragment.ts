// The Firebase capability's dev fragment: the workspace emulator suite, served beside the app. It lives with the
// Firebase CORE (this generator), which owns the suite, and reaches the dev engine through the layer descriptor
// (`firebase.devFragment`) — the dev generator lists no capability by name.
//
// It contributes:
//   - the `emulators` process — the workspace `firebase:emulators` target, which launches through
//     tools/emulators.sh. That script shifts the WHOLE suite by PORT_OFFSET (which the engine exports when the
//     stack is shifted), so the process declares its ports for the BLOCK SIZE (every port the suite occupies,
//     read from firebase.json, plus the hub/logging ports the script pins) rather than passing them as flags;
//   - the client's URL switch `?emulate=none` when the suite is skipped, so every service resolves to the real
//     backend. (A shifted stack needs none: the browser reaches every emulator through the app's own origin, and
//     the dev server's proxy.conf.mjs relays it with the stack's PORT_OFFSET.)
//   - the OAuth-origin advice: real Google sign-in is registered for the base origin only, so when another
//     devcontainer owns that port, its owner is the one signing in there;
//   - where THIS stack's Emulator UI works (EMULATOR_UI_ADVICE): its page dials every emulator directly, at the
//     container port, so a host tab is complete only on the base stack with same-number forwards — and a shifted
//     stack's UI is not forwarded at all.
import { type Tree, readProjectConfiguration } from '@nx/devkit';
import type { DevFragment } from '../dev/declaration';
import { NX_TREE_ENV } from '../dev/fragments/nx';
import { nxInvocation } from '../_utils/nx-host';
import { emulatorPorts } from './emulator-ports';

export const FIREBASE_PROJECT = 'firebase';

/** Where the Emulator UI works, said in the serve banner — the fragment seeds it, 0.50.0 adds it to existing apps. */
export const EMULATOR_UI_ADVICE: { when: 'base' | 'offset'; text: string }[] = [
  {
    when: 'base',
    text:
      'Emulator UI: http://localhost:${PORT:ui} — complete in a host tab only while the editor forwards every emulator ' +
      'port to the same number (a remapped one empties its panel); the shared browser always sees all of it.',
  },
  {
    when: 'offset',
    text:
      "This stack's Emulator UI is http://localhost:${PORT:ui} — open it in the shared browser: the editor forwards " +
      "only the base suite's ports, so a host tab can't reach it (the app itself needs none of them).",
  },
];
export const EMULATORS_TARGET = 'emulators';

export function firebaseFragment(tree: Tree): DevFragment {
  if (!tree.exists('firebase.json')) return { processes: [] };
  try {
    if (!readProjectConfiguration(tree, FIREBASE_PROJECT).targets?.[EMULATORS_TARGET]) return { processes: [] };
  } catch {
    return { processes: [] };
  }
  const ports = emulatorPorts(tree);
  return {
    processes: [
      {
        id: 'emulators',
        cmd: [nxInvocation(tree).bin, 'run', `${FIREBASE_PROJECT}:${EMULATORS_TARGET}`],
        env: { ...NX_TREE_ENV },
        ports,
        url: [{ param: 'emulate', value: 'none', when: 'skipped' }],
        advice: [
          {
            when: 'contended',
            text: 'Real Google OAuth sign-in is registered for that base origin only — sign in on the stack that owns it, or use the Auth emulator here.',
          },
          ...(ports.ui ? EMULATOR_UI_ADVICE : []),
        ],
      },
    ],
  };
}
