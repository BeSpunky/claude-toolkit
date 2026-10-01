// THE FRAGMENT REGISTRY — every adapter that contributes processes to a served app's declaration.
//
// Two kinds, kept apart because they answer different questions:
//   STACKS        provide the app itself — its primary process (the dev-server). A stack decides WHETHER a
//                 project is served at all.
//   CAPABILITIES  attach to an app that is served (an emulator suite beside it). They never declare an app on
//                 their own: an app made only of emulators has nothing to open in a browser.
// A new stack or capability contributes by adding one provider to its list.
import type { Tree } from '@nx/devkit';
import { type DevFragment, type SeedReport, readDeclaration, seedApp } from '../declaration';
import { firebaseFragment } from './firebase';
import { nxDevServerFragment } from './nx';

type FragmentProvider = (tree: Tree, project: string) => DevFragment;

const STACKS: readonly FragmentProvider[] = [nxDevServerFragment];
const CAPABILITIES: readonly FragmentProvider[] = [(tree) => firebaseFragment(tree)];

/**
 * Seed the declaration for an Nx-served project from every provider that applies to it. Adds only what the
 * app does not declare yet (see seedApp) — safe on every sync.
 */
export function seedFromAdapters(tree: Tree, project: string): SeedReport {
  const report = STACKS.flatMap((provide) => seedApp(tree, project, provide(tree, project)));
  if (!readDeclaration(tree)?.apps?.[project]) return report;
  return [...report, ...CAPABILITIES.flatMap((provide) => seedApp(tree, project, provide(tree, project)))];
}
