// WORKSPACE LAYOUT — where apps and libraries live, resolved in a fixed order: nx.json `workspaceLayout` (Nx's own
// field, so Nx's generators agree with ours) → inferred from existing projects → the house default.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, angularApp, RESOLVED, LAYOUTS } from '../workspaces.mjs';

const { writeJson, updateJson } = requireFromRepo('@nx/devkit');
const resolve = (ctx, tree) => (ctx.layout = ctx.load('generators/_utils/workspace-layout').resolveWorkspaceLayout(tree));
const lib = (tree, root) => writeJson(tree, `${root}/project.json`, { name: root.split('/').pop(), root, projectType: 'library', targets: {} });

export default {
  name: 'workspace layout · resolution',
  cases: [
    ...Object.keys(LAYOUTS).map((layout) => ({
      name: `${layout}: resolves to ${RESOLVED[layout].appsDir}/ + ${RESOLVED[layout].libsDir}/`,
      setup: () => workspace({ layout }),
      run: (tree, ctx) => resolve(ctx, tree),
      expect: (tree, t, ctx) => t.equal(ctx.layout, RESOLVED[layout], 'layout'),
    })),
    {
      name: 'nx.json wins over the projects on disk',
      setup: () => {
        const tree = workspace({ layout: 'packages' });
        angularApp(tree, 'clients/web');
        lib(tree, 'libs/ui');
        return tree;
      },
      run: (tree, ctx) => resolve(ctx, tree),
      expect: (tree, t, ctx) => t.equal(ctx.layout, { appsDir: 'packages', libsDir: 'packages' }, 'declared layout'),
    },
    {
      name: 'nothing declared: inferred from where apps and libraries already live (and said so)',
      setup: () => {
        const tree = workspace();
        angularApp(tree, 'clients/web');
        angularApp(tree, 'clients/admin');
        angularApp(tree, 'apps/legacy');
        lib(tree, 'libs/ui');
        return tree;
      },
      run: (tree, ctx) => resolve(ctx, tree),
      expect: (tree, t, ctx) => {
        t.equal(ctx.layout, { appsDir: 'clients', libsDir: 'libs' }, 'the dominant directory per role');
        t.ok(ctx.logs.some((l) => l.includes('"clients/"') && l.includes('inferred from 2')), `inference not reported: ${ctx.logs.join(' | ')}`);
      },
    },
    {
      name: 'half declared: the other half is still inferred',
      setup: () => {
        const tree = workspace();
        updateJson(tree, 'nx.json', (json) => ({ ...json, workspaceLayout: { libsDir: './modules/' } }));
        angularApp(tree, 'clients/web');
        return tree;
      },
      run: (tree, ctx) => resolve(ctx, tree),
      expect: (tree, t, ctx) => t.equal(ctx.layout, { appsDir: 'clients', libsDir: 'modules' }, 'declared libsDir (normalised) + inferred appsDir'),
    },
    {
      name: 'tools/ is never evidence — the house\'s own tooling projects do not decide where libraries go',
      setup: () => {
        const tree = workspace();
        for (const name of ['shared-browser', 'worktree-domains']) lib(tree, `tools/${name}`);
        return tree;
      },
      run: (tree, ctx) => resolve(ctx, tree),
      expect: (tree, t, ctx) => t.equal(ctx.layout, RESOLVED.hybrid, 'the default, not tools/'),
    },
    {
      name: 'a package.json-only app (TS-solution) is evidence too',
      setup: () => {
        const tree = workspace({ link: 'workspaces-npm' });
        writeJson(tree, 'packages/web/package.json', { name: '@acme/web' });
        writeJson(tree, 'packages/web/tsconfig.app.json', {});
        return tree;
      },
      run: (tree, ctx) => resolve(ctx, tree),
      expect: (tree, t, ctx) => t.equal(ctx.layout.appsDir, 'packages', 'appsDir from a package.json app'),
    },
    {
      name: 'writeWorkspaceLayout records both halves in nx.json, and resolution reads them back',
      setup: () => workspace(),
      run: (tree, ctx) => {
        const W = ctx.load('generators/_utils/workspace-layout');
        W.writeWorkspaceLayout(tree, W.LAYOUTS['apps-libs']);
        resolve(ctx, tree);
      },
      expect: (tree, t, ctx) => {
        t.equal(t.json('nx.json').workspaceLayout, { appsDir: 'apps', libsDir: 'libs' }, 'nx.json workspaceLayout');
        t.equal(ctx.layout, { appsDir: 'apps', libsDir: 'libs' }, 'resolved');
      },
    },
  ],
};
