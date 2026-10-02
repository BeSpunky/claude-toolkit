// THE FRAGMENT SEEDING — every contribution to a served app's declaration, from where each one is owned.
//
// Two kinds, kept apart because they answer different questions:
//   THE APP       its primary process — the Nx face of the dev loop drives the project's `dev-server` target
//                 (./nx.ts), on the base port of the stack that owns it (`DevServerPort.basePort`). It decides
//                 WHETHER a project is served at all.
//   CAPABILITIES  attach to an app that is served (an emulator suite beside it). They never declare an app on
//                 their own: an app made only of emulators has nothing to open in a browser. Each is a LAYER's
//                 `devFragment` (the descriptor), contributed only where that layer is present — so a new
//                 capability serves beside an app by declaring it on its own descriptor, and nothing here names it.
import type { Tree } from '@nx/devkit';
import { type SeedReport, readDeclaration, seedApp } from '../declaration';
import { nxDevServerFragment } from './nx';
import { LAYERS, isPresent } from '../../../layers/registry';

/**
 * Seed the declaration for an Nx-served project from every contribution that applies to it. Adds only what the
 * app does not declare yet (see seedApp) — safe on every sync.
 */
export function seedFromAdapters(tree: Tree, project: string): SeedReport {
  // The declaration is the PROJECT's file: one it cannot read is reported and left exactly as it is — never
  // overwritten, and never a reason to fail the sync around it.
  try {
    readDeclaration(tree);
  } catch (error) {
    return [`NOT seeding ${project}: ${(error as Error).message} — left untouched. Fix it and re-run the sync.`];
  }
  const report = seedApp(tree, project, nxDevServerFragment(tree, project));
  if (!readDeclaration(tree)?.apps?.[project]) return report;
  const capabilities = LAYERS.filter((entry) => entry.devFragment && isPresent(tree, entry.id));
  return [...report, ...capabilities.flatMap((entry) => seedApp(tree, project, entry.devFragment!(tree, project)))];
}
