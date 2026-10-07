// 0.50.0 — every house app is linted, so the platform firewall (an ESLint rule) checks it. House Angular apps were
// created with no `lint` target. Here: the paths that need no @nx/angular (it is not installed for this harness —
// exactly the broken-install path); the add itself runs in tools/test-generators (cases/lint-house-apps.mjs).
import { createRequire } from 'node:module';

const { addProjectConfiguration } = createRequire(import.meta.url)('@nx/devkit');

const houseApp = (tree, targets = {}) =>
  addProjectConfiguration(tree, 'web', {
    root: 'apps/web',
    projectType: 'application',
    tags: ['platform:web'],
    targets: {
      build: { executor: '@angular/build:application' },
      serve: { executor: '@bespunky/nx-tools:serve', continuous: true },
      ...targets,
    },
  });
const said = (lines, needle) => lines.some((line) => line.includes(needle));

export default {
  name: '0.50.0 · lint-house-apps',
  ladder: ['0.50.0/lint-house-apps'],
  cases: [
    {
      name: 'a house app with no lint and no @nx/angular to add it: nothing written, the exact command reported',
      setup: (tree) => houseApp(tree),
      expect: (tree, t, lines) => {
        t.missing('apps/web/eslint.config.mjs');
        t.ok(said(lines, 'g @nx/angular:add-linting --projectName=web --projectRoot=apps/web --linter=eslint'), `reported: ${lines}`);
      },
    },
    {
      name: 'a house app already linted: nothing said',
      setup: (tree) => houseApp(tree, { lint: { executor: '@nx/eslint:lint' } }),
      expect: (tree, t, lines) => t.ok(!said(lines, '`web`'), `silent: ${lines}`),
    },
    {
      name: "another project's platform tag with no lint behind it is reported; an untagged one is not this rung's business",
      setup: (tree) => {
        addProjectConfiguration(tree, 'kit', { root: 'libs/kit', projectType: 'library', tags: ['platform:server'], targets: { build: { executor: 'nx:run-commands' } } });
        addProjectConfiguration(tree, 'suite', { root: 'firebase', projectType: 'application', tags: ['platform:shared'], targets: { emulators: { executor: 'nx:run-commands' } } });
        addProjectConfiguration(tree, 'loose', { root: 'libs/loose', projectType: 'library', targets: {} });
      },
      expect: (tree, t, lines) => {
        t.ok(said(lines, '`kit` is tagged platform:server but has no lint target'), `reported: ${lines}`);
        t.ok(!said(lines, '`loose`'), 'untagged: silent');
        t.ok(!said(lines, '`suite`'), 'a tooling project (no code) is not news');
      },
    },
  ],
};
