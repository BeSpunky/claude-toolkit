// NAVIGATION-CORE — the house's own workspace-internal Angular library: born `type:navigation` + `platform:web`, and
// its Analog test config names tsconfig.spec.json (without it, every Nx graph computation warns about a
// tsconfig.app.json a library never has — adapters/angular/analog-tsconfig).
import { requireFromRepo } from '../../test-support/payload.mjs';
import { angularWorkspace } from '../workspaces.mjs';

const { getProjects } = requireFromRepo('@nx/devkit');

export default {
  name: 'navigation-core · a classified library with a quiet test config',
  cases: [
    {
      name: 'apps-libs × paths: tagged web, the Analog plugin told which tsconfig to use',
      needs: ['@nx/angular', '@nx/js'],
      setup: () => angularWorkspace({ layout: 'apps-libs', link: 'paths' }),
      run: async (tree, ctx) => {
        await ctx.load('generators/navigation-core/generator').default(tree, {});
      },
      expect: (tree, t) => {
        const project = getProjects(tree).get('navigation-core');
        t.equal(project?.tags, ['type:navigation', 'platform:web'], 'tags');
        t.ok(!tree.children('libs/navigation-core/src/lib').some((file) => /\.spec\./.test(file)), 'the demo spec is gone');
        const config = ['vite.config.mts', 'vitest.config.mts'].map((f) => `libs/navigation-core/${f}`).find((f) => tree.exists(f));
        t.ok(config, 'a vite/vitest config was written');
        if (config) {
          t.has(config, "angular({ tsconfig: './tsconfig.spec.json' })");
          t.ok(!/\bangular\(\s*\)/.test(t.read(config)), `a bare angular() is left:\n${t.read(config)}`);
          // The demo spec is gone and the kernel ships none: without this, `nx test navigation-core` exits 1.
          t.has(config, 'passWithNoTests: true,');
        }
      },
    },
  ],
};
