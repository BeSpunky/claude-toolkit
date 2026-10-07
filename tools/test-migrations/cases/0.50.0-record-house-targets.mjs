// 0.50.0 — the first house-targets record, written from what 0.49.2 wrote, only where the project still holds it.
//
// The shapes it meets: stock 0.49.2 projects (everything recorded), a functions project that lives elsewhere under
// another name (the frozen values rendered for it), hand edits (left out, so the merge reports instead of guessing),
// a set with a member removed (left out), a target 0.49.2 never wrote that the project made itself (never recorded:
// it stays the project's own), a record that already exists (never overwritten), and no house project at all.
import { createRequire } from 'node:module';

const { addProjectConfiguration, writeJson } = createRequire(import.meta.url)('@nx/devkit');
const RECORD = '.bespunky/house-targets.json';

/** functions as 0.49.2 wrote it, at `root`. */
const functionsTargets = (root) => ({
  build: {
    executor: '@nx/esbuild:esbuild',
    outputs: ['{options.outputPath}'],
    options: {
      outputPath: `dist/${root}`,
      main: `${root}/src/main.ts`,
      tsConfig: `${root}/tsconfig.app.json`,
      platform: 'node',
      format: ['cjs'],
      bundle: true,
      thirdParty: false,
      generatePackageJson: true,
      deleteOutputPath: true,
      assets: [{ glob: '.env', input: root, output: '.' }],
      esbuildOptions: { outExtension: { '.js': '.js' } },
    },
  },
  lint: { executor: '@nx/eslint:lint' },
  deploy: { executor: 'nx:run-commands', dependsOn: ['build'], options: { command: 'firebase deploy --only functions', cwd: '{workspaceRoot}' } },
  'push-secrets': { executor: 'nx:run-commands', options: { command: 'bash tools/push-secrets.sh', cwd: '{workspaceRoot}' } },
});
const emulators = (name) => ({
  continuous: true,
  executor: 'nx:run-commands',
  options: { command: 'bash tools/emulators.sh', cwd: '{workspaceRoot}' },
  dependsOn: [{ projects: [name], target: 'build' }],
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const stock = (tree, { root = 'apps/functions', name = 'functions', edit = () => undefined, suite = {} } = {}) => {
  const targets = functionsTargets(root);
  edit(targets);
  addProjectConfiguration(tree, name, { root, projectType: 'application', targets });
  addProjectConfiguration(tree, 'firebase', { root: 'firebase', projectType: 'application', targets: { emulators: emulators(name), ...suite } });
};
const recorded = (t) => t.json(RECORD)?.projects ?? {};

export default {
  name: '0.50.0 · record-house-targets',
  ladder: ['0.50.0/record-house-targets'],
  cases: [
    {
      name: 'stock 0.49.2 house projects: every target recorded as 0.49.2 wrote it, by canonical name',
      setup: (tree) => stock(tree),
      expect: (tree, t, logs) => {
        t.equal(recorded(t).functions, { project: 'functions', root: 'apps/functions', targets: functionsTargets('apps/functions') }, 'functions');
        t.equal(recorded(t).firebase?.targets, { emulators: emulators('functions') }, 'the suite');
        t.ok(t.json(RECORD)?.['//']?.includes('Commit it'), 'the record says what it is');
        if (logs) t.ok(logs.some((l) => l.includes('house-targets.json') && l.includes('functions')), `said: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'functions found by name at packages/backend: the frozen paths are rendered for where it lives',
      setup: (tree) => stock(tree, { root: 'packages/backend' }),
      expect: (tree, t) => {
        t.equal(recorded(t).functions?.root, 'packages/backend', 'where it lives now');
        t.equal(recorded(t).functions?.targets?.build?.options?.main, 'packages/backend/src/main.ts', 'rendered paths are proven');
      },
    },
    {
      name: 'functions found by root under another name (api): the frozen project names are rendered for it',
      setup: (tree) => stock(tree, { name: 'api' }),
      expect: (tree, t) => {
        t.equal(recorded(t).functions?.project, 'api', 'its name now');
        t.equal(recorded(t).firebase?.targets?.emulators?.dependsOn, [{ projects: ['api'], target: 'build' }], 'rendered project names are proven');
      },
    },
    {
      name: 'hand edits are LEFT OUT (the merge reports them instead of guessing); a set missing a member is left out whole',
      setup: (tree) =>
        stock(tree, {
          edit: (targets) => {
            targets.deploy.options.cwd = 'apps/functions';
            targets.deploy.dependsOn = [];
            targets.build.options.assets.push({ glob: 'templates/**', input: 'apps/functions', output: 'templates' });
          },
        }),
      expect: (tree, t) => {
        const deploy = recorded(t).functions?.targets?.deploy;
        t.equal(deploy, { executor: 'nx:run-commands', options: { command: 'firebase deploy --only functions' } }, 'only what is still 0.49.2\'s');
        t.ok(!('assets' in (recorded(t).functions?.targets?.build?.options ?? {})), 'an array that is one value, edited: left out');
      },
    },
    {
      name: 'a set with members of the project\'s own: recorded (its additions stay its own)',
      setup: (tree) => stock(tree, { edit: (targets) => (targets.deploy.dependsOn = ['build', 'typecheck']) }),
      expect: (tree, t) => t.equal(recorded(t).functions?.targets?.deploy?.dependsOn, ['build'], 'the house\'s members'),
    },
    {
      name: 'a target 0.49.2 never wrote (a hand-made firebase:deploy) is never recorded — it stays the project\'s own',
      setup: (tree) => stock(tree, { suite: { deploy: { executor: 'nx:run-commands', options: { commands: ['firebase deploy --only firestore,storage,hosting'] } } } }),
      expect: (tree, t) => t.ok(!('deploy' in (recorded(t).firebase?.targets ?? {})), JSON.stringify(recorded(t).firebase)),
    },
    {
      name: 'a project fully rewritten by hand still records the target as the house\'s (at least {}), never as the project\'s own',
      setup: (tree) => stock(tree, { edit: (targets) => (targets['push-secrets'] = { executor: '@acme/secrets:push' }) }),
      expect: (tree, t) => t.equal(recorded(t).functions?.targets?.['push-secrets'], {}, 'recorded, empty'),
    },
    {
      name: 'a record that already exists is never overwritten',
      setup: (tree) => {
        stock(tree);
        writeJson(tree, RECORD, { projects: { functions: { project: 'functions', root: 'apps/functions', targets: { deploy: { executor: 'mine' } } } } });
      },
      expect: (tree, t) => t.equal(recorded(t).functions?.targets, { deploy: { executor: 'mine' } }, 'kept'),
    },
    {
      name: 'no house project: no record',
      setup: (tree) => addProjectConfiguration(tree, 'web', { root: 'apps/web', targets: { build: clone({ executor: 'x' }) } }),
      expect: (tree, t) => t.missing(RECORD),
    },
  ],
};
