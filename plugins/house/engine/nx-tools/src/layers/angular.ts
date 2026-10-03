// `angular` — an Angular application (or component library).
//
// REQUIRES `nx` and `node` (DECISION re-cut). It used to require `web`, but a component-library-only Angular
// workspace — no dev-server, nothing to serve — is a legitimate shape, and requiring `web` declared it
// impossible. `node` it does need: an Angular workspace IS a Node project (its plugin, compiler and app live in
// package.json), so a scaffold that ensures Angular creates the package.json host for it (phase 6).
//
// `@nx/angular` counts, and must. What every guard on this layer actually protects is a dynamic
// `import('@nx/angular/generators')` — so the honest question is "is the Angular PLUGIN here?", not "has an
// Angular app been built yet". `nx add @nx/angular` installs the plugin WITHOUT `@angular/core` (verified),
// which only arrives with the first app; detecting on `@angular/core` alone reported the layer ABSENT at
// exactly the moment the `app` generator runs, so its guard rejected the generator whose job is to create
// the app. The executor evidence catches an Angular app built in a workspace that declares neither.
import type { LayerDescriptor } from './descriptor';
import { projectExists } from './evidence';
import { adapter } from '../adapters/registry';

/** The Angular stack adapter — THE source of what makes a target Angular, and of its dev-server's port. */
const stack = adapter('angular');

export const angular: LayerDescriptor = {
  id: 'angular',
  title: 'Angular application',
  requires: ['nx', 'node'],
  evidence: {
    dependencies: ['@angular/core', '@nx/angular'],
    executors: stack.executors,
  },
  ensurable: { new: true, upgrade: false },
  ensureHint: '`nx add @nx/angular`, then `nx g @bespunky/nx-tools:app --name=<name>`',
  nxPlugin: '@nx/angular',
  brings: 'the Angular editor extensions, the dev-server leaf, the Angular CLI MCP + agent skills',
  generators: {
    // The Angular adapter's half of the worktree dev loop: the dev-only tab label (glue rewritten every sync; the
    // app.config.ts provider only when this run CREATES the layer). Quietly skipped when the sync's app is not a
    // project — the web layer's own per-app steps already report that.
    app: [
      {
        generator: 'worktree-tab-label',
        args: (ctx) => [`--project=${ctx.app}`, ...(ctx.ensured.has('angular') ? ['--wireProviders'] : [])],
        skip: (ctx) => (projectExists(ctx.tree, ctx.app) ? null : { reason: `no project named '${ctx.app}' — no worktree tab label to refresh.`, partial: false }),
      },
    ],
    // The Angular CLI MCP server + the Angular agent skills' gitignore rule.
    workspace: [{ generator: 'angular-ai' }],
  },
  docSections: ['angular', 'ui', 'monorepo'],
  devcontainer: {
    extensions: ['Angular.ng-template'],
    ports: [{ port: stack.devServer!.basePort, label: 'Angular Dev Server', onAutoForward: 'openPreview' }],
    mounts: [
      {
        mount: 'source=${localWorkspaceFolderBasename}-angular,target=${containerWorkspaceFolder}/.angular,type=volume',
        why: "The Angular build cache on a volume (machine-local; never on the bind mount).",
      },
    ],
    postCreate: [{ phase: 'provision', piece: 'angular-skills' }],
  },
  // The Angular-only skills (angular-architecture, angular-native-wrappers) — "something to wear".
  claudePlugins: ['bespunky-angular@claude-toolkit'],
};
