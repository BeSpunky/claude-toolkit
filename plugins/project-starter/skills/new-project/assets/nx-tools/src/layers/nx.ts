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
  // The Nx floor's share of the agent artifacts. Nx Console (`nrwl.angular-console` is its historical id — it is
  // the Nx extension, not an Angular one) and Nx's own Claude plugin, because Nx is in EVERY house project.
  devcontainer: {
    extensions: ['nrwl.angular-console'],
    // Nx's machine-local state on volumes — the CACHE and the WORKSPACE DATA, never the whole `.nx/` folder. On
    // the Nx wrapper host `.nx/` also carries the COMMITTED `nxw.js`, and a volume over the folder hides it:
    // `./nx` would not exist inside the container. Two exact subfolders are right on both hosts.
    mounts: [
      {
        mount: 'source=${localWorkspaceFolderBasename}-nx-cache,target=${containerWorkspaceFolder}/.nx/cache,type=volume',
        why: "Nx's cache and workspace data on volumes (machine-local; never the bind mount, never the whole .nx/).",
      },
      { mount: 'source=${localWorkspaceFolderBasename}-nx-workspace-data,target=${containerWorkspaceFolder}/.nx/workspace-data,type=volume' },
    ],
    postCreate: [
      { phase: 'prepare', piece: 'nx-volumes' },
      { phase: 'install', piece: 'nx-wrapper' },
    ],
  },
  claudePlugins: ['nx@nx-claude-plugins'],
  gitignore: [
    // `nx init` on an EXISTING repo ignores `.nx/polygraph` but not these, so a retrofitted repo has files that
    // churn on every `nx` invocation — for an agent a permanently dirty tree makes "is this change mine?"
    // unanswerable. Substring-matched, so a repo ignoring `.nx/` wholesale is left alone.
    { heading: 'Nx caches (machine-local; never committed)', entries: ['.nx/cache', '.nx/workspace-data'] },
    // The sync's own transient lock. Nx builds its pre-migration checkpoint with `git add -A`, so a lock the
    // sync still holds gets swept into that commit (it landed in history twice: `abd143e`, and again on the run
    // that added this line). The sync runs on the Nx floor, so the floor owns its lock.
    { heading: "The house sync's transient lock (machine-local; never committed)", entries: ['.bespunky-sync.lock/'] },
  ],
};
