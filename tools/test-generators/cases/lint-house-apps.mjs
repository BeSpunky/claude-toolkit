// 0.50.0 lint-house-apps, the half that needs @nx/angular: an EXISTING house app created without lint (the shape
// every house Angular app had before 0.50.0) gains it through @nx/angular's own add-linting — so the platform
// firewall checks its imports. (The paths that need no @nx/angular are in tools/test-migrations.)
import { requireFromRepo } from '../../test-support/payload.mjs';
import { angularWorkspace } from '../workspaces.mjs';

const { getProjects, readProjectConfiguration, updateProjectConfiguration } = requireFromRepo('@nx/devkit');

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
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('migrations/0.50.0/lint-house-apps').default(tree);
      },
      expect: (tree, t, ctx) => {
        const root = getProjects(tree).get('shop').root;
        t.ok(getProjects(tree).get('shop').targets?.lint || tree.exists(`${root}/eslint.config.mjs`), 'linted');
        t.ok(ctx.logs.some((line) => line.includes('`shop`: lint added')), `said: ${ctx.logs}`);
      },
    },
  ],
};
