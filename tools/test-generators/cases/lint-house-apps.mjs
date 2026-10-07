// 0.50.0 lint-house-apps, the half that needs @nx/angular: an EXISTING house app created without lint (the shape
// every house Angular app had before 0.50.0) gains it through @nx/angular's own add-linting — so the platform
// firewall checks its imports — by @nx/eslint/plugin's inferred target, never the deprecated @nx/eslint:lint executor
// add-linting writes. (The paths that need no @nx/angular are in tools/test-migrations.)
import { requireFromRepo } from '../../test-support/payload.mjs';
import { angularWorkspace } from '../workspaces.mjs';

const { getProjects, readProjectConfiguration, updateProjectConfiguration, updateJson } = requireFromRepo('@nx/devkit');

export default {
  name: '0.50.0 lint-house-apps · an existing house app gains lint',
  cases: [
    {
      name: 'a pre-0.50 house app (no lint target, no eslint config): linted through @nx/angular:add-linting',
      needs: ['@nx/angular', '@nx/eslint'],
      setup: async (ctx) => {
        const tree = angularWorkspace({ layout: 'apps-libs', link: 'paths' });
        await ctx.load('generators/app/generator').default(tree, { name: 'shop', skipFormat: true });
        // Age it: what @nx/angular wrote for a house app before the adapter stated `linter: 'eslint'`.
        const config = readProjectConfiguration(tree, 'shop');
        delete config.targets.lint;
        config.targets.serve = { executor: '@bespunky/nx-tools:serve', continuous: true };
        updateProjectConfiguration(tree, 'shop', config);
        for (const file of ['eslint.config.mjs', '.eslintrc.json']) if (tree.exists(`${config.root}/${file}`)) tree.delete(`${config.root}/${file}`);
        // …and nothing infers a lint target for it (a 0.49 workspace never registered @nx/eslint/plugin).
        updateJson(tree, 'nx.json', (json) => ({ ...json, plugins: (json.plugins ?? []).filter((p) => (p?.plugin ?? p) !== '@nx/eslint/plugin') }));
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('migrations/0.50.0/lint-house-apps').default(tree);
      },
      expect: (tree, t, ctx) => {
        const shop = getProjects(tree).get('shop');
        t.has(`${shop.root}/eslint.config.mjs`, 'flat/angular');
        // Linted the way Nx recommends: @nx/eslint/plugin's inferred target — add-linting's deprecated executor converted.
        t.ok(!shop.targets?.lint, `no declared lint target (inferred): ${JSON.stringify(shop.targets?.lint)}`);
        t.ok(t.json('nx.json').plugins?.some((p) => p?.plugin === '@nx/eslint/plugin'), `@nx/eslint/plugin registered: ${JSON.stringify(t.json('nx.json').plugins)}`);
        t.ok(!JSON.stringify(t.json('nx.json')).includes('@nx/eslint:lint'), 'no targetDefault for the deprecated executor');
        t.ok(ctx.logs.some((line) => line.includes('`shop`: lint added')), `said: ${ctx.logs}`);
      },
    },
  ],
};
