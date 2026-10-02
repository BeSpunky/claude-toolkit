// 0.24.0 — collapse the historic serve targets onto `serve` + `dev-server`.
//
// Back-filled for the one behaviour that was wrong when it shipped: step (3b) stripped `options.host` from
// EVERY `nx:run-commands` target named `serve`, not only from the house orchestrator it was written for. A
// project's own serve — a Python `uvicorn` command, say — whose `host` is a flag its command genuinely needs
// lost it on the way up. The fixtures below pin both sides of the line: a foreign `serve` keeps every byte,
// and the house orchestrator (recognised by running a target this ladder removes) is still reshaped.
import { createRequire } from 'node:module';

const { addProjectConfiguration, readProjectConfiguration } = createRequire(import.meta.url)('@nx/devkit');

const RUN = 'nx:run-commands';

export default {
  name: '0.24.0 · unify-serve-targets',
  ladder: ['0.24.0/unify-serve-targets'],
  cases: [
    {
      name: "a project's OWN run-commands serve keeps its host (the bug)",
      setup: (tree) =>
        addProjectConfiguration(tree, 'api', {
          root: 'services/api',
          targets: {
            serve: {
              executor: RUN,
              options: { command: 'uvicorn app.main:api --reload', cwd: 'services/api', host: '0.0.0.0' },
            },
          },
        }),
      expect: (tree, t) => {
        const serve = readProjectConfiguration(tree, 'api').targets.serve;
        t.ok(serve.executor === RUN, `expected the foreign serve to stay on ${RUN}, got ${serve.executor}`);
        t.ok(serve.options.host === '0.0.0.0', `expected host 0.0.0.0 to survive, got ${JSON.stringify(serve.options)}`);
        t.ok(serve.options.command === 'uvicorn app.main:api --reload', 'expected the command untouched');
      },
    },
    {
      name: 'the house orchestrator with a dev-server to compose is replaced by the composer',
      setup: (tree) =>
        addProjectConfiguration(tree, 'web', {
          root: 'apps/web',
          targets: {
            'serve-with-emulators': { executor: '@angular/build:dev-server', options: { host: '0.0.0.0' } },
            serve: { executor: RUN, options: { command: 'nx run web:serve-with-emulators', host: '0.0.0.0' } },
          },
        }),
      expect: (tree, t) => {
        const { targets } = readProjectConfiguration(tree, 'web');
        t.ok(targets['dev-server']?.options?.host === '0.0.0.0', 'expected the legacy leaf promoted with its host');
        t.ok(!targets['serve-with-emulators'], 'expected serve-with-emulators gone');
        t.ok(targets.serve.executor === '@bespunky/nx-tools:serve', `expected the composer, got ${targets.serve.executor}`);
      },
    },
    {
      name: 'the house orchestrator with nothing to compose keeps its body but loses the stray host',
      setup: (tree) =>
        addProjectConfiguration(tree, 'old', {
          root: 'apps/old',
          targets: {
            serve: { executor: RUN, options: { commands: ['nx run old:serve-worktree'], host: '0.0.0.0' } },
          },
        }),
      expect: (tree, t) => {
        const serve = readProjectConfiguration(tree, 'old').targets.serve;
        t.ok(serve.executor === RUN, 'expected the orchestrator kept (nothing to compose in its place)');
        t.ok(!('host' in serve.options), `expected host stripped, got ${JSON.stringify(serve.options)}`);
      },
    },
  ],
};
