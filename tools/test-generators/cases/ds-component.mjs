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
const REACH = { include: ['**/*.spec.ts', '**/*.test.ts', '../**/*.spec.ts', '../**/*.test.ts'], exclude: ['../**/node_modules/**', '../dist/**'] };
const SPEC_TSCONFIG_INCLUDE = ['src/**/*.ts', 'src/**/*.d.ts', '**/src/**/*.ts'];

function entryIsWhole(tree, t, entry, name) {
  for (const extension of ['ts', 'html', 'scss', 'spec.ts']) t.exists(`${entry}/src/${name}.${extension}`);
  t.has(`${entry}/src/index.ts`, `export * from './${name}';`);
  t.has(`${entry}/src/${name}.ts`, `templateUrl: './${name}.html'`);
  t.ok(!tree.exists(`${entry}/src.ts`), 'nothing written beside the entry\'s src folder');
}

const jsonOf = (tree, path) => JSON.parse(tree.read(path, 'utf8'));

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
    t.equal(test?.executor, UNIT_TEST, 'the fixture\'s runner: a Jest fixture would test nothing here');
    t.equal({ include: test.options.include, exclude: test.options.exclude }, REACH, 'the entry\'s spec runs: secondary-entrypoint aimed the design system\'s target');
  },
}));

const handMadeEntry = {
  name: "a re-run over an entry made by hand: the library's own sass channel and its target's reach are re-asserted, the files are not",
  needs: ['@nx/angular', '@nx/js'],
  setup: async (ctx) => {
    const tree = angularWorkspace({ layout: 'packages', link: 'paths' });
    await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
    const project = jsonOf(tree, `${ROOT}/project.json`);
    const { include, exclude, ...options } = project.targets.test.options ?? {};
    tree.write(`${ROOT}/project.json`, JSON.stringify({ ...project, targets: { ...project.targets, test: { ...project.targets.test, options } } }, null, 2));
    const ngPackage = jsonOf(tree, `${ROOT}/ng-package.json`);
    delete ngPackage.lib.styleIncludePaths;
    tree.write(`${ROOT}/ng-package.json`, JSON.stringify(ngPackage, null, 2));
    tree.write(`${ROOT}/card/ng-package.json`, '{ "lib": { "entryFile": "src/index.ts" } }\n');
    tree.write(`${ROOT}/card/src/mine.ts`, '// mine\n');
    return tree;
  },
  run: async (tree, ctx) => {
    await ctx.load('generators/ds-component/generator').default(tree, { name: 'card', skipFormat: true });
  },
  expect: (tree, t) => {
    t.equal(t.json(`${ROOT}/ng-package.json`).lib.styleIncludePaths, ['..'], "the library's: the test builder reads only this one");
    const { include, exclude } = t.json(`${ROOT}/project.json`).targets.test.options;
    t.equal({ include, exclude }, REACH, 'the entry\'s spec runs');
    t.equal(tree.read(`${ROOT}/card/src/mine.ts`, 'utf8'), '// mine\n', 'the files are its own');
  },
};

const secondaryEntrypoint = {
  name: 'secondary-entrypoint --component=standalone, on its own: the same whole entry',
  needs: ['@nx/angular', '@nx/js'],
  once: 'it CREATES the entry: re-running it over one is what the ds-component guard exists to prevent',
  setup: () => {
    const tree = angularWorkspace({ layout: 'packages', link: 'paths' });
    addProjectConfiguration(tree, 'ui', { root: 'packages/ui', sourceRoot: 'packages/ui/src', projectType: 'library', prefix: 'ui', targets: { build: { executor: '@nx/angular:package' }, test: { executor: UNIT_TEST, options: { watch: false } } } });
    writeJson(tree, 'packages/ui/tsconfig.spec.json', { include: ['src/**/*.ts', 'src/**/*.d.ts'] });
    writeJson(tree, 'packages/ui/tsconfig.lib.json', { include: ['src/**/*.ts'] });
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
    t.ok(t.json('packages/ui/tsconfig.lib.json').exclude.includes('**/src/**/*.spec.ts'), 'and out of the one the build uses');
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
    t.equal(t.json(`${UI}/tsconfig.spec.json`).exclude, ['dist/**'], 'not a build output at its root');
  }),
  reach("the tsconfig's own exclude is kept", { tsconfig: { include: ['src/**/*.ts'], exclude: ['src/legacy/**'] } }, (t) => t.equal(t.json(`${UI}/tsconfig.spec.json`).exclude, ['src/legacy/**', 'dist/**'], 'added to')),
  reach('a stated exclude replaces the default, so an outDir inside the library stays out', { tsconfig: { compilerOptions: { outDir: './out-tsc/vitest' }, include: ['src/**/*.ts'] } }, (t) => t.equal(t.json(`${UI}/tsconfig.spec.json`).exclude, ['out-tsc/vitest/**', 'dist/**'], 'kept out')),
  reach('an outDir above the library is out of its include anyway', { tsconfig: { compilerOptions: { outDir: '../../dist/out-tsc' }, include: ['src/**/*.ts'] } }, (t) => t.equal(t.json(`${UI}/tsconfig.spec.json`).exclude, ['dist/**'], 'not named')),
  reach('a source root deeper in the library: the globs climb out of where it is', { sourceRoot: `${UI}/src/public` }, (t, targets) => {
    t.equal(targets.test.options.include.at(-1), '../../**/*.test.ts', 'two levels up');
    t.equal(targets.test.options.exclude, ['../../**/node_modules/**', '../../dist/**'], 'the exclude too');
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
  reach('a runner that may share the blindness: told, nothing touched', { test: { executor: '@angular/build:karma' } }, leftReported(/ui: its test target uses @angular\/build:karma.*may not run the specs/, { test: { executor: '@angular/build:karma' } })),
  reach('the same builder under its own name: aimed', { test: { executor: '@angular/build:unit-test' } }, (t, targets) => t.equal(targets.test.options, REACH, 'aimed')),
  reach('a source root outside the library: left, reported', { sourceRoot: 'elsewhere/src', test: { executor: UNIT_TEST } }, leftReported(/ui: its source root elsewhere\/src is outside the library/, { test: { executor: UNIT_TEST } })),
];

// The half the library port calls at birth: no entry point yet, so another runner has nothing to miss and nothing to be told.
const birth = [
  {
    name: 'aimUnitTestTargets: a library with no entry point is aimed',
    setup: () => {
      const tree = angularWorkspace({ layout: 'packages', link: 'paths' });
      addProjectConfiguration(tree, 'ui', { root: UI, sourceRoot: `${UI}/src`, projectType: 'library', targets: { test: { executor: UNIT_TEST, options: { watch: false } } } });
      writeJson(tree, `${UI}/tsconfig.spec.json`, { include: ['src/**/*.ts', 'src/**/*.d.ts'] });
      return tree;
    },
    run: async (tree, ctx) => ctx.load('adapters/angular/entry-point-specs').aimUnitTestTargets(tree, 'ui'),
    expect: (tree, t, ctx) => {
      t.equal(t.json(`${UI}/project.json`).targets.test.options, { watch: false, ...REACH }, 'the target');
      t.equal(t.json(`${UI}/tsconfig.spec.json`).include, SPEC_TSCONFIG_INCLUDE, 'the tsconfig');
      t.equal(ctx.logs, [], 'and it is not news');
    },
  },
  {
    name: 'aimUnitTestTargets: another runner has nothing to miss yet, so nothing is said',
    setup: () => {
      const tree = angularWorkspace({ layout: 'packages', link: 'paths' });
      addProjectConfiguration(tree, 'ui', { root: UI, sourceRoot: `${UI}/src`, projectType: 'library', targets: { test: { executor: '@angular/build:karma' } } });
      return tree;
    },
    run: async (tree, ctx) => ctx.load('adapters/angular/entry-point-specs').aimUnitTestTargets(tree, 'ui'),
    expect: (tree, t, ctx) => {
      t.equal(t.json(`${UI}/project.json`).targets.test, { executor: '@angular/build:karma' }, 'untouched');
      t.equal(ctx.logs, [], 'silent');
    },
  },
];

export default { name: 'ds-component', cases: [...dsComponent, handMadeEntry, secondaryEntrypoint, ...seam, ...birth] };
