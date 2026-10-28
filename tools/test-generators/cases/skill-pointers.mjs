// SKILL POINTERS FOLLOW ENABLEMENT — a file the house writes into a project never sends its reader to a toolkit skill or
// command (`bespunky-<plugin>:<name>`, `/bespunky-<plugin>:<name>`) the project does not enable. The one fact is
// `.claude/settings.json` `enabledPlugins` (_utils/claude-settings-file); house-doc gates on it with blocks, the other
// generators through their own `{{token}}` substitution (_utils/plugin-pointers). Each file is checked both ways:
// enabled → the pointer is there; not enabled → it is gone, the sentence it sat in still reads, and no `{{token}}` of
// its own is left behind. "Not enabled" is a project that enables OTHER toolkit plugins, so a gate keyed on "any
// settings at all" would fail it.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, angularWorkspace, angularApp, RESOLVED, SCOPE } from '../workspaces.mjs';

const { writeJson, updateJson } = requireFromRepo('@nx/devkit');

const ALL = ['bespunky-house', 'bespunky-workflow', 'bespunky-engineering', 'bespunky-product-ux'];
const enable = (tree, plugins) =>
  writeJson(tree, '.claude/settings.json', { enabledPlugins: Object.fromEntries(plugins.map((p) => [`${p}@claude-toolkit`, true])) });
const MODES = [
  { label: 'enabled', plugins: ALL, on: true },
  { label: 'not enabled', plugins: ['bespunky'], on: false },
];
/** No `{{pointerToken}}` survives the render (the tokens these generators fill are camelCase). */
const noTokens = (t, path) => t.ok(!/\{\{[a-z][A-Za-z]*\}\}/.test(t.read(path)), `${path} has an unfilled token: ${t.read(path).match(/\{\{[a-z][A-Za-z]*\}\}/)?.[0]}`);
/** Each pointer present when on, absent when off; each plain sentence present either way. */
const check = (t, on, path, pointers, plain) => {
  for (const p of pointers) (on ? t.has : t.hasNot)(path, p);
  for (const p of plain) t.has(path, p);
  noTokens(t, path);
};

const designSystem = MODES.map(({ label, plugins, on }) => ({
  name: `neutral design system, product-ux / engineering ${label}: STRUCTURE.md and _tokens.scss`,
  setup: () => {
    const tree = workspace();
    enable(tree, plugins);
    return tree;
  },
  run: async (tree, ctx) => {
    await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
  },
  expect: (tree, t) => {
    const root = `${RESOLVED.hybrid.libsDir}/design-system`;
    check(t, on, `${root}/STRUCTURE.md`, ['bespunky-product-ux:stage-the-vision'], ['The design phase', 'replaces that file wholesale']);
    check(
      t,
      on,
      `${root}/styles/_core/_tokens.scss`,
      ['bespunky-product-ux:envision-the-experience', 'bespunky-product-ux:realize-the-vision'],
      ['REPLACED WHOLESALE by the design phase', 'HERE, as tokens'],
    );
  },
}));

// The Angular binding seeds its own STRUCTURE.md and DsTheme — through @nx/angular, so skipped where it is absent.
const angularDesignSystem = MODES.map(({ label, plugins, on }) => ({
  name: `Angular design system, product-ux / engineering ${label}: STRUCTURE.md and DsTheme`,
  needs: ['@nx/angular', '@nx/js'],
  setup: () => {
    const tree = angularWorkspace({ layout: 'packages', link: 'paths' });
    angularApp(tree, 'packages/web', 'web');
    enable(tree, plugins);
    return tree;
  },
  run: async (tree, ctx) => {
    await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
  },
  expect: (tree, t) => {
    const root = 'packages/design-system';
    check(t, on, `${root}/STRUCTURE.md`, ['bespunky-product-ux:stage-the-vision'], ['The design phase', 'replaces that file wholesale']);
    check(t, on, `${root}/src/lib/ds-theme.service.ts`, ['bespunky-engineering:resumable-state'], ['you must apply it BEFORE first']);
  },
}));

const deployTarget = (command) => ({ executor: 'nx:run-commands', options: { command, cwd: '{workspaceRoot}' } });
const BOUND = {
  schema: 1,
  integration: 'development',
  production: ['main'],
  productionPatterns: [],
  chain: ['development', 'main'],
  protected: ['development', 'main'],
  protectedPatterns: [],
  workBase: 'development',
  summary: 'development → main',
  deploys: [{ kind: 'line', line: 'main', ci: { environment: 'production', providers: { firebase: 'default' } } }],
};
const ciFixture = (plugins, projection) => () => {
  const tree = workspace({ pm: 'yarn-berry' });
  tree.write('.nvmrc', '22\n');
  tree.write('firebase.json', '{}');
  writeJson(tree, 'apps/functions/project.json', { name: 'functions', root: 'apps/functions', targets: { deploy: deployTarget('node tools/firebase-deploy.mjs --only functions') } });
  writeJson(tree, 'firebase/project.json', { name: 'firebase', root: 'firebase', targets: { deploy: deployTarget('node tools/firebase-deploy-rules.mjs') } });
  if (projection) writeJson(tree, '.bespunky/branches.json', { schema: 1, projection });
  enable(tree, plugins);
  return tree;
};
const runCi = async (tree, ctx) => {
  await ctx.load('generators/ci/generator').default(tree, { layers: ['nx', 'node', 'firebase', 'ci'] });
};
const ci = MODES.flatMap(({ label, plugins, on }) => [
  {
    name: `ci, workflow ${label}: an undeclared model's pending names the skill only where it is enabled`,
    setup: ciFixture(plugins, null),
    run: runCi,
    expect: (tree, t) => {
      const pending = t.json('.bespunky/ci.json')?.pending ?? '';
      t.equal(pending.includes('bespunky-workflow:branch-and-release'), on, `pending: ${pending}`);
      t.ok(/Declare it(?: through the bespunky-workflow:branch-and-release skill)?, give each line/.test(pending), `pending reads whole: ${pending}`);
    },
  },
  {
    name: `ci, workflow ${label}: nothing bound — the pending binding to add, with or without the skill`,
    setup: ciFixture(plugins, { ...BOUND, deploys: [] }),
    run: runCi,
    expect: (tree, t) => {
      const pending = t.json('.bespunky/ci.json')?.pending ?? '';
      t.equal(pending.includes('bespunky-workflow:branch-and-release'), on, `pending: ${pending}`);
      t.ok(!/the branch-and-release skill/.test(pending) || on, `no bare skill name: ${pending}`);
      t.ok(pending.endsWith(', then upgrade.'), `pending reads whole: ${pending}`);
    },
  },
  {
    name: `ci, workflow ${label}: the deploy workflow's header`,
    setup: ciFixture(plugins, BOUND),
    run: runCi,
    expect: (tree, t) => {
      const wf = '.github/workflows/deploy.yml';
      check(t, on, wf, ['bespunky-workflow:branch-and-release'], ['.bespunky/branches.json — change them', ', then upgrade.']);
      t.hasNot(wf, 'through the branch-and-release skill');
    },
  },
]);

const firebase = MODES.map(({ label, plugins, on }) => ({
  name: `firebase-emulators, house / workflow ${label}: the deploy runners, the banner, apphosting.yaml`,
  setup: () => {
    const tree = workspace();
    writeJson(tree, 'apps/web/project.json', { name: 'web', root: 'apps/web', projectType: 'application' });
    enable(tree, plugins);
    return tree;
  },
  run: async (tree, ctx) => {
    await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE, clientApp: 'web' });
  },
  expect: (tree, t) => {
    check(t, on, 'tools/firebase-deploy.mjs', ['/bespunky-house:add-layer ci', 'bespunky-workflow:branch-and-release'], ['4. Add the ci layer', 'declared in .bespunky/branches.json']);
    check(t, on, 'tools/firebase-deploy-rules.mjs', ['/bespunky-house:upgrade'], ['Run the house upgrade', 'watches every declared file, or add']);
    check(t, on, 'tools/firebase-welcome.sh', ['bespunky-house:firebase-app-hosting'], ['Or just ask Claude to walk you through it (staging, deploy modes, account moves)']);
    check(t, on, 'apphosting.yaml', ['bespunky-house:firebase-app-hosting'], ['# Deploying: ask Claude', 'create the backend']);
  },
}));

// The prod environment is seeded by the Angular adapter's Firebase client port (no @nx/angular call on that path) —
// and by the 0.24.2 migration from the same template, which tools/test-migrations covers.
const environment = MODES.map(({ label, plugins, on }) => ({
  name: `the Angular Firebase client, house ${label}: environment.prod.ts`,
  setup: () => {
    const tree = angularWorkspace({ layout: 'apps-libs', link: 'paths' });
    // An Angular major the @angular/fire table pairs with a stable release, so the port's SDK pin does not refuse.
    updateJson(tree, 'package.json', (json) => ({ ...json, dependencies: { ...json.dependencies, '@angular/core': '~20.1.0', '@angular/common': '~20.1.0' } }));
    angularApp(tree, 'apps/web', 'web');
    enable(tree, plugins);
    return tree;
  },
  run: async (tree, ctx) => {
    ctx.load('adapters/angular/firebase-client').angularFirebaseClient.attach(tree, 'web', { workspaceName: SCOPE, staging: false, wireProviders: false });
  },
  expect: (tree, t) => {
    check(t, on, 'apps/web/src/environments/environment.prod.ts', ['bespunky-house:firebase-app-hosting'], ['and moving accounts — ask Claude']);
  },
}));

export default {
  name: 'skill pointers · rendered only where the project enables the plugin',
  cases: [...designSystem, ...angularDesignSystem, ...ci, ...firebase, ...environment],
};
