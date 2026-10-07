// 0.50.0 — the functions build stops copying `.env` into the bundle (firebase.json → functions.configDir reads the
// params files in place). Owed as a migration because the first 0.50 upgrade has no house-targets record: the house
// dropped `options.assets` entirely, and an undeclared key without a record is kept as the project's.
//
// The shapes it meets: the house entry alone (the key goes), beside a project asset (only the entry goes), a
// project-written `.env` asset of another shape (kept, reported), a functions project outside apps/, none at all.
// And both halves of the move, here (R9-3): firebase.json's functions block that deploys the bundle gains `configDir`
// before the asset goes — a configDir the project set is kept — and with no such block the asset STAYS, reported.
// And the inline esbuild options 0.50 replaced with the house esbuildConfig: the house's own go, the project's stay
// (reported).
//
// No historical shapes: the house entry shipped in ONE shape, from its introduction to its removal —
// `{ glob: '.env', input: root, output: '.' }` (git show 6b56f49:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/generator.ts;
// `git log -G"glob: '\.env"` finds no later edit), with `root` the functions project's own root ('apps/functions'
// until 5a05026, the resolved project home since) — exactly HOUSE_ENTRY below.
import { createRequire } from 'node:module';

const { addProjectConfiguration, readProjectConfiguration, updateProjectConfiguration, writeJson } = createRequire(import.meta.url)('@nx/devkit');
/** firebase.json as 0.49 left it: the functions block deploys the bundle, with no configDir. */
const firebaseJson = (tree, root = 'apps/functions', extra = {}) =>
  writeJson(tree, 'firebase.json', { functions: [{ source: `dist/${root}`, codebase: 'default', ...extra }], hosting: { public: 'x' } });

const build = (root, assets) => ({
  executor: '@nx/esbuild:esbuild',
  outputs: ['{options.outputPath}'],
  options: { main: `${root}/src/main.ts`, outputPath: `dist/${root}`, generatePackageJson: true, ...(assets ? { assets } : {}) },
});
const HOUSE_ENTRY = (root) => ({ glob: '.env', input: root, output: '.' });
const functionsApp = (tree, root = 'apps/functions', assets = [HOUSE_ENTRY(root)], withFirebaseJson = true) => {
  if (withFirebaseJson) firebaseJson(tree, root);
  addProjectConfiguration(tree, 'functions', { root, projectType: 'application', targets: { build: build(root, assets) } });
};
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
        t.equal(t.json('firebase.json').functions, [{ source: 'dist/apps/functions', codebase: 'default', configDir: 'apps/functions' }], 'R9-3: the rung itself makes Firebase read the params in place');
        t.equal(t.json('firebase.json').hosting, { public: 'x' }, 'the rest of firebase.json untouched');
      },
    },
    {
      name: 'R9-3: no functions block deploys the bundle (no firebase.json) — the asset, the params\' only channel, STAYS, reported',
      setup: (tree) => functionsApp(tree, 'apps/functions', [HOUSE_ENTRY('apps/functions')], false),
      expect: (tree, t, logs) => {
        t.equal(optionsOf(tree).assets, [HOUSE_ENTRY('apps/functions')], 'kept');
        t.missing('firebase.json');
        if (logs) t.ok(logs.some((line) => /still copies \.env into the bundle — left/.test(line)), `not reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'a configDir the project already set is kept; the asset still goes (the bundle copy is read by nobody)',
      setup: (tree) => {
        functionsApp(tree, 'apps/functions', [HOUSE_ENTRY('apps/functions')], false);
        firebaseJson(tree, 'apps/functions', { configDir: 'config/functions' });
      },
      expect: (tree, t) => {
        t.equal(t.json('firebase.json').functions[0].configDir, 'config/functions', 'the project\'s configDir');
        t.ok(!('assets' in optionsOf(tree)), JSON.stringify(optionsOf(tree).assets));
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
      expect: (tree, t) => {
        t.ok(!('assets' in optionsOf(tree)), JSON.stringify(optionsOf(tree).assets));
        t.equal(t.json('firebase.json').functions[0].configDir, 'packages/backend', 'configDir follows where it lives');
      },
    },
    {
      name: "the house's inline esbuildOptions: removed (the esbuildConfig replaces them; Nx refuses both)",
      setup: (tree) => {
        functionsApp(tree);
        const c = readProjectConfiguration(tree, 'functions');
        c.targets.build.options.esbuildOptions = { outExtension: { '.js': '.js' } };
        updateProjectConfiguration(tree, 'functions', c);
      },
      expect: (tree, t) => t.ok(!('esbuildOptions' in optionsOf(tree)), JSON.stringify(optionsOf(tree).esbuildOptions)),
    },
    {
      name: "esbuildOptions the project changed: kept, and reported",
      setup: (tree) => {
        functionsApp(tree, 'apps/functions', undefined);
        const c = readProjectConfiguration(tree, 'functions');
        c.targets.build.options.esbuildOptions = { outExtension: { '.js': '.js' }, define: { X: '1' } };
        updateProjectConfiguration(tree, 'functions', c);
      },
      expect: (tree, t, logs) => {
        t.ok(optionsOf(tree).esbuildOptions?.define?.X === '1', 'kept');
        if (logs) t.ok(logs.some((line) => /esbuild options of its own/.test(line)), `not reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'no functions project: nothing to do',
      setup: (tree) => addProjectConfiguration(tree, 'web', { root: 'apps/web', targets: {} }),
      expect: (tree, t) => t.ok(readProjectConfiguration(tree, 'web').targets && true, 'untouched'),
    },
  ],
};
