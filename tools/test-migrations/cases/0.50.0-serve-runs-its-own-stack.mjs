// 0.50.0 — `serve` stops being continuous (each `nx serve` its own stack, its own exit status); its continuous twin
// `dev-stack` is what an e2e target depends on.
//
// Silent if wrong, both ways: leave a dependent on `serve` and an e2e target waits for the stack to END — forever;
// leave `serve` continuous and `nx serve` keeps exiting 0 for a dead stack and a second one waits on the first.
//
// INPUTS ARE SHAPES THAT SHIPPED, from git:
//   - 0.49.2 (4f01d00, origin/development `_utils/dev-server.ts` composerFor + the angular adapter's leaf): `serve` IS
//     the continuous composer mirroring the leaf's options/configurations, NO dependsOn; the leaf is continuous too.
//   - 0.3.0 (60bd79f, serve/generator.ts): the composer before it mirrored the leaf — `{ continuous, executor,
//     options: {} }`.
//   - e76c12a (pre-0.3: `serve` IS the dev-server, depending on the app's own `emulators`), carried by the real ladder
//     through 0.24.0 → 0.24.1 → recompose-pre-0.3 (which runs the LIVE serve generator, i.e. today's shape) → here.
// The rung must leave EVERY app complete on its own (R9-1: the per-app generator runs for one app at most).
import { createRequire } from 'node:module';

const { addProjectConfiguration, readProjectConfiguration, readNxJson, updateNxJson } = createRequire(import.meta.url)('@nx/devkit');

const RUNG = '0.50.0/serve-runs-its-own-stack';
const OWNED = '0.50.0/stack-owned-dev-processes';
const SERVE = '@bespunky/nx-tools:serve';

const configurations = (app) => ({ development: { buildTarget: `${app}:build:development` }, production: { buildTarget: `${app}:build:production` } });
/** 0.49.2's leaf (adapters/angular `leaf`, 4f01d00). */
const leaf0492 = (app) => ({
  continuous: true,
  executor: '@angular/build:dev-server',
  options: { buildTarget: `${app}:build`, host: '0.0.0.0' },
  configurations: configurations(app),
  defaultConfiguration: 'development',
});
/** 0.49.2's composer (`composerFor`, 4f01d00): continuous, mirrors the leaf, no dependsOn. */
const composer0492 = (app) => ({
  continuous: true,
  executor: SERVE,
  options: { buildTarget: `${app}:build`, host: '0.0.0.0' },
  configurations: configurations(app),
  defaultConfiguration: 'development',
});
const house0492 = (tree, app = 'web', extra = {}) =>
  addProjectConfiguration(tree, app, {
    root: `apps/${app}`,
    targets: { build: { executor: 'nx:noop' }, 'dev-server': leaf0492(app), serve: composer0492(app), ...extra },
  });

const targetsOf = (tree, p) => readProjectConfiguration(tree, p).targets;
// Order-insensitive for object keys (the devkit writes its own key order); array order still counts.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** The final shape of one house app — what the generator writes today (_utils/dev-server `serveTargetsFor`). */
function complete(tree, t, app, mirror = { options: { buildTarget: `${app}:build`, host: '0.0.0.0' }, configurations: configurations(app), defaultConfiguration: 'development' }) {
  const targets = targetsOf(tree, app);
  t.ok(eq(targets.serve, { continuous: false, executor: SERVE, cache: false, ...mirror }), `${app}:serve is the engine, explicitly not continuous, uncached: ${JSON.stringify(targets.serve)}`);
  t.ok(eq(targets['dev-stack'], { continuous: true, executor: SERVE, ...mirror }), `${app}:dev-stack is the continuous twin: ${JSON.stringify(targets['dev-stack'])}`);
}

export default {
  name: '0.50.0 · serve-runs-its-own-stack',
  ladder: [RUNG],
  cases: [
    {
      name: 'the 0.49.2 house app: serve is the engine, not continuous; dev-stack is its continuous twin',
      setup: (tree) => house0492(tree),
      expect: (tree, t) => {
        complete(tree, t, 'web');
        const targets = targetsOf(tree, 'web');
        t.ok(Object.keys(targets).indexOf('dev-stack') === Object.keys(targets).indexOf('serve') - 1, 'dev-stack sits where serve was, serve right after');
        t.ok(!('serve-preflight' in targets), 'no preflight');
      },
      historicalShapes: [
        {
          name: '0.3.0 composer, before it mirrored the leaf (60bd79f)',
          diverges: 'its composer carried no options or configurations of the leaf; the rung keeps what is there and adds nothing',
          setup: (tree) => house0492(tree, 'web', { serve: { continuous: true, executor: SERVE, options: {} } }),
          expect: (tree, t) => complete(tree, t, 'web', { options: {} }),
        },
      ],
    },
    {
      name: 'multi-app (R9-1): every house app is completed by the rung alone, not only the one an upgrade resolves',
      setup: (tree) => {
        house0492(tree, 'web');
        house0492(tree, 'admin');
      },
      expect: (tree, t) => {
        complete(tree, t, 'web');
        complete(tree, t, 'admin');
      },
    },
    {
      name: 'already the current shape (the live generator wrote it): untouched; a missing twin is completed',
      setup: (tree) => {
        const mirror = { options: { buildTarget: 'web:build', host: '0.0.0.0' }, configurations: configurations('web'), defaultConfiguration: 'development' };
        house0492(tree, 'web', { serve: { continuous: false, executor: SERVE, cache: false, ...mirror } });
      },
      expect: (tree, t) => complete(tree, t, 'web'),
    },
    {
      name: 'e76c12a through the real ladder (0.24.0 → 0.24.1 → stack-owned → recompose → here), beside a 0.49.2 app and its e2e',
      ladder: ['0.24.0/unify-serve-targets', '0.24.1/relocate-emulator-targets', OWNED, '0.50.0/recompose-pre-0.3-serve-leftovers', RUNG],
      setup: (tree) => {
        tree.write('firebase.json', '{ "emulators": { "auth": { "port": 9099 } } }\n');
        // e76c12a: `serve` IS the Angular dev-server, continuous, depending on the app-level suite.
        addProjectConfiguration(tree, 'old', {
          root: 'apps/old',
          projectType: 'application',
          targets: {
            build: { executor: '@angular/build:application', options: { outputPath: 'dist/apps/old' }, configurations: { production: {}, development: {} }, defaultConfiguration: 'production' },
            serve: {
              continuous: true,
              dependsOn: ['emulators'],
              executor: '@angular/build:dev-server',
              configurations: { production: { buildTarget: 'old:build:production' }, development: { buildTarget: 'old:build:development' } },
              defaultConfiguration: 'development',
            },
            emulators: { continuous: true, executor: 'nx:run-commands', options: { command: 'firebase emulators:start --project=demo-old', cwd: '{workspaceRoot}' } },
          },
        });
        house0492(tree, 'web');
        addProjectConfiguration(tree, 'web-e2e', {
          root: 'apps/web-e2e',
          targets: { e2e: { executor: '@nx/playwright:playwright', dependsOn: [{ projects: ['web', 'old'], target: 'serve' }] } },
        });
      },
      expect: (tree, t) => {
        complete(tree, t, 'web');
        const old = targetsOf(tree, 'old');
        t.ok(old.serve.executor === SERVE && old.serve.continuous === false && old.serve.cache === false, `old:serve is the engine, not continuous: ${JSON.stringify(old.serve)}`);
        t.ok(old['dev-stack']?.executor === SERVE && old['dev-stack'].continuous === true, `old:dev-stack is the continuous twin: ${JSON.stringify(old['dev-stack'])}`);
        t.ok(old['dev-server']?.continuous === false && targetsOf(tree, 'web')['dev-server'].continuous === false, 'both leaves explicitly not continuous');
        t.ok(eq(targetsOf(tree, 'web-e2e').e2e.dependsOn, [{ projects: ['web', 'old'], target: 'dev-stack' }]), `the e2e depends on the running stacks of both: ${JSON.stringify(targetsOf(tree, 'web-e2e').e2e.dependsOn)}`);
      },
    },
    {
      name: "a project's own e2e target depending on serve is retargeted to dev-stack (dependsOn forms, devServerTarget)",
      setup: (tree) => {
        house0492(tree, 'web', { 'e2e-local': { executor: 'nx:noop', dependsOn: ['serve'] } });
        addProjectConfiguration(tree, 'web-e2e', {
          root: 'apps/web-e2e',
          targets: {
            e2e: {
              executor: '@nx/playwright:playwright',
              dependsOn: [{ projects: ['web'], target: 'serve' }, 'build'],
              options: { config: 'apps/web-e2e/playwright.config.ts' },
              configurations: { ci: { devServerTarget: 'web:serve:production' } },
            },
            'e2e-cy': { executor: '@nx/cypress:cypress', options: { devServerTarget: 'web:serve' } },
            smoke: { executor: 'nx:run-commands', dependsOn: ['web:serve'], options: { command: 'curl localhost:4200' } },
          },
        });
      },
      expect: (tree, t, logs) => {
        const e2e = targetsOf(tree, 'web-e2e');
        t.ok(eq(e2e.e2e.dependsOn, [{ projects: ['web'], target: 'dev-stack' }, 'build']), `object form retargeted, the rest kept: ${JSON.stringify(e2e.e2e.dependsOn)}`);
        t.ok(e2e.e2e.configurations.ci.devServerTarget === 'web:dev-stack:production', `devServerTarget in a configuration: ${e2e.e2e.configurations.ci.devServerTarget}`);
        t.ok(e2e['e2e-cy'].options.devServerTarget === 'web:dev-stack', 'devServerTarget option');
        t.ok(eq(e2e.smoke.dependsOn, ['web:dev-stack']), `"project:target" string form: ${JSON.stringify(e2e.smoke.dependsOn)}`);
        t.ok(eq(targetsOf(tree, 'web')['e2e-local'].dependsOn, ['dev-stack']), 'same-project string form');
        if (logs) t.ok(/web-e2e:e2e: dependsOn/.test(logs.join('\n')) && /devServerTarget "web:serve"/.test(logs.join('\n')), 'every rewrite is logged');
      },
    },
    {
      name: 'what cannot be resolved to one house app is reported and left; a foreign serve is untouched; targetDefaults reported',
      setup: (tree) => {
        house0492(tree);
        addProjectConfiguration(tree, 'api', { root: 'apps/api', targets: { serve: { executor: 'nx:run-commands', options: { command: 'uvicorn x' } } } });
        addProjectConfiguration(tree, 'suite', {
          root: 'apps/suite',
          targets: {
            all: { executor: 'nx:noop', dependsOn: ['^serve', { projects: ['web', 'api'], target: 'serve' }] },
            api: { executor: 'nx:noop', dependsOn: [{ projects: 'api', target: 'serve' }], options: { devServerTarget: 'api:serve' } },
          },
        });
        const nx = readNxJson(tree);
        // A targetDefaults `serve` that sets continuous: the explicit `continuous: false` on the target wins (not reported).
        nx.targetDefaults = { ...(nx.targetDefaults ?? {}), e2e: { dependsOn: ['serve'] }, serve: { continuous: true } };
        updateNxJson(tree, nx);
      },
      expect: (tree, t, logs) => {
        complete(tree, t, 'web');
        t.ok(targetsOf(tree, 'api').serve.executor === 'nx:run-commands' && !targetsOf(tree, 'api')['dev-stack'], "a project's own serve is not touched");
        const suite = targetsOf(tree, 'suite');
        t.ok(eq(suite.all.dependsOn, ['^serve', { projects: ['web', 'api'], target: 'serve' }]), 'ambiguous references left as they were');
        t.ok(eq(suite.api.dependsOn, [{ projects: 'api', target: 'serve' }]) && suite.api.options.devServerTarget === 'api:serve', 'references to a foreign serve untouched');
        t.ok(eq(readNxJson(tree).targetDefaults.e2e.dependsOn, ['serve']), 'nx.json targetDefaults left');
        if (logs) {
          const text = logs.join('\n');
          t.ok(/suite:all depends on `serve` \("\^serve"/.test(text), '^serve reported');
          t.ok(/suite:all depends on `serve` \(projects \["web","api"\]/.test(text), 'a mixed projects list reported');
          t.ok(/targetDefaults\["e2e"\] depends on `serve`/.test(text), 'targetDefaults reported');
          t.ok(!/targetDefaults\["serve"\]/.test(text), 'a targetDefaults continuous is not reported — the explicit value wins');
          t.ok(!/suite:api/.test(text), 'nothing said about a foreign serve');
        }
      },
    },
    {
      name: 'a project that already has its own dev-stack target is reported, not changed',
      setup: (tree) => house0492(tree, 'web', { 'dev-stack': { executor: 'nx:run-commands', options: { command: 'docker compose up' } } }),
      expect: (tree, t, logs) => {
        const targets = targetsOf(tree, 'web');
        t.ok(eq(targets.serve, composer0492('web')) && targets['dev-stack'].executor === 'nx:run-commands', 'both left as they were');
        if (logs) t.ok(/web has a `dev-stack` target of its own/.test(logs.join('\n')), 'reported with the fix');
      },
    },
  ],
};
