// 0.50.0 — `serve` splits into the continuous composer `dev-stack` and the non-continuous follower `serve`.
//
// Silent if wrong, both ways: leave a dependent on `serve` and an e2e target waits for the stack to END — forever;
// skip the split and `nx serve` keeps exiting 0 for a dead stack. The fixtures: the stock house app, a project with
// its own e2e target depending on `serve` (both dependsOn forms and a devServerTarget option), the references the
// rung must report rather than guess at, a project that already owns `dev-stack`, and a foreign `serve`.
import { createRequire } from 'node:module';

const { addProjectConfiguration, readProjectConfiguration, readNxJson, updateNxJson } = createRequire(import.meta.url)('@nx/devkit');

const COMPOSER = {
  continuous: true,
  executor: '@bespunky/nx-tools:serve',
  dependsOn: [{ target: 'serve-preflight', params: 'forward' }],
  options: { buildTarget: 'web:build', host: '0.0.0.0' },
  configurations: { development: { buildTarget: 'web:build:development' }, production: { buildTarget: 'web:build:production' } },
  defaultConfiguration: 'development',
};
const PREFLIGHT = { executor: '@bespunky/nx-tools:serve-preflight', cache: false };
const house = (tree, name = 'web') =>
  addProjectConfiguration(tree, name, {
    root: `apps/${name}`,
    targets: { build: { executor: 'nx:noop' }, 'dev-server': { executor: '@angular/build:dev-server' }, serve: structuredClone(COMPOSER), 'serve-preflight': PREFLIGHT },
  });
const targetsOf = (tree, p) => readProjectConfiguration(tree, p).targets;
// Order-insensitive for object keys (the devkit writes its own key order); array order still counts.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export default {
  name: '0.50.0 · split-serve-follower',
  ladder: ['0.50.0/split-serve-follower'],
  cases: [
    {
      name: 'the stock house app: dev-stack is the composer, unchanged; serve follows it',
      setup: (tree) => house(tree),
      expect: (tree, t) => {
        const targets = targetsOf(tree, 'web');
        t.ok(eq(targets['dev-stack'], COMPOSER), `dev-stack is the composer, byte for byte: ${JSON.stringify(targets['dev-stack'])}`);
        t.ok(
          eq(targets.serve, {
            executor: '@bespunky/nx-tools:follow-stack',
            dependsOn: [{ target: 'dev-stack', params: 'forward' }],
            cache: false,
            configurations: { development: {}, production: {} },
            defaultConfiguration: 'development',
          }),
          `serve is the follower, not continuous, mirroring the configuration names: ${JSON.stringify(targets.serve)}`,
        );
        t.ok(eq(targets['serve-preflight'], PREFLIGHT) && targets['dev-server'].executor === '@angular/build:dev-server', 'preflight and leaf untouched');
        t.ok(Object.keys(targets).indexOf('dev-stack') === Object.keys(targets).indexOf('serve') - 1, 'dev-stack sits where serve was, serve right after');
      },
    },
    {
      name: "a project's own e2e target depending on serve is retargeted to dev-stack (dependsOn forms, devServerTarget)",
      setup: (tree) => {
        house(tree);
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
        // An in-project dependent, the short string form.
        const web = readProjectConfiguration(tree, 'web');
        web.targets['e2e-local'] = { executor: 'nx:noop', dependsOn: ['serve'] };
        tree.write('apps/web/project.json', JSON.stringify({ name: 'web', ...web }, null, 2));
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
      name: 'what cannot be resolved to one split project is reported and left; a foreign serve is not split',
      setup: (tree) => {
        house(tree);
        addProjectConfiguration(tree, 'api', { root: 'apps/api', targets: { serve: { executor: 'nx:run-commands', options: { command: 'uvicorn x' } } } });
        addProjectConfiguration(tree, 'suite', {
          root: 'apps/suite',
          targets: {
            all: { executor: 'nx:noop', dependsOn: ['^serve', { projects: ['web', 'api'], target: 'serve' }] },
            api: { executor: 'nx:noop', dependsOn: [{ projects: 'api', target: 'serve' }], options: { devServerTarget: 'api:serve' } },
          },
        });
        const nx = readNxJson(tree);
        nx.targetDefaults = { ...(nx.targetDefaults ?? {}), e2e: { dependsOn: ['serve'] } };
        updateNxJson(tree, nx);
      },
      expect: (tree, t, logs) => {
        t.ok(targetsOf(tree, 'api').serve.executor === 'nx:run-commands' && !targetsOf(tree, 'api')['dev-stack'], "a project's own serve is not split");
        const suite = targetsOf(tree, 'suite');
        t.ok(eq(suite.all.dependsOn, ['^serve', { projects: ['web', 'api'], target: 'serve' }]), 'ambiguous references left as they were');
        t.ok(eq(suite.api.dependsOn, [{ projects: 'api', target: 'serve' }]) && suite.api.options.devServerTarget === 'api:serve', "references to a foreign serve untouched");
        t.ok(eq(readNxJson(tree).targetDefaults.e2e.dependsOn, ['serve']), 'nx.json targetDefaults left');
        if (logs) {
          const text = logs.join('\n');
          t.ok(/suite:all depends on `serve` \("\^serve"/.test(text), '^serve reported');
          t.ok(/suite:all depends on `serve` \(projects \["web","api"\]/.test(text), 'a mixed projects list reported');
          t.ok(/targetDefaults\["e2e"\] depends on `serve`/.test(text), 'targetDefaults reported');
          t.ok(!/suite:api/.test(text), 'nothing said about a foreign serve');
        }
      },
    },
    {
      name: 'a project that already has its own dev-stack target is reported, not split',
      setup: (tree) => {
        house(tree);
        const web = readProjectConfiguration(tree, 'web');
        web.targets['dev-stack'] = { executor: 'nx:run-commands', options: { command: 'docker compose up' } };
        tree.write('apps/web/project.json', JSON.stringify({ name: 'web', ...web }, null, 2));
      },
      expect: (tree, t, logs) => {
        const targets = targetsOf(tree, 'web');
        t.ok(targets.serve.executor === '@bespunky/nx-tools:serve' && targets['dev-stack'].executor === 'nx:run-commands', 'both left as they were');
        if (logs) t.ok(/web has a `dev-stack` target of its own/.test(logs.join('\n')), 'reported with the fix');
      },
    },
  ],
};
