// 0.50.0 — close the platform firewall: the old constraints moved out of the project's rule into the firewall's own
// (`platformConstraints`, `platform/enforce-module-boundaries`), the sync generator registered, and every untagged
// code project classified from evidence — or reported, never defaulted to shared.
//
// The shapes it meets: the eslint.config.mjs the pre-0.50.0 firebase-emulators wrote (old comment — both shipped
// wordings —, two ban-only constraints, a project's own addition to a ban list), a workspace with no firewall at all
// (no Firebase), and the projects the E4 handoff describes — an untagged library on firebase-admin imported by a web
// app (the leak), an untagged Angular library, an untagged plain library, a package.json-defined project, a library
// importing a server library, and a project that mixes web and server.

// The firewall exactly as firebase-emulators wrote it from 0.36.0 through 0.49.x on an Angular workspace (d1acfe8's
// well-formed splice, c69fbac's framework-neutral comment), plus one project addition to the server list ('react'):
// git show 8a017ae:plugins/house/engine/nx-tools/src/generators/firebase-emulators/generator.ts — addPlatformBoundaries.
// Up to 0.35.0 it was spliced before the closing `]` with an Angular-worded comment (0d09453) — listed under
// historicalShapes (OLD_FIREWALL_035*), which converge with this one.
const OLD_FIREWALL = `import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
            // by platform: the server-only Firebase Admin/Functions SDKs belong to Cloud
            // Functions alone — they must never reach browser/SSR code (they pull in
            // Node-native modules and admin credentials). Symmetrically, the browser Firebase
            // SDK and the client framework have no place in the functions runtime.
            {
              sourceTag: 'platform:web',
              bannedExternalImports: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],
            },
            {
              sourceTag: 'platform:server',
              bannedExternalImports: ['firebase', 'firebase/*', '@angular/*', 'react'],
            },
          ],
        },
      ],
    },
  },
];
`;

// ≤0.35 wording of the comment (1ac9b19:…/firebase-emulators/generator.ts:862-865, from 0d09453), as prettier leaves it.
const OLD_FIREWALL_035 = OLD_FIREWALL.replace(
  '// Functions alone — they must never reach browser/SSR code (they pull in',
  '// Functions alone — they must never reach browser/SSR Angular code (they pull in',
).replace('// SDK and the client framework have no place in the functions runtime.', '// SDK and Angular have no place in the functions runtime.');
// …and as that generator inserted it without prettier: its snippet carried no indentation of its own.
const OLD_FIREWALL_035_RAW = OLD_FIREWALL_035.replace(/\n {12}(\/\/ by platform[\s\S]*?)(?=\n {10}\],)/, (_, block) => `\n${block.replace(/\n {12}/g, '\n')}`);

const COMPACT_E2E = `{
  "name": "web-e2e",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/web-e2e/src",
  "targets": {
    "e2e": { "executor": "@nx/playwright:playwright", "options": { "config": "apps/web-e2e/playwright.config.ts" }, "dependsOn": [{ "target": "dev-stack", "projects": ["web"] }] },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "implicitDependencies": ["web"]
}
`;

const NO_FIREWALL = OLD_FIREWALL.replace(/\n {12}\/\/ by platform[\s\S]*?(?=\n {10}\],)/, '');

const project = (tree, root, json) => tree.write(`${root}/project.json`, JSON.stringify({ name: root.split('/').pop(), root, ...json }, null, 2));
const tagsOf = (tree, file) => {
  const json = JSON.parse(tree.read(file, 'utf8'));
  return json.tags ?? json.nx?.tags ?? [];
};

/** The workspace E4 describes: a web app, an untagged server-bound lib it imports, and the usual neighbours. */
function workspace(tree, config = OLD_FIREWALL) {
  tree.write('eslint.config.mjs', config);
  tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: {
    '@acme/brand': ['libs/brand/src/index.ts'],
    '@acme/ui': ['libs/ui/src/index.ts'],
    '@acme/util': ['libs/util/src/index.ts'],
    '@acme/admin-tools': ['libs/admin-tools/src/index.ts'],
    '@acme/mixed': ['libs/mixed/src/index.ts'],
  } } }));
  project(tree, 'apps/web', { projectType: 'application', tags: ['platform:web'], targets: { build: { executor: '@angular/build:application' } } });
  tree.write('apps/web/src/main.ts', "import { brand } from '@acme/brand';\nimport { bootstrapApplication } from '@angular/platform-browser';\n");
  project(tree, 'apps/functions', { projectType: 'application', tags: ['platform:server'] });
  tree.write('apps/functions/src/main.ts', "import * as admin from 'firebase-admin';\n");
  // The leak: a library on firebase-admin, untagged, imported by the web app.
  project(tree, 'libs/brand', { projectType: 'library', tags: ['scope:shared'] });
  tree.write('libs/brand/src/index.ts', "import { getFirestore } from 'firebase-admin/firestore';\nexport const brand = 1;\n");
  // An Angular library (built by the Angular stack): web, though it imports nothing Angular yet.
  project(tree, 'libs/ui', { projectType: 'library', targets: { build: { executor: '@nx/angular:package' } } });
  tree.write('libs/ui/src/index.ts', 'export const ui = 1;\n');
  // A plain library with no platform-bound import: shared.
  project(tree, 'libs/util', { projectType: 'library' });
  tree.write('libs/util/src/index.ts', "import { join } from './join';\nexport const util = join;\n");
  // A library built on the server library: server, by what it imports.
  tree.write('libs/admin-tools/package.json', JSON.stringify({ name: '@acme/admin-tools', nx: { name: 'admin-tools' } }));
  tree.write('libs/admin-tools/src/index.ts', "export { brand } from '@acme/brand';\n");
  // Web and server in one library: not classifiable.
  project(tree, 'libs/mixed', { projectType: 'library' });
  tree.write('libs/mixed/src/index.ts', "import { initializeApp } from 'firebase/app';\nimport admin from 'firebase-admin';\n");
  // Another worktree's copy must not count as anyone's source.
  tree.write('libs/util/.claude/worktrees/x/src/evil.ts', "import admin from 'firebase-admin';\n");
}

export default {
  name: '0.50.0 · close-the-platform-firewall',
  ladder: ['0.50.0/close-the-platform-firewall'],
  cases: [
    {
      name: 'the old firewall moves into its own rule: platformConstraints (own bans carried), the scopes, the guidance',
      setup: (tree) => workspace(tree),
      historicalShapes: [
        { name: '≤0.35 comment wording, prettier-formatted (1ac9b19 / 0d09453)', setup: (tree) => workspace(tree, OLD_FIREWALL_035) },
        { name: '≤0.35 comment wording, as inserted without prettier — unindented (1ac9b19)', setup: (tree) => workspace(tree, OLD_FIREWALL_035_RAW) },
      ],
      expect: (tree, t, logs) => {
        const config = t.read('eslint.config.mjs');
        t.has('eslint.config.mjs', 'const platformConstraints = [');
        t.occurrences('eslint.config.mjs', "onlyDependOnLibsWithTags: ['platform:web', 'platform:shared']", 1);
        t.occurrences('eslint.config.mjs', "onlyDependOnLibsWithTags: ['platform:server', 'platform:shared']", 1);
        t.occurrences('eslint.config.mjs', "onlyDependOnLibsWithTags: ['platform:shared']", 1);
        t.occurrences('eslint.config.mjs', "sourceTag: 'platform:", 3);
        t.ok(/sourceTag: 'platform:server',[\s\S]*?'react',[\s\S]*?sourceTag: 'platform:shared',[\s\S]*?'react',/.test(config), `the project's own 'react' carried, and in shared:\n${config}`);
        t.has('eslint.config.mjs', "rules: { 'platform/enforce-module-boundaries': ['error', { depConstraints: platformConstraints }] }");
        t.has('eslint.config.mjs', 'THE PLATFORM FIREWALL');
        t.has('eslint.config.mjs', 'g @bespunky/nx-tools:platform <project>');
        t.hasNot('eslint.config.mjs', 'by platform:');
        // The project's own rule keeps exactly what was its own.
        t.ok(/depConstraints: \[\n {12}\{\n {14}sourceTag: '\*',\n {14}onlyDependOnLibsWithTags: \['\*'\],\n {12}\},\n {10}\],/.test(config), `the project's constraints:\n${config}`);
        t.equal(t.json('nx.json')?.targetDefaults?.lint?.syncGenerators, ['@bespunky/nx-tools:platform-sync'], 'the sync generator, on lint');
        t.ok(logs.some((line) => line.includes("carried this project's own platform:server bans: react")), `the carried ban is reported:\n${logs.join('\n')}`);
      },
    },
    {
      name: 'untagged code projects are classified from evidence; the mixed one, the evidence-free one and the leak are reported',
      setup: (tree) => workspace(tree),
      expect: (tree, t, logs) => {
        t.ok(tagsOf(tree, 'libs/brand/project.json').join() === 'scope:shared,platform:server', `brand: ${tagsOf(tree, 'libs/brand/project.json')}`);
        t.ok(tagsOf(tree, 'libs/ui/project.json').includes('platform:web'), `ui (Angular-built): ${tagsOf(tree, 'libs/ui/project.json')}`);
        t.equal(tagsOf(tree, 'libs/util/project.json'), [], 'util: no evidence (another worktree ignored) — not defaulted to shared');
        t.ok(tagsOf(tree, 'libs/admin-tools/package.json').includes('platform:server'), `admin-tools (imports a server lib), in its nx block: ${tree.read('libs/admin-tools/package.json', 'utf8')}`);
        t.missing('libs/admin-tools/project.json');
        t.ok(!tagsOf(tree, 'libs/mixed/project.json').some((tag) => tag.startsWith('platform:')), 'mixed must stay untagged');
        t.equal(tagsOf(tree, 'apps/web/project.json'), ['platform:web'], 'a declared platform is never re-inferred');
        const text = logs.join('\n');
        t.ok(/Classified `brand` platform:server — imports firebase-admin\/firestore/.test(text), `the inference and its reason:\n${text}`);
        t.ok(/Left `mixed` without a platform: it mixes web and server.*nx g @bespunky\/nx-tools:platform mixed --platform=<web\|server\|shared>/.test(text), `the mixed one, with its command:\n${text}`);
        t.ok(/Left `util` without a platform: nothing in it binds it/.test(text), `the evidence-free one:\n${text}`);
        t.ok(/`web` \(platform:web\) imports `brand` \(platform:server\)/.test(text), `the leak the firewall now catches:\n${text}`);
      },
    },
    {
      // The dogfood's web-e2e: a hand-written project.json, one line per target. Tagging it must add the tag and
      // move nothing else — devkit's updateProjectConfiguration spread every target (and implicitDependencies) out.
      // Its spec is no evidence (tests never ship); the support file reading the filesystem is.
      name: 'a compact hand-written project.json keeps its form: only the tag is added',
      setup: (tree) => {
        workspace(tree);
        tree.write('apps/web-e2e/project.json', COMPACT_E2E);
        tree.write('apps/web-e2e/src/app.spec.ts', "import { test } from '@playwright/test';\n");
        tree.write('apps/web-e2e/src/support/fixtures.ts', "import { readFileSync } from 'node:fs';\n");
      },
      expect: (tree, t) => {
        t.equal(
          t.read('apps/web-e2e/project.json'),
          COMPACT_E2E.replace('"implicitDependencies": ["web"]', '"implicitDependencies": ["web"],\n  "tags": ["platform:server"]'),
          'only the tag line differs',
        );
      },
    },
    {
      name: 'an e2e project of tests only, and a project tagged tooling: tooling — not classified, not reported',
      setup: (tree) => {
        workspace(tree);
        project(tree, 'apps/site-e2e', { projectType: 'application', implicitDependencies: ['web'] });
        tree.write('apps/site-e2e/src/app.spec.ts', "import { test } from '@playwright/test';\n");
        project(tree, 'firebase', { projectType: 'application', tags: ['tooling'] });
        tree.write('firebase/seed.mjs', "import fs from 'node:fs';\n");
      },
      expect: (tree, t, logs) => {
        t.equal(tagsOf(tree, 'apps/site-e2e/project.json'), [], 'site-e2e untagged');
        t.equal(tagsOf(tree, 'firebase/project.json'), ['tooling'], 'the tooling project untagged');
        t.ok(!logs.some((line) => line.includes('`site-e2e`') || line.includes('`firebase`')), `unmentioned:\n${logs.join('\n')}`);
      },
    },
    {
      name: 'no firewall (no Firebase): nothing touched, nothing tagged',
      setup: (tree) => workspace(tree, NO_FIREWALL),
      expect: (tree, t) => {
        t.ok(t.read('eslint.config.mjs') === NO_FIREWALL, 'the config changed');
        t.ok(!tagsOf(tree, 'libs/util/project.json').length, 'a project was tagged without a firewall');
        t.ok(!tagsOf(tree, 'libs/brand/project.json').includes('platform:server'), 'a project was classified without a firewall');
      },
    },
    {
      name: 'no eslint.config.mjs: nothing to do',
      setup: (tree) => project(tree, 'libs/util', { projectType: 'library' }),
      expect: (tree, t) => t.ok(!tagsOf(tree, 'libs/util/project.json').length, 'tagged without a firewall'),
    },
  ],
};
