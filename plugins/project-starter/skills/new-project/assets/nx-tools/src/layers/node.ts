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
// NOT ENSURABLE BY A SYNC: a sync never turns a repo into a Node project (no package.json → the Nx wrapper). A
// scaffold creates one as part of laying the Nx floor (create-nx-workspace), hence `via: nx`.
import type { LayerDescriptor } from './descriptor';

export const node: LayerDescriptor = {
  id: 'node',
  title: 'Node project (a root package.json)',
  requires: [],
  evidence: { files: ['package.json'] },
  ensurable: { scaffold: { via: 'nx' }, sync: false },
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
      {
        // `.nx` belongs to the NODE host, not to the `nx` layer: on the Nx WRAPPER host `.nx/` carries the
        // COMMITTED `nxw.js`, and a volume over the folder would hide it — `./nx` would not exist in the
        // container. On this host `.nx/` is machine-local cache and nothing else.
        mount: 'source=${localWorkspaceFolderBasename}-nx,target=${containerWorkspaceFolder}/.nx,type=volume',
        why: "Nx's cache and workspace data on a volume (this host's .nx/ holds machine-local state only).",
      },
    ],
    postCreate: [{ phase: 'install', piece: 'node-install' }],
  },
  docSections: ['node'],
};
