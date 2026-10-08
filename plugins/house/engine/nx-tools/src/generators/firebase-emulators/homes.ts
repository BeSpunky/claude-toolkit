// WHERE THE TWO FIREBASE HOUSE PROJECTS LIVE — one answer for every generator that names them.
//
// The firebase-emulators generator creates them (Cloud Functions in the workspace's apps directory, the emulator
// suite at `firebase/`) and the ci layer's Firebase provider configures their deploy targets; both ask here, so
// a project the workspace moved (or named differently) is found the same way by both.
import type { Tree } from '@nx/devkit';
import { houseProjectHome, type HouseProjectHome } from '../_utils/project-files';
import { resolveAppsDir } from '../_utils/workspace-layout';

export function firebaseHomes(tree: Tree): { functions: HouseProjectHome; suite: HouseProjectHome } {
  return {
    functions: houseProjectHome(tree, 'functions', `${resolveAppsDir(tree)}/functions`),
    suite: houseProjectHome(tree, 'firebase', 'firebase'),
  };
}
