// THE PLATFORM BOUNDARY — every project classified, the ESLint firewall fail-closed (src/platform).
//
// Three promises, each a place an untagged project used to slip through:
//   1. the firewall a workspace gains (firebase-emulators) bounds each platform's DEPENDENCIES, not only its imports,
//      and classifies the projects that were there before it (evidence only, reported);
//   2. every project the house creates is born classified — publishable-lib (the stack's platform, or --platform),
//      the app generator (the stack's);
//   3. `platform <project>` — the command the firewall's guidance names — infers, states, and refuses a mixed project.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, angularWorkspace, SCOPE } from '../workspaces.mjs';

const { writeJson, updateJson, getProjects } = requireFromRepo('@nx/devkit');

const ESLINT = `import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  {
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
];
`;

const lib = (tree, root, files = {}, json = {}) => {
  writeJson(tree, `${root}/project.json`, { name: root.split('/').pop(), root, projectType: 'library', ...json });
  for (const [file, text] of Object.entries(files)) tree.write(`${root}/${file}`, text);
};
const tags = (tree, name) => getProjects(tree).get(name)?.tags ?? [];
const platform = (ctx) => ctx.load('generators/platform/generator').default;

export default {
  name: 'platform · the boundary every project sits behind',
  cases: [
    {
      name: 'firebase-emulators writes the fail-closed firewall and classifies the projects already there',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        lib(tree, 'packages/brand', { 'src/index.ts': "import { getAuth } from 'firebase-admin/auth';\n" });
        lib(tree, 'packages/util', { 'src/index.ts': 'export const x = 1;\n' });
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
      },
      expect: (tree, t, ctx) => {
        t.has('eslint.config.mjs', "onlyDependOnLibsWithTags: ['platform:web', 'platform:shared']");
        t.has('eslint.config.mjs', "onlyDependOnLibsWithTags: ['platform:server', 'platform:shared']");
        t.has('eslint.config.mjs', "sourceTag: 'platform:shared'");
        t.has('eslint.config.mjs', 'THE PLATFORM FIREWALL');
        t.has('eslint.config.mjs', 'g @bespunky/nx-tools:platform <project>');
        t.occurrences('eslint.config.mjs', "sourceTag: 'platform:web'", 1);
        t.ok(tags(tree, 'brand').includes('platform:server'), `brand (firebase-admin): ${tags(tree, 'brand')}`);
        t.ok(tags(tree, 'util').includes('platform:shared'), `util (no evidence): ${tags(tree, 'util')}`);
        t.ok(tags(tree, 'functions').includes('platform:server'), `functions: ${tags(tree, 'functions')}`);
        t.ok(ctx.logs.some((line) => line.includes('Classified `brand` platform:server')), `reported:\n${ctx.logs.join('\n')}`);
      },
    },
    {
      name: 'the workspace root as a shell (the verdaccio holder): never tagged, never mentioned — root-level tooling is not its code',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        writeJson(tree, 'project.json', { name: 'shell', root: '.', targets: { 'local-registry': { executor: '@nx/js:verdaccio' } } });
        tree.write('tools/script.mjs', "import x from 'firebase-admin';\n"); // tooling at the root is not the root's code
        lib(tree, 'packages/util', { 'src/index.ts': 'export const x = 1;\n' });
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
      },
      expect: (tree, t, ctx) => {
        t.equal(tags(tree, 'shell').filter((tag) => tag.startsWith('platform:')), [], 'the shell stays untagged');
        t.ok(!ctx.logs.some((line) => line.includes('`shell`')), `and unmentioned: ${ctx.logs.filter((l) => l.includes('shell'))}`);
        t.ok(tags(tree, 'util').includes('platform:shared'), 'a real library is still classified');
      },
    },
    {
      name: 'the workspace root with a build target is a code project: classified like any other',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        writeJson(tree, 'project.json', { name: 'solo', root: '.', targets: { build: { executor: 'nx:run-commands', options: { command: 'tsc' } } } });
        tree.write('src/main.ts', 'export const main = 1;\n');
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
      },
      expect: (tree, t) => t.ok(tags(tree, 'solo').some((tag) => tag.startsWith('platform:')), `tagged: ${tags(tree, 'solo')}`),
    },
    {
      name: 'platform <project>: inferred from its imports, with the reason; a package.json project tagged in its nx block',
      setup: () => {
        const tree = workspace({ layout: 'packages', link: 'workspaces-npm' });
        writeJson(tree, 'packages/server-kit/package.json', { name: `@${SCOPE}/server-kit`, version: '0.0.0', nx: { name: 'server-kit' } });
        tree.write('packages/server-kit/src/index.ts', "export * from 'firebase-functions/v2';\n");
        return tree;
      },
      run: async (tree, ctx) => platform(ctx)(tree, { project: 'server-kit' }),
      expect: (tree, t, ctx) => {
        t.equal(t.json('packages/server-kit/package.json')?.nx?.tags, ['platform:server'], 'the nx block');
        t.missing('packages/server-kit/project.json');
        t.ok(ctx.logs.some((line) => /is now platform:server .*firebase-functions\/v2/.test(line)), `reason:\n${ctx.logs.join('\n')}`);
      },
    },
    {
      name: 'platform <project> --platform=web: stated, replacing the project\'s other platform tag',
      setup: () => {
        const tree = workspace();
        lib(tree, 'packages/kit', {}, { tags: ['scope:x', 'platform:shared'] });
        return tree;
      },
      run: async (tree, ctx) => platform(ctx)(tree, { project: 'kit', platform: 'web' }),
      expect: (tree, t) => t.equal(tags(tree, 'kit'), ['scope:x', 'platform:web'], 'one platform tag'),
    },
    {
      name: 'platform <project> on a project mixing web and server: refused, with the evidence and the command',
      once: 'the operation throws by design',
      setup: () => {
        const tree = workspace();
        lib(tree, 'packages/mixed', { 'src/index.ts': "import 'firebase/app';\nimport 'firebase-admin';\n" });
        return tree;
      },
      run: async (tree, ctx) => {
        try {
          await platform(ctx)(tree, { project: 'mixed' });
        } catch (error) {
          ctx.error = error.message;
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(/mixes web and server .*firebase\/app.*firebase-admin.*--platform=<web\|server\|shared>/s.test(ctx.error ?? ''), `refusal: ${ctx.error}`);
        t.equal(tags(tree, 'mixed'), [], 'left untagged');
      },
    },
    {
      name: 'publishable-lib --stack=js: born platform:shared (the stack\'s); --platform=server states another',
      needs: ['@nx/js'],
      once: 'it CREATES libraries',
      setup: () => {
        const tree = workspace();
        updateJson(tree, 'package.json', (json) => ({ ...json, devDependencies: { ...json.devDependencies, '@nx/js': '23.1.0' } }));
        return tree;
      },
      run: async (tree, ctx) => {
        const create = ctx.load('generators/publishable-lib/generator').default;
        await create(tree, { name: 'kit', stack: 'js', skipFormat: true });
        await create(tree, { name: 'admin', stack: 'js', platform: 'server', tags: 'scope:ops', skipFormat: true });
        try {
          await create(tree, { name: 'clash', stack: 'js', platform: 'server', tags: 'platform:web', skipFormat: true });
        } catch (error) {
          ctx.error = error.message;
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(tags(tree, 'kit').includes('platform:shared'), `kit: ${tags(tree, 'kit')}`);
        t.ok(tags(tree, 'admin').includes('platform:server') && tags(tree, 'admin').includes('scope:ops'), `admin: ${tags(tree, 'admin')}`);
        t.ok((ctx.error ?? '').includes('contradicts'), `a contradiction is refused: ${ctx.error}`);
      },
    },
    {
      name: 'the app generator and an Angular library: born platform:web',
      needs: ['@nx/angular', '@nx/js'],
      once: 'it CREATES an app and a library',
      setup: () => angularWorkspace({ layout: 'apps-libs', link: 'paths' }),
      run: async (tree, ctx) => {
        await ctx.load('generators/app/generator').default(tree, { name: 'shop', skipFormat: true });
        await ctx.load('generators/publishable-lib/generator').default(tree, { name: 'widgets', skipFormat: true });
      },
      expect: (tree, t) => {
        t.ok(tags(tree, 'shop').includes('platform:web'), `shop: ${tags(tree, 'shop')}`);
        t.ok(tags(tree, 'widgets').includes('platform:web'), `widgets: ${tags(tree, 'widgets')}`);
      },
    },
  ],
};
