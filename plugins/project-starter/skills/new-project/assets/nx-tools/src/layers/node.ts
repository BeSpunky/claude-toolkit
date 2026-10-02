// `node` — this repo is a Node project: it has a root package.json, so Node runs it and a package manager
// installs it.
//
// WHY IT IS A LAYER NOW. contracts/layers.md deferred it — "add it when a phase gives it a generator or a
// devcontainer fragment" — because its only job in the first draft (being `nx`'s prerequisite) was taken away
// by the Nx wrapper host. Phase 2 gives it the fragment: everything in the devcontainer that exists BECAUSE the
// repo is a Node project used to be welded onto every container, and a Python or Go repo got a typescript-node
// image, a node_modules volume, `node_modules/.bin` on PATH, ESLint and Prettier, and a `yarn install` against a
// package.json it does not have. Those now arrive with this layer and nowhere else.
//
// It is a HOSTING fact as much as a stack fact, and that is fine: it is detected (a package.json at the root),
// never declared, and the sync already decides the Nx host from the very same file (scaffold.sh `HOST`). `js`
// stays the narrower claim "TypeScript/JavaScript LIBRARIES here" — a Node app with no library is `node`
// without `js`.
//
// NOT ENSURABLE BY A SYNC: a sync never turns a repo into a Node project (no package.json → the Nx wrapper).
// ENSURABLE BY A SCAFFOLD, and it is what decides the new project's Nx HOST: with `node` in the ensure set the
// floor is laid by create-nx-workspace (a package.json host); without it, through the Nx wrapper (phase 6).
import type { LayerDescriptor } from './descriptor';

export const node: LayerDescriptor = {
  id: 'node',
  title: 'Node project (a root package.json)',
  requires: [],
  evidence: { files: ['package.json'] },
  ensurable: { scaffold: true, sync: false },
  ensureHint: 'a root package.json (`npm init`) — the next sync then treats the repo as a Node project',
  brings: 'the typescript-node devcontainer image, the node_modules volume and the package-manager install',
  devcontainer: {
    // The stack image. It replaces the neutral base the `agent` layer declares (and that base's Node feature):
    // Node ships in it, and its `node` user is the one every house project before this layer existed runs as.
    image: {
      ref: 'mcr.microsoft.com/devcontainers/typescript-node:{{nodeMajor}}',
      remoteUser: 'node',
    },
    extensions: ['dbaeumer.vscode-eslint', 'esbenp.prettier-vscode', 'Tobermory.es6-string-html'],
    settings: [
      { key: 'editor.codeActionsOnSave', value: { 'source.fixAll.eslint': 'explicit' } },
      { key: 'eslint.validate', value: ['javascript', 'typescript', 'html'] },
      { key: 'typescript.preferences.importModuleSpecifier', value: 'relative' },
      { key: 'typescript.updateImportsOnFileMove.enabled', value: 'always' },
    ],
    remoteEnv: [
      { name: 'PATH', value: '${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}' },
      {
        name: 'CHOKIDAR_USEPOLLING',
        value: 'true',
        why:
          'Reliable file-watching for chokidar-based watchers (dev servers, `nx watch`, test runners) over Docker\n' +
          'bind mounts. (Replaces the legacy `poll` option on serve targets, which the modern\n' +
          '@angular/build:dev-server schema rejects.)',
      },
      { name: 'CHOKIDAR_INTERVAL', value: '1000' },
    ],
    mounts: [
      {
        mount: 'source=${localWorkspaceFolderBasename}-node_modules,target=${containerWorkspaceFolder}/node_modules,type=volume',
        why: 'node_modules on a volume, not the bind mount — installs and module resolution at native speed.',
      },
    ],
    postCreate: [{ phase: 'install', piece: 'node-install' }],
  },
  docSections: ['node'],
  // The house installs into node_modules (the sync's devDependencies, the container's package-manager install),
  // so it makes sure a Node repo ignores it. Substring-matched: `/node_modules`, `node_modules/` already count.
  gitignore: [{ heading: 'Node dependencies (installed, never committed)', entries: ['node_modules'] }],
};
