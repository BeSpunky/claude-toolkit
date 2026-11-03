// 0.51.2 — a library the house left with no spec stops failing `nx test`, on the runners that can be told.
//
// The real exit codes (1 without, 0 with, 1 on a failing spec) are checked by a real `nx test`, which a Tree cannot do.
// Here: which libraries the rung touches, the edit, and every report. The configs are the ones @nx/vitest and @nx/jest
// wrote on Nx 24.0.3; the rung skips on the option itself, which no release shipped, so there are no historical shapes.
import { createRequire } from 'node:module';

const { addProjectConfiguration } = createRequire(import.meta.url)('@nx/devkit');

const ROOT = 'packages/navigation-core';
const VITE = `/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig(() => ({
  root: import.meta.dirname,
  plugins: [angular({ tsconfig: './tsconfig.spec.json' })],
  test: {
    name: 'navigation-core',
    watch: false,
    globals: true,
  },
}));
`;
const JEST = `module.exports = {
  displayName: 'lib',
  preset: '../../jest.preset.js',
};
`;
const NOTE = '// This library ships no spec of its own. A spec added later still runs, and still fails the target when it fails.';

function lib(tree, { name = 'navigation-core', root = ROOT, tags = ['type:navigation', 'platform:web'], test, files = { 'vite.config.mts': VITE } } = {}) {
  addProjectConfiguration(tree, name, { root, projectType: 'library', tags, targets: test ? { test } : {} });
  tree.write(`${root}/src/index.ts`, 'export const a = 1;\n');
  for (const [path, text] of Object.entries(files)) tree.write(`${root}/${path}`, text);
}

/** Left alone: every file as given, and the reason in the log. */
const leftAlone = (file, text, reason) => (tree, t, logs) => {
  t.equal(tree.read(file, 'utf8'), text, file);
  if (logs) t.ok(logs.some((line) => reason.test(line)), `the reason is reported: ${logs.join(' | ')}`);
};

export default {
  name: '0.51.2 · pass-libraries-with-no-specs',
  ladder: ['0.51.2/pass-libraries-with-no-specs'],
  cases: [
    {
      name: 'navigation-core on Vitest: the option goes in the test block, what was there stays',
      setup: (tree) => lib(tree),
      expect: (tree, t, logs) => {
        const file = `${ROOT}/vite.config.mts`;
        t.has(file, `  test: {\n    ${NOTE}\n    passWithNoTests: true,\n    name: 'navigation-core',\n    watch: false,`);
        t.has(file, "plugins: [angular({ tsconfig: './tsconfig.spec.json' })],");
        if (logs) t.ok(logs.some((line) => line.includes(file)), `the file is named: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'a vitest.config.ts and an older bare Analog config take it the same way',
      setup: (tree) => lib(tree, { files: { 'vitest.config.ts': VITE.replace("angular({ tsconfig: './tsconfig.spec.json' })", 'angular()') } }),
      expect: (tree, t) => t.has(`${ROOT}/vitest.config.ts`, 'passWithNoTests: true,'),
    },
    ...[
      ['a Jest library, module.exports', 'jest.config.cts', JEST],
      ['a Jest library, export default', 'jest.config.ts', JEST.replace('module.exports =', 'export default')],
    ].map(([what, name, text]) => ({
      name: `${what}: the option is the config's first key`,
      setup: (tree) => lib(tree, { files: { [name]: text } }),
      expect: (tree, t) => t.has(`${ROOT}/${name}`, `{\n  ${NOTE}\n  passWithNoTests: true,\n  displayName: 'lib',`),
    })),
    {
      name: 'an explicit Jest target with its config named: that file gets it, the target is untouched',
      setup: (tree) => lib(tree, { test: { executor: '@nx/jest:jest', options: { jestConfig: `${ROOT}/jest.config.ts` } }, files: { 'jest.config.ts': JEST } }),
      expect: (tree, t) => {
        t.has(`${ROOT}/jest.config.ts`, 'passWithNoTests: true,');
        t.equal(t.json(`${ROOT}/project.json`).targets.test.options, { jestConfig: `${ROOT}/jest.config.ts` }, 'target options');
      },
    },
    {
      name: 'a design system on Jest, by its tag',
      setup: (tree) => lib(tree, { name: 'ui', root: 'packages/ui', tags: ['type:design-system'], files: { 'jest.config.ts': JEST } }),
      expect: (tree, t) => t.has('packages/ui/jest.config.ts', 'passWithNoTests: true,'),
    },
    {
      name: 'a pre-tag design system, by its name',
      setup: (tree) => lib(tree, { name: 'design-system', root: 'tools/design-system', tags: [], files: { 'jest.config.ts': JEST } }),
      expect: (tree, t) => t.has('tools/design-system/jest.config.ts', 'passWithNoTests: true,'),
    },
    {
      name: 'an adopt-extracted shim, by its marker',
      setup: (tree) => lib(tree, { name: 'core', root: 'packages/core', tags: [], files: { 'vite.config.mts': VITE, 'extraction.json': '{"status":"adopted-shim"}\n' } }),
      expect: (tree, t) => t.has('packages/core/vite.config.mts', 'passWithNoTests: true,'),
    },
    {
      name: 'every other library is not this rung\'s: an untagged one, an extraction not yet a shim, an application named design-system',
      setup: (tree) => {
        lib(tree, { name: 'plain', root: 'packages/plain', tags: [] });
        lib(tree, { name: 'staged', root: 'packages/staged', tags: [], files: { 'vite.config.mts': VITE, 'extraction.json': '{"status":"extracted"}\n' } });
        addProjectConfiguration(tree, 'design-system', { root: 'apps/design-system', projectType: 'application', targets: {} });
        tree.write('apps/design-system/vite.config.mts', VITE);
      },
      expect: (tree, t) => {
        for (const file of ['packages/plain/vite.config.mts', 'packages/staged/vite.config.mts', 'apps/design-system/vite.config.mts']) t.equal(tree.read(file, 'utf8'), VITE, file);
      },
    },
    {
      name: 'a project with its own spec: nothing to do, the option cannot hide it',
      setup: (tree) => lib(tree, { files: { 'vite.config.mts': VITE, 'src/lib/mine.spec.ts': "it('x', () => {});\n" } }),
      expect: leftAlone(`${ROOT}/vite.config.mts`, VITE, /Left navigation-core: it has its own spec \(packages\/navigation-core\/src\/lib\/mine\.spec\.ts\)/),
    },
    {
      name: 'a spec outside src counts as its own too',
      setup: (tree) => lib(tree, { files: { 'vite.config.mts': VITE, 'tests/mine.test.ts': "it('x', () => {});\n" } }),
      expect: leftAlone(`${ROOT}/vite.config.mts`, VITE, /it has its own spec/),
    },
    {
      name: 'an already stated config: quiet',
      setup: (tree) => lib(tree, { files: { 'vite.config.mts': VITE.replace('test: {', 'test: {\n    passWithNoTests: true,') } }),
      expect: (tree, t, logs) => {
        t.equal(tree.read(`${ROOT}/vite.config.mts`, 'utf8').match(/passWithNoTests/g).length, 1, 'stated once');
        if (logs) t.equal(logs, [], 'nothing to report');
      },
    },
    {
      name: 'the config says false: its decision, reported',
      setup: (tree) => lib(tree, { files: { 'vite.config.mts': VITE.replace('test: {', 'test: {\n    passWithNoTests: false,') } }),
      expect: leftAlone(`${ROOT}/vite.config.mts`, VITE.replace('test: {', 'test: {\n    passWithNoTests: false,'), /says `passWithNoTests: false`/),
    },
    {
      name: 'an option commented out is no decision',
      setup: (tree) => lib(tree, { files: { 'vite.config.mts': VITE.replace('test: {', 'test: {\n    // passWithNoTests: false,') } }),
      expect: (tree, t) => t.has(`${ROOT}/vite.config.mts`, 'passWithNoTests: true,'),
    },
    {
      name: 'the target says true: quiet, the config untouched',
      setup: (tree) => lib(tree, { test: { executor: '@nx/vite:test', options: { passWithNoTests: true } } }),
      expect: (tree, t) => t.equal(tree.read(`${ROOT}/vite.config.mts`, 'utf8'), VITE, 'config'),
    },
    {
      name: 'the target says false: reported',
      setup: (tree) => lib(tree, { test: { executor: '@nx/vite:test', options: { passWithNoTests: false } } }),
      expect: leftAlone(`${ROOT}/vite.config.mts`, VITE, /its test target says `passWithNoTests: false`/),
    },
    {
      name: 'another executor: reported, whichever config lies around',
      setup: (tree) => lib(tree, { test: { executor: '@nx/angular:unit-test' } }),
      expect: leftAlone(`${ROOT}/vite.config.mts`, VITE, /its test target uses @nx\/angular:unit-test/),
    },
    {
      name: 'a target naming a config that is not there: reported',
      setup: (tree) => lib(tree, { test: { executor: '@nx/vitest:test', options: { configFile: 'elsewhere.mts' } } }),
      expect: leftAlone(`${ROOT}/vite.config.mts`, VITE, /names elsewhere\.mts/),
    },
    {
      name: 'no runner config: reported',
      setup: (tree) => lib(tree, { files: {} }),
      expect: (tree, t, logs) => {
        if (logs) t.ok(logs.some((line) => /Left navigation-core: it has no vite, vitest or jest config/.test(line)), logs.join(' | '));
      },
    },
    {
      name: 'several runner configs: reported, both untouched',
      setup: (tree) => lib(tree, { files: { 'vite.config.mts': VITE, 'jest.config.ts': JEST } }),
      expect: leftAlone(`${ROOT}/vite.config.mts`, VITE, /it has several runner configs/),
    },
    ...[
      ['a test block that is a variable', VITE.replace('test: {', 'test: shared, unused: {'), /does not have one `test: \{` block/],
      ['a test block on one line', VITE.replace(/test: \{[\s\S]*?\n  \},/, "test: { name: 'x' },"), /does not have one `test: \{` block/],
      ['no test block', VITE.replace(/  test: \{[\s\S]*?\n  \},\n/, ''), /does not have one `test: \{` block/],
      ['several projects', VITE.replace('test: {', "projects: ['a', 'b'],\n  test: {"), /declares several projects/],
    ].map(([what, text, reason]) => ({
      name: `${what}: not the house's shape, reported`,
      setup: (tree) => lib(tree, { files: { 'vite.config.mts': text } }),
      expect: leftAlone(`${ROOT}/vite.config.mts`, text, reason),
    })),
    {
      name: 'a Jest config exporting a name: not the house\'s shape, reported',
      setup: (tree) => lib(tree, { files: { 'jest.config.ts': 'const config = {};\nexport default config;\n' } }),
      expect: leftAlone(`${ROOT}/jest.config.ts`, 'const config = {};\nexport default config;\n', /does not have one `module\.exports = \{`/),
    },
    {
      name: 'a workspace without such a library: nothing',
      setup: () => {},
      expect: (tree, t, logs) => {
        if (logs) t.equal(logs, [], 'nothing to report');
      },
    },
  ],
};
