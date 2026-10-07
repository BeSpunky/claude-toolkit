// 0.50.0 — the functions build stops copying `.env` into the bundle (firebase.json → functions.configDir reads the
// params files in place). Owed as a migration because the first 0.50 upgrade has no house-targets record: the house
// dropped `options.assets` entirely, and an undeclared key without a record is kept as the project's.
//
// The shapes it meets: the house entry alone (the key goes), beside a project asset (only the entry goes), a
// project-written `.env` asset of another shape (kept, reported), a functions project outside apps/, none at all.
import { createRequire } from 'node:module';

const { addProjectConfiguration, readProjectConfiguration } = createRequire(import.meta.url)('@nx/devkit');

const build = (root, assets) => ({
  executor: '@nx/esbuild:esbuild',
  outputs: ['{options.outputPath}'],
  options: { main: `${root}/src/main.ts`, outputPath: `dist/${root}`, generatePackageJson: true, ...(assets ? { assets } : {}) },
});
const HOUSE_ENTRY = (root) => ({ glob: '.env', input: root, output: '.' });
const functionsApp = (tree, root = 'apps/functions', assets = [HOUSE_ENTRY(root)]) =>
  addProjectConfiguration(tree, 'functions', { root, projectType: 'application', targets: { build: build(root, assets) } });
const optionsOf = (tree) => readProjectConfiguration(tree, 'functions').targets.build.options;

export default {
  name: '0.50.0 · read-functions-params-in-place',
  ladder: ['0.50.0/read-functions-params-in-place'],
  cases: [
    {
      name: "the house's .env asset alone: removed, and the emptied `assets` key with it",
      setup: (tree) => functionsApp(tree),
      expect: (tree, t) => {
        t.ok(!('assets' in optionsOf(tree)), `assets left: ${JSON.stringify(optionsOf(tree).assets)}`);
        t.ok(optionsOf(tree).generatePackageJson === true, 'the other options are untouched');
      },
    },
    {
      name: "beside a project asset: only the house's entry goes",
      setup: (tree) => functionsApp(tree, 'apps/functions', [HOUSE_ENTRY('apps/functions'), { glob: 'templates/**', input: 'apps/functions', output: 'templates' }]),
      expect: (tree, t) => {
        t.ok(JSON.stringify(optionsOf(tree).assets) === JSON.stringify([{ glob: 'templates/**', input: 'apps/functions', output: 'templates' }]), JSON.stringify(optionsOf(tree).assets));
      },
    },
    {
      name: "a .env asset of the project's own shape: kept, and reported as redundant",
      setup: (tree) => functionsApp(tree, 'apps/functions', [{ glob: '.env.*', input: 'apps/functions/config', output: '.' }]),
      expect: (tree, t, logs) => {
        t.ok(optionsOf(tree).assets.length === 1, 'kept');
        if (logs) t.ok(logs.some((line) => /still copies a params file/.test(line)), `not reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'a functions project outside apps/ (packages/backend): found by name',
      setup: (tree) => functionsApp(tree, 'packages/backend'),
      expect: (tree, t) => t.ok(!('assets' in optionsOf(tree)), JSON.stringify(optionsOf(tree).assets)),
    },
    {
      name: 'no functions project: nothing to do',
      setup: (tree) => addProjectConfiguration(tree, 'web', { root: 'apps/web', targets: {} }),
      expect: (tree, t) => t.ok(readProjectConfiguration(tree, 'web').targets && true, 'untouched'),
    },
  ],
};
