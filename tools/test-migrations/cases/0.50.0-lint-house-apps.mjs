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
      setup: (tree) => houseApp(tree, { lint: { executor: 'nx:run-commands', options: { command: 'eslint .' } } }),
      expect: (tree, t, lines) => t.ok(!said(lines, '`web`'), `silent: ${lines}`),
    },
    {
      name: 'linted by inference (@nx/eslint/plugin + the root eslint config): nothing said',
      setup: (tree) => {
        houseApp(tree);
        tree.write('eslint.config.mjs', 'export default [];\n');
        tree.write('nx.json', JSON.stringify({ plugins: [{ plugin: '@nx/eslint/plugin', options: { targetName: 'lint' } }] }, null, 2));
      },
      expect: (tree, t, lines) => t.ok(!said(lines, '`web`'), `silent: ${lines}`),
    },
    {
      name: 'the composer already split onto dev-stack (split-serve-follower ran first): still recognised as a house app',
      setup: (tree) =>
        houseApp(tree, {
          'dev-stack': { executor: '@bespunky/nx-tools:serve', continuous: true },
          serve: { executor: '@bespunky/nx-tools:follow-stack' },
        }),
      expect: (tree, t, lines) => t.ok(said(lines, 'g @nx/angular:add-linting --projectName=web'), `reported: ${lines}`),
    },
    {
      name: "the house's functions:lint (0.49: the bare deprecated executor) becomes @nx/eslint/plugin's inferred target",
      setup: (tree) => {
        tree.write('eslint.config.mjs', 'export default [];\n');
        tree.write('nx.json', `{
  "targetDefaults": {
    "build": { "cache": true },
    "@nx/eslint:lint": { "cache": true }
  }
}
`);
        addProjectConfiguration(tree, 'functions', {
          root: 'apps/functions',
          projectType: 'application',
          tags: ['platform:server'],
          targets: { build: { executor: '@nx/esbuild:esbuild' }, lint: { executor: '@nx/eslint:lint' }, deploy: { executor: 'nx:run-commands', dependsOn: ['build', 'lint'] } },
        });
      },
      expect: (tree, t, lines) => {
        const project = t.json('apps/functions/project.json');
        t.ok(!project.targets.lint, `the declared target is gone: ${JSON.stringify(project.targets)}`);
        t.equal(project.targets.deploy.dependsOn, ['build', 'lint'], 'deploy still depends on lint (now inferred)');
        const nx = t.json('nx.json');
        t.equal(nx.plugins, [{ plugin: '@nx/eslint/plugin', options: { targetName: 'lint' } }], 'the plugin, as `nx add @nx/eslint` writes it');
        t.equal(nx.targetDefaults, { build: { cache: true } }, 'the executor default nothing uses any more is gone');
        t.ok(said(lines, '`functions:lint` no longer runs the deprecated @nx/eslint:lint executor'), `reported: ${lines}`);
      },
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
