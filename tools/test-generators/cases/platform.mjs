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
/** Path aliases for libraries at packages/<name>, so imports between them resolve. */
const aliases = (tree, names) =>
  updateJson(tree, 'tsconfig.base.json', (json) => {
    json.compilerOptions ??= {};
    json.compilerOptions.paths = { ...json.compilerOptions.paths, ...Object.fromEntries(names.map((n) => [`@${SCOPE}/${n}`, [`packages/${n}/src/index.ts`]])) };
    return json;
  });


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
        // Its own rule instance: the project's constraints untouched, the platform ones in platformConstraints.
        t.has('eslint.config.mjs', 'const platformConstraints = [');
        t.has('eslint.config.mjs', 'plugins: { platform: nx }');
        t.has('eslint.config.mjs', "rules: { 'platform/enforce-module-boundaries': ['error', { depConstraints: platformConstraints }] }");
        t.has('eslint.config.mjs', "files: ['**/src/server.ts', '**/src/server/**']");
        t.has('eslint.config.mjs', "rules: { 'platform/enforce-module-boundaries': 'off' }");
        t.has('eslint.config.mjs', "'@google-cloud/*'");
        t.has('eslint.config.mjs', "'@firebase/*'");
        t.has('eslint.config.mjs', "              sourceTag: '*',\n              onlyDependOnLibsWithTags: ['*'],\n            },\n          ],");
        t.ok(tags(tree, 'brand').includes('platform:server'), `brand (firebase-admin): ${tags(tree, 'brand')}`);
        t.equal(tags(tree, 'util'), [], 'util (no evidence) is NOT defaulted to shared');
        t.ok(ctx.logs.some((line) => line.includes('Left `util` without a platform') && line.includes('--platform=')), `util reported:\n${ctx.logs.join('\n')}`);
        t.ok(tags(tree, 'functions').includes('platform:server'), `functions: ${tags(tree, 'functions')}`);
        t.ok(ctx.logs.some((line) => line.includes('Classified `brand` platform:server')), `reported:\n${ctx.logs.join('\n')}`);
        t.equal(t.json('nx.json')?.targetDefaults?.lint?.syncGenerators, ['@bespunky/nx-tools:platform-sync'], 'the sync generator, on lint');
      },
    },
    {
      name: 'the workspace root as a shell (the verdaccio holder): never tagged, never mentioned — root-level tooling is not its code',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        writeJson(tree, 'project.json', { name: 'shell', root: '.', targets: { 'local-registry': { executor: '@nx/js:verdaccio' } } });
        tree.write('tools/script.mjs', "import x from 'firebase-admin';\n"); // tooling at the root is not the root's code
        lib(tree, 'packages/util', { 'src/index.ts': "export { initializeApp } from 'firebase/app';\n" });
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
      },
      expect: (tree, t, ctx) => {
        t.equal(tags(tree, 'shell').filter((tag) => tag.startsWith('platform:')), [], 'the shell stays untagged');
        t.ok(!ctx.logs.some((line) => line.includes('`shell`')), `and unmentioned: ${ctx.logs.filter((l) => l.includes('shell'))}`);
        t.ok(tags(tree, 'util').includes('platform:web'), 'a real library is still classified');
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

    {
      name: 'the classifier reads imports the way lint does — a comment, a string, a template literal and a spec are no evidence',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        aliases(tree, ['comment', 'string', 'template', 'spec', 'required', 'builtin', 'typeonly']);
        lib(tree, 'packages/comment', { 'src/index.ts': "// never import from 'firebase-admin' here\nexport const b = 1;\n" });
        lib(tree, 'packages/string', { 'src/index.ts': "export const s = `import x from 'firebase'`;\n" });
        lib(tree, 'packages/template', { 'src/index.ts': 'export const d = () => import(`firebase-admin`);\n' });
        lib(tree, 'packages/spec', { 'src/index.ts': 'export const c = 1;\n', 'src/index.spec.ts': "import { initializeApp } from 'firebase-admin/app';\n", 'jest.config.ts': "import { readFileSync } from 'fs';\nexport default {};\n" });
        lib(tree, 'packages/required', { 'src/index.js': "const admin = require('firebase-admin');\nmodule.exports = admin;\n" });
        lib(tree, 'packages/builtin', { 'src/index.ts': "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n" });
        lib(tree, 'packages/typeonly', { 'src/index.ts': "import type { App } from 'firebase-admin/app';\nexport type X = App;\n" });
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
      },
      expect: (tree, t, ctx) => {
        for (const name of ['comment', 'string', 'template', 'spec']) t.equal(tags(tree, name), [], `${name}: no evidence, left untagged`);
        t.ok(tags(tree, 'required').includes('platform:server'), `require() is an import (Nx visits it): ${tags(tree, 'required')}`);
        t.ok(tags(tree, 'builtin').includes('platform:server'), `a Node built-in is server evidence: ${tags(tree, 'builtin')}`);
        t.ok(tags(tree, 'typeonly').includes('platform:server'), `a type-only import counts (Nx has no exemption): ${tags(tree, 'typeonly')}`);
        t.ok(ctx.logs.some((line) => line.includes('Left `spec` without a platform')), `reported:\n${ctx.logs.join('\n')}`);
      },
    },
    {
      name: 'an application takes its stack\'s platform: SSR server code is in scope, a server import elsewhere is reported',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        writeJson(tree, 'apps/web/project.json', { name: 'web', root: 'apps/web', projectType: 'application', targets: { build: { executor: '@angular/build:application' } } });
        tree.write('apps/web/src/server.ts', "import { getAuth } from 'firebase-admin/auth';\nimport express from 'express';\n");
        tree.write('apps/web/src/app/leak.ts', "import { getFirestore } from 'firebase-admin/firestore';\n");
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
      },
      expect: (tree, t, ctx) => {
        t.ok(tags(tree, 'web').includes('platform:web'), `web: ${tags(tree, 'web')}`);
        const warning = ctx.logs.find((line) => line.includes('`web` runs as platform:web')) ?? '';
        t.ok(warning.includes('apps/web/src/app/leak.ts imports firebase-admin/firestore'), `the leak is reported:\n${ctx.logs.join('\n')}`);
        t.ok(!warning.includes('apps/web/src/server.ts'), `SSR server code is not: ${warning}`);
      },
    },
    {
      name: 'the classifier honours the config\'s own bans: a package the project bans for web is server evidence',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        lib(tree, 'packages/db', { 'src/index.ts': "import { Pool } from 'pg';\nexport const p = Pool;\n" });
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
        tree.write('eslint.config.mjs', tree.read('eslint.config.mjs', 'utf8').replace("bannedExternalImports: [\n      'firebase-admin',", "bannedExternalImports: [\n      'pg',\n      'firebase-admin',"));
        await platform(ctx)(tree, { project: 'db' });
      },
      expect: (tree, t) => t.ok(tags(tree, 'db').includes('platform:server'), `db (pg, banned for web by the config): ${tags(tree, 'db')}`),
    },
    {
      name: 'platform <project> with no evidence, or on tooling: refused — shared is stated, never inferred',
      once: 'the operation throws by design',
      setup: () => {
        const tree = workspace();
        lib(tree, 'packages/plain', { 'src/index.ts': 'export const x = 1;\n' });
        writeJson(tree, 'tools/scripts/project.json', { name: 'scripts', root: 'tools/scripts', tags: ['tooling'] });
        tree.write('tools/scripts/run.mjs', "import fs from 'node:fs';\n");
        return tree;
      },
      run: async (tree, ctx) => {
        for (const project of ['plain', 'scripts']) {
          try {
            await platform(ctx)(tree, { project });
          } catch (error) {
            (ctx.errors ??= {})[project] = error.message;
          }
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(/Cannot infer `plain`.*absence of evidence.*--platform=/s.test(ctx.errors?.plain ?? ''), `plain: ${ctx.errors?.plain}`);
        t.ok(/`scripts` is tooling/.test(ctx.errors?.scripts ?? ''), `scripts: ${ctx.errors?.scripts}`);
        t.equal(tags(tree, 'plain'), [], 'left untagged');
      },
    },
    {
      name: 'platform-sync: a project created later is tagged before lint when the evidence settles it; nothing without a firewall',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', ESLINT);
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
        lib(tree, 'packages/late', { 'src/index.ts': "import { getAuth } from 'firebase/auth';\n" });
        lib(tree, 'packages/blank', { 'src/index.ts': 'export const x = 1;\n' });
        ctx.result = await ctx.load('generators/platform-sync/generator').default(tree);
        const bare = workspace();
        lib(bare, 'packages/late', { 'src/index.ts': "import { getAuth } from 'firebase/auth';\n" });
        ctx.bare = await ctx.load('generators/platform-sync/generator').default(bare);
        ctx.bareTags = tags(bare, 'late');
      },
      expect: (tree, t, ctx) => {
        t.ok(tags(tree, 'late').includes('platform:web'), `late: ${tags(tree, 'late')}`);
        t.equal(tags(tree, 'blank'), [], 'an evidence-free project is left for a human');
        t.ok((ctx.result?.outOfSyncMessage ?? '').includes('late → platform:web'), `out of sync: ${ctx.result?.outOfSyncMessage}`);
        t.equal([ctx.bare, ctx.bareTags], [undefined, []], 'no firewall, no classification');
      },
    },
    {
      name: 'the firewall\'s writer: an old-shaped config elsewhere in the house (defineConfig), parsed back',
      setup: () => {
        const tree = workspace();
        tree.write('eslint.config.mjs', "import { defineConfig } from 'eslint/config';\n\nexport default defineConfig([\n  { files: ['**/*.ts'] },\n]);\n");
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE });
      },
      expect: (tree, t) => {
        const out = t.read('eslint.config.mjs');
        t.ok(out.includes("import nx from '@nx/eslint-plugin';"), `the plugin import is added:\n${out}`);
        t.ok(/const platformConstraints = \[[\s\S]*\];\n\nexport default defineConfig\(\[/.test(out), `declared before the export:\n${out}`);
        t.ok(/\{ files: \['\*\*\/\*\.ts'\] \},\n  \/\/ THE PLATFORM FIREWALL/.test(out), `appended to the array:\n${out}`);
      },
    },
  ],
};
