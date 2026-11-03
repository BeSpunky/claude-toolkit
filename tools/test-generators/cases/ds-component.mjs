// A COMPONENT PROMOTED INTO THE DESIGN SYSTEM, and the secondary entry point it lands in.
//
// What is asserted is the shape that decides whether the library builds: the component beside its barrel, the barrel
// re-exporting that file. @nx/angular's `path` names the FILE, not the directory, so handing it `<entry>/src` wrote
// `<entry>/src.ts` beside the folder, the barrel pointed at nothing, and the library failed TS2307 on its next build.
// Delegates to @nx/angular, an optional peer this repo does not install: see the harness header.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { angularWorkspace, SCOPE } from '../workspaces.mjs';

const { addProjectConfiguration, writeJson } = requireFromRepo('@nx/devkit');
const ROOT = 'packages/design-system';

function entryIsWhole(tree, t, entry, name) {
  for (const extension of ['ts', 'html', 'scss', 'spec.ts']) t.exists(`${entry}/src/${name}.${extension}`);
  t.has(`${entry}/src/index.ts`, `export * from './${name}';`);
  t.has(`${entry}/src/${name}.ts`, `templateUrl: './${name}.html'`);
  t.ok(!tree.exists(`${entry}/src.ts`), 'nothing written beside the entry\'s src folder');
}

const dsComponent = ['paths', 'workspaces-npm', 'workspaces-pnpm'].map((link) => ({
  name: `packages × ${link}: the component sits beside its barrel, which re-exports it, and its SCSS reads tokens`,
  needs: ['@nx/angular', '@nx/js'],
  setup: async (ctx) => {
    const tree = angularWorkspace({ layout: 'packages', link });
    await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
    return tree;
  },
  run: async (tree, ctx) => {
    await ctx.load('generators/ds-component/generator').default(tree, { name: 'button', skipFormat: true });
  },
  expect: (tree, t) => {
    const entry = `${ROOT}/button`;
    entryIsWhole(tree, t, entry, 'button');
    t.has(`${entry}/src/button.scss`, "@use 'design-system/styles' as ds;");
    t.equal(t.json(`${entry}/ng-package.json`).lib.entryFile, 'src/index.ts', 'the entry file');
    t.ok(t.json(`${entry}/ng-package.json`).lib.styleIncludePaths.includes('../..'), 'the sass channel');
  },
}));

const secondaryEntrypoint = {
  name: 'secondary-entrypoint --component=standalone, on its own: the same whole entry',
  needs: ['@nx/angular', '@nx/js'],
  once: 'it CREATES the entry: re-running it over one is what the ds-component guard exists to prevent',
  setup: () => {
    const tree = angularWorkspace({ layout: 'packages', link: 'paths' });
    addProjectConfiguration(tree, 'ui', { root: 'packages/ui', sourceRoot: 'packages/ui/src', projectType: 'library', prefix: 'ui', targets: { build: { executor: '@nx/angular:package' } } });
    writeJson(tree, 'packages/ui/package.json', { name: `@${SCOPE}/ui`, version: '0.0.1' });
    writeJson(tree, 'packages/ui/ng-package.json', { lib: { entryFile: 'src/index.ts' } });
    tree.write('packages/ui/src/index.ts', 'export {};\n');
    return tree;
  },
  run: async (tree, ctx) => {
    await ctx.load('generators/secondary-entrypoint/generator').default(tree, { library: 'ui', name: 'card', component: 'standalone', skipFormat: true });
  },
  expect: (tree, t) => entryIsWhole(tree, t, 'packages/ui/card', 'card'),
};

export default { name: 'ds-component', cases: [...dsComponent, secondaryEntrypoint] };
