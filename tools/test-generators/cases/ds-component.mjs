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
const UNIT_TEST = '@nx/angular:unit-test';
const REACH = { include: ['**/*.spec.ts', '**/*.test.ts', '../**/*.spec.ts', '../**/*.test.ts'], exclude: ['../**/node_modules/**', '../**/dist/**'] };
const SPEC_TSCONFIG_INCLUDE = ['src/**/*.ts', 'src/**/*.d.ts', '**/*.spec.ts', '**/*.test.ts'];

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
    const test = t.json(`${ROOT}/project.json`).targets.test;
    if (test?.executor === UNIT_TEST) t.equal({ include: test.options.include, exclude: test.options.exclude }, REACH, 'the entry\'s spec runs: secondary-entrypoint aimed the design system\'s target');
  },
}));

const secondaryEntrypoint = {
  name: 'secondary-entrypoint --component=standalone, on its own: the same whole entry',
  needs: ['@nx/angular', '@nx/js'],
  once: 'it CREATES the entry: re-running it over one is what the ds-component guard exists to prevent',
  setup: () => {
    const tree = angularWorkspace({ layout: 'packages', link: 'paths' });
    addProjectConfiguration(tree, 'ui', { root: 'packages/ui', sourceRoot: 'packages/ui/src', projectType: 'library', prefix: 'ui', targets: { build: { executor: '@nx/angular:package' }, test: { executor: UNIT_TEST, options: { watch: false } } } });
    writeJson(tree, 'packages/ui/tsconfig.spec.json', { include: ['src/**/*.ts', 'src/**/*.d.ts'] });
    writeJson(tree, 'packages/ui/package.json', { name: `@${SCOPE}/ui`, version: '0.0.1' });
    writeJson(tree, 'packages/ui/ng-package.json', { lib: { entryFile: 'src/index.ts' } });
    tree.write('packages/ui/src/index.ts', 'export {};\n');
    return tree;
  },
  run: async (tree, ctx) => {
    await ctx.load('generators/secondary-entrypoint/generator').default(tree, { library: 'ui', name: 'card', component: 'standalone', skipFormat: true });
  },
  expect: (tree, t) => {
    entryIsWhole(tree, t, 'packages/ui/card', 'card');
    t.equal(t.json('packages/ui/project.json').targets.test.options, { watch: false, ...REACH }, 'any library with an entry runs its specs, not only the design system');
    t.equal(t.json('packages/ui/tsconfig.spec.json').include, SPEC_TSCONFIG_INCLUDE, 'and they are in a project of the library');
    t.has('packages/ui/tsconfig.lib.json', '**/src/**/*.spec.ts');
  },
};

// The seam on its own: it reads an existing project's config, so no @nx/angular needed.
const UI = 'packages/ui';
function reach(name, { test = { executor: UNIT_TEST, options: { watch: false } }, targets = { test }, sourceRoot = `${UI}/src`, tsconfig = { include: ['src/**/*.ts', 'src/**/*.d.ts'] } }, expect) {
  return {
    name: `reachEntryPointSpecs: ${name}`,
    setup: () => {
      const tree = angularWorkspace({ layout: 'packages', link: 'paths' });
      addProjectConfiguration(tree, 'ui', { root: UI, sourceRoot, projectType: 'library', targets });
      if (tsconfig) writeJson(tree, `${UI}/tsconfig.spec.json`, tsconfig);
      return tree;
    },
    run: async (tree, ctx) => ctx.load('adapters/angular/entry-point-specs').reachEntryPointSpecs(tree, 'ui'),
    expect: (tree, t, ctx) => expect(t, t.json(`${UI}/project.json`).targets, ctx),
  };
}
const leftReported = (reason, targets) => (t, actual, ctx) => {
  t.equal(actual, targets, 'the target stands');
  t.equal(t.json(`${UI}/tsconfig.spec.json`).include, ['src/**/*.ts', 'src/**/*.d.ts'], 'and so does the tsconfig');
  t.ok(ctx.logs.some((line) => reason.test(line)), `the reason is reported: ${ctx.logs.join(' | ')}`);
};
const own = { executor: UNIT_TEST, options: { include: ['src/app/**/*.spec.ts'] } };
const ownInConfiguration = { executor: UNIT_TEST, configurations: { ci: { exclude: ['x'] } } };
const seam = [
  reach('the target and the tsconfig are aimed', {}, (t, targets) => {
    t.equal(targets.test.options, { watch: false, ...REACH }, 'the target');
    t.equal(t.json(`${UI}/tsconfig.spec.json`).include, SPEC_TSCONFIG_INCLUDE, 'the tsconfig');
  }),
  reach('a source root deeper in the library: the globs climb out of where it is', { sourceRoot: `${UI}/src/public` }, (t, targets) => {
    t.equal(targets.test.options.include.at(-1), '../../**/*.test.ts', 'two levels up');
    t.equal(targets.test.options.exclude, ['../../**/node_modules/**', '../../**/dist/**'], 'the exclude too');
  }),
  reach('a source root that is the library: the runner walks it all by default; only the tsconfig gains', { sourceRoot: UI }, (t, targets) => {
    t.equal(targets.test.options, { watch: false }, 'no include');
    t.equal(t.json(`${UI}/tsconfig.spec.json`).include, SPEC_TSCONFIG_INCLUDE, 'the tsconfig');
  }),
  reach('a target under another name is the same runner', { targets: { unit: { executor: UNIT_TEST } } }, (t, targets) => t.equal(targets.unit.options, REACH, 'aimed')),
  reach('a tsconfig stating no include already holds everything', { tsconfig: { compilerOptions: {} } }, (t) => t.ok(!('include' in t.json(`${UI}/tsconfig.spec.json`)), 'none added')),
  reach('no tsconfig.spec.json is no problem', { tsconfig: null }, (t, targets) => t.equal(targets.test.options, { watch: false, ...REACH }, 'the target')),
  reach('another runner: nothing to do', { test: { executor: '@nx/jest:jest' } }, (t, targets, ctx) => {
    t.equal(targets.test, { executor: '@nx/jest:jest' }, 'untouched');
    t.equal(t.json(`${UI}/tsconfig.spec.json`).include, ['src/**/*.ts', 'src/**/*.d.ts'], 'untouched');
    t.equal(ctx.logs, [], 'and nothing to say');
  }),
  reach("a target's own include: left, reported", { test: own }, leftReported(/ui: its test target declares its own include\/exclude/, { test: own })),
  reach('an exclude in a configuration: left, reported', { test: ownInConfiguration }, leftReported(/ui: its test target declares its own include\/exclude/, { test: ownInConfiguration })),
  reach('a source root outside the library: left, reported', { sourceRoot: 'elsewhere/src', test: { executor: UNIT_TEST } }, leftReported(/ui: its source root elsewhere\/src is outside the library/, { test: { executor: UNIT_TEST } })),
];

export default { name: 'ds-component', cases: [...dsComponent, secondaryEntrypoint, ...seam] };
