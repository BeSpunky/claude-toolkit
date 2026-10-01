// `nx` — the FLOOR. Every house generator is an Nx-devkit generator run through `nx g`, and the migration
// ladder is native `nx migrate`, so nothing above this layer runs without it.
//
// ALWAYS ENSURED. A sync on a repo without nx.json initialises Nx in place rather than refusing — "Let's keep
// Nx as a base assumption. If it's not there, we require/install/init it" (the user, 2026-10-01). Everything
// ABOVE this layer stays opt-in. scaffold.sh reads `floor: true` from the shell projection and adds it to
// every ensure set; how it lays the floor depends on the repo:
//   - a repo with a root package.json → `nx init` into node_modules (today's path);
//   - a repo WITHOUT one (Python, Go, docs) → `nx init --useDotNxInstallation` — the Nx wrapper
//     (`./nx`, `.nx/installation`), which hosts @bespunky/nx-tools exactly pinned in nx.json's
//     `installation.plugins` without turning the repo into a Node project. Verified, not assumed — see
//     contracts/layers.md.
//
// The house doc (`house-doc`) is not this layer's generator: it is the planner's final, layer-independent
// STAMP step (plan.ts), because it must run after every layer has had its turn.
import type { LayerDescriptor } from './descriptor';

export const nx: LayerDescriptor = {
  id: 'nx',
  title: 'Nx workspace (the floor)',
  requires: [],
  evidence: { files: ['nx.json'] },
  ensurable: { scaffold: true, sync: true },
  ensureHint:
    '`scaffold.sh --sync <project>` — the floor is always ensured: `nx init` in place (into node_modules when ' +
    'the repo has a package.json, else through the Nx wrapper, ./nx)',
  brings: 'the Nx floor every house generator and migration runs on',
  docSections: ['nx'],
};
