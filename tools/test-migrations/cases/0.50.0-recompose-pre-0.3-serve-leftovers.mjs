// 0.50.0 — the two pre-0.3.0 serve shapes 0.24.0/0.24.1 left half-migrated are recomposed by the serve generator.
//
// Shapes from git: e76c12a (`serve` IS the dev-server, continuous, dependsOn ['emulators'], emulators* on the app) and
// 703ca41 (`serve-no-emulators` defaulting to the `no-emulators` configuration). Each is run through the REAL ladder
// (0.24.0 → 0.24.1 → this rung) and also from the sealed state those two rungs left behind.
//
// Historical shapes: the rung keys on a `serve` dependsOn naming an `emulators*` target the project lacks. The only
// releases that wrote that dependsOn are e76c12a and 2c421f9 (`git log -G"dependsOn.*emulators"` over the generators;
// from 0d09453 on, the firebase-emulators generator STRIPS it and composes `serve` as an nx:run-commands orchestrator,
// and from 60bd79f (0.3.0) `serve` is the composer beside a `dev-server` — both outside the guard). The
// `{ projects: ['firebase'], target: 'emulators' }` form 0d09453's stripper mentions came from another repo, never
// from a toolkit release. The other marker, `defaultConfiguration: 'no-emulators'`, was written only by 703ca41
// (b65399d, two hours later, pinned each dev-server by `options.buildTarget` with no configurations).
import { createRequire } from 'node:module';

const { addProjectConfiguration, readProjectConfiguration, readJson } = createRequire(import.meta.url)('@nx/devkit');

const RUNG = '0.50.0/recompose-pre-0.3-serve-leftovers';
const FULL = ['0.24.0/unify-serve-targets', '0.24.1/relocate-emulator-targets', RUNG];

const BUILD = {
  executor: '@angular/build:application',
  options: { outputPath: 'dist/apps/web', browser: 'apps/web/src/main.ts' },
  configurations: { production: {}, development: { optimization: false } },
  defaultConfiguration: 'production',
};
const EMULATORS = {
  emulators: { continuous: true, executor: 'nx:run-commands', options: { command: 'firebase emulators:start --project=demo-web', cwd: '{workspaceRoot}' } },
  'emulators:auth': { executor: 'nx:run-commands', options: { command: 'firebase emulators:start --only auth', cwd: '{workspaceRoot}' } },
};

/** e76c12a: the Nx Angular app's own `serve`, made continuous and pointed at the app-level suite. */
const e76c12a = (tree, emulators = EMULATORS) => {
  tree.write('firebase.json', '{ "emulators": { "auth": { "port": 9099 } } }\n');
  addProjectConfiguration(tree, 'web', {
    root: 'apps/web',
    projectType: 'application',
    targets: {
      build: BUILD,
      serve: {
        continuous: true,
        dependsOn: ['emulators'],
        executor: '@angular/build:dev-server',
        configurations: { production: { buildTarget: 'web:build:production' }, development: { buildTarget: 'web:build:development' } },
        defaultConfiguration: 'development',
      },
      ...emulators,
    },
  });
};

/**
 * 2c421f9 (2026-06-03 → 06-10): the only other release that wrote the marker this rung keys on. Its `serve` wiring is
 * e76c12a's, verbatim (`continuous`, `dependsOn: ['emulators']`); what changed is every `emulators*` command, now
 * prefixed with the port reaper — which 0.24.1 relocates to `firebase` as it finds it.
 *   git show 2c421f9:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/generator.ts
 */
const REAP = 'bash tools/reap-emulators.sh &&';
const c2c421f9 = (tree) =>
  e76c12a(tree, Object.fromEntries(Object.entries(EMULATORS).map(([name, target]) => [name, { ...target, options: { ...target.options, command: `${REAP} ${target.options.command}` } }])));

/** What 0.24.0 + 0.24.1 left of e76c12a: the suite moved to `firebase`, the app's `serve` still depending on it. */
const sealedE76c12a = (tree) => {
  e76c12a(tree);
  const web = readProjectConfiguration(tree, 'web');
  delete web.targets.emulators;
  delete web.targets['emulators:auth'];
  tree.write('apps/web/project.json', JSON.stringify({ name: 'web', ...web }, null, 2));
  addProjectConfiguration(tree, 'firebase', { root: 'firebase', targets: EMULATORS });
};

/** What 0.24.0 + 0.24.1 left of 703ca41: the promoted leaf, still defaulting to the retired configuration. */
const sealed703ca41 = (tree) => {
  tree.write('firebase.json', '{ "emulators": { "auth": { "port": 9099 } } }\n');
  addProjectConfiguration(tree, 'firebase', { root: 'firebase', targets: EMULATORS });
  addProjectConfiguration(tree, 'web', {
    root: 'apps/web',
    projectType: 'application',
    targets: {
      build: BUILD,
      'dev-server': {
        executor: '@angular/build:dev-server',
        configurations: {
          production: { buildTarget: 'web:build:production' },
          development: { buildTarget: 'web:build:development' },
          'no-emulators': { buildTarget: 'web:build' },
        },
        defaultConfiguration: 'no-emulators',
      },
      serve: { continuous: true, executor: '@bespunky/nx-tools:serve' },
    },
  });
};

const composed = (tree, t) => {
  const { targets } = readProjectConfiguration(tree, 'web');
  t.equal(targets['dev-stack']?.executor, '@bespunky/nx-tools:serve', 'dev-stack is the continuous twin');
  t.ok(targets['dev-stack']?.continuous === true, 'dev-stack is continuous');
  t.ok(targets.serve.executor === '@bespunky/nx-tools:serve' && targets.serve.continuous === false, 'serve is the engine, not continuous (recomposed onto the current shape)');
  t.ok(targets['dev-server']?.continuous === false, 'the leaf is explicitly not continuous');
  t.equal(targets['dev-server']?.executor, '@angular/build:dev-server', 'the dev-server is the leaf');
  t.ok(!JSON.stringify(targets['dev-server']).includes('emulators'), `the leaf names no emulator target: ${JSON.stringify(targets['dev-server'])}`);
  t.ok(targets['dev-server'].defaultConfiguration !== 'no-emulators', 'the retired configuration is not the default');
  t.ok(!targets['dev-server'].configurations?.['no-emulators'], 'the retired configuration is gone');
  t.ok(readJson(tree, '.bespunky/dev.json').apps?.web, 'the app is declared for the dev engine');
};

export default {
  name: '0.50.0 · recompose-pre-0.3-serve-leftovers',
  ladder: [RUNG],
  cases: [
    {
      name: 'e76c12a through the real ladder (0.24.0 → 0.24.1 → here): a composed app, nothing dangling',
      ladder: FULL,
      setup: e76c12a,
      expect: composed,
      historicalShapes: [
        {
          name: '2c421f9 (reaper-prefixed emulators, same serve wiring)',
          diverges: 'its emulators commands carry the reap prefix, which 0.24.1 moves onto `firebase` verbatim; apps/web lands byte-identical',
          setup: c2c421f9,
          expect: (tree, t) => {
            composed(tree, t);
            t.ok(readProjectConfiguration(tree, 'firebase').targets.emulators.options.command.startsWith(REAP), 'the reaper moved with the suite');
          },
        },
      ],
    },
    { name: 'e76c12a, sealed by 0.24.1 (dangling dependsOn): recomposed', setup: sealedE76c12a, expect: composed },
    { name: '703ca41, sealed (the no-emulators default): recomposed, development by default', setup: sealed703ca41, expect: composed },
    {
      name: 'a project dev-server on `serve` with no emulator dependsOn (S0): not this rung’s business — untouched',
      setup: (tree) => addProjectConfiguration(tree, 'web', { root: 'apps/web', targets: { build: BUILD, serve: { executor: '@angular/build:dev-server' } } }),
      expect: (tree, t) => t.equal(readProjectConfiguration(tree, 'web').targets.serve.executor, '@angular/build:dev-server', 'serve'),
    },
  ],
};
