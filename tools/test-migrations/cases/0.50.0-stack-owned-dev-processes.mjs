// 0.50.0 — the targets a dev stack composes become EXPLICITLY `continuous: false`; the composer is left to
// serve-runs-its-own-stack.
//
// Silent if wrong in both directions: miss a leaf and a second stack of that app still waits forever on the first;
// change the wrong target (the composer, a project's own dev-server) and an e2e target that depends on it hangs.
// Inputs as 0.49.2 shipped them (4f01d00): the composer on `serve`, the Angular leaf and every emulator launcher
// `continuous: true` (adapters/angular `leaf`, firebase-emulators `emulatorsTarget`).
import { createRequire } from 'node:module';

const { addProjectConfiguration, readProjectConfiguration } = createRequire(import.meta.url)('@nx/devkit');

const SERVE = { continuous: true, executor: '@bespunky/nx-tools:serve', options: { buildTarget: 'web:build' } };
const LEAF = { continuous: true, executor: '@angular/build:dev-server', options: { buildTarget: 'web:build' } };
const suite = (only) => ({
  continuous: true,
  executor: 'nx:run-commands',
  options: { command: `bash tools/emulators.sh${only ? ` --only ${only},ui` : ''}`, cwd: '{workspaceRoot}' },
});

const FIREBASE_TEXT = `{
  "name": "firebase",
  "$schema": "../node_modules/nx/schemas/project-schema.json",
  "targets": {
    "emulators": {
      "continuous": true,
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/emulators.sh", "cwd": "{workspaceRoot}" },
      "dependsOn": [{ "projects": ["functions"], "target": "build" }]
    },
    "emulators:auth": {
      "continuous": true,
      "executor": "nx:run-commands",
      "options": { "command": "bash tools/emulators.sh --only auth,ui", "cwd": "{workspaceRoot}" }
    }
  }
}
`;

const targetsOf = (tree, p) => readProjectConfiguration(tree, p).targets;

export default {
  name: '0.50.0 · stack-owned-dev-processes',
  ladder: ['0.50.0/stack-owned-dev-processes'],
  cases: [
    {
      name: 'house leaf + emulator targets become continuous: false; the composer and the rest keep theirs',
      setup: (tree) => {
        addProjectConfiguration(tree, 'web', { root: 'apps/web', targets: { serve: SERVE, 'dev-server': LEAF, build: { executor: 'nx:noop' } } });
        addProjectConfiguration(tree, 'firebase', {
          root: 'firebase',
          targets: {
            emulators: { ...suite(), dependsOn: [{ projects: ['functions'], target: 'build' }] },
            'emulators:auth': suite('auth'),
            watch: { continuous: true, executor: 'nx:run-commands', options: { command: 'tsc -w' } },
          },
        });
      },
      expect: (tree, t) => {
        const web = targetsOf(tree, 'web');
        t.ok(web.serve.continuous === true, 'the composer stays continuous (e2e shares it)');
        t.ok(web['dev-server'].continuous === false, `the house leaf is explicitly not continuous: ${JSON.stringify(web['dev-server'])}`);
        const fb = targetsOf(tree, 'firebase');
        t.ok(fb.emulators.continuous === false && fb['emulators:auth'].continuous === false, 'every suite launcher is explicitly not continuous');
        t.ok(JSON.stringify(fb.emulators.dependsOn) === JSON.stringify([{ projects: ['functions'], target: 'build' }]), 'the functions build dependency is kept');
        t.ok(fb.watch.continuous === true, 'a firebase target that does not launch the suite is untouched');
      },
    },
    {
      name: 'in place: only the `continuous` values change — key order and one-line formatting stay (no options-below-dependsOn churn)',
      setup: (tree) => {
        addProjectConfiguration(tree, 'functions', { root: 'apps/functions', targets: { build: { executor: 'nx:noop' } } });
        tree.write('firebase/project.json', FIREBASE_TEXT);
      },
      expect: (tree, t) => {
        const text = tree.read('firebase/project.json', 'utf8');
        t.ok(text === FIREBASE_TEXT.replaceAll('"continuous": true', '"continuous": false'), `project.json:\n${text}`);
      },
    },
    {
      name: "a project's own continuous dev-server is reported, not touched; a dependent of a changed target is reported",
      setup: (tree) => {
        addProjectConfiguration(tree, 'vite', {
          root: 'apps/vite',
          targets: { serve: { ...SERVE, options: {} }, 'dev-server': { continuous: true, executor: '@nx/vite:dev-server' } },
        });
        addProjectConfiguration(tree, 'plain', { root: 'apps/plain', targets: { serve: { ...SERVE, options: {} }, 'dev-server': { executor: '@nx/vite:dev-server' } } });
        addProjectConfiguration(tree, 'web', { root: 'apps/web', targets: { serve: SERVE, 'dev-server': LEAF } });
        addProjectConfiguration(tree, 'web-e2e', { root: 'apps/web-e2e', targets: { e2e: { executor: 'nx:noop', dependsOn: [{ projects: 'web', target: 'dev-server' }] } } });
      },
      expect: (tree, t, logs) => {
        t.ok(targetsOf(tree, 'vite')['dev-server'].continuous === true, "the project's own leaf keeps continuous");
        const text = logs ? logs.join('\n') : '';
        if (logs) {
          t.ok(/vite:dev-server .*left as is/.test(text), 'the own leaf is reported');
          t.ok(/plain:dev-server .*from its executor schema or nx.json targetDefaults/.test(text), 'an own leaf with no `continuous` key is reported too (Nx may fill it)');
          t.ok(/web-e2e:e2e depends on web:dev-server/.test(text), 'the dependent is reported');
        }
        t.ok(JSON.stringify(targetsOf(tree, 'web-e2e').e2e.dependsOn) === JSON.stringify([{ projects: 'web', target: 'dev-server' }]), 'the dependent is not rewritten');
      },
    },
    {
      name: 'after serve-runs-its-own-stack (the house engine on dev-stack too): a leaf with no key gets continuous: false',
      setup: (tree) => {
        addProjectConfiguration(tree, 'web', {
          root: 'apps/web',
          targets: {
            'dev-stack': SERVE,
            serve: { continuous: false, executor: '@bespunky/nx-tools:serve', cache: false },
            'dev-server': { executor: '@angular/build:dev-server', options: { buildTarget: 'web:build' } },
          },
        });
      },
      expect: (tree, t) => t.ok(targetsOf(tree, 'web')['dev-server'].continuous === false, `explicit: ${JSON.stringify(targetsOf(tree, 'web')['dev-server'])}`),
    },
    {
      name: 'a leaf behind a foreign serve is not the house stack: untouched',
      setup: (tree) => {
        addProjectConfiguration(tree, 'other', { root: 'apps/other', targets: { serve: { continuous: true, executor: 'nx:run-commands', options: { command: 'x' } }, 'dev-server': LEAF } });
      },
      expect: (tree, t) => {
        t.ok(targetsOf(tree, 'other')['dev-server'].continuous === true, 'untouched');
      },
    },
  ],
};
