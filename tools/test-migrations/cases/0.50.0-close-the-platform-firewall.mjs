// 0.50.0 — close the platform firewall: onlyDependOnLibsWithTags on every platform constraint, a platform:shared
// constraint, and every untagged project classified from evidence (or reported).
//
// The shapes it meets: the eslint.config.mjs the pre-0.50.0 firebase-emulators wrote (old comment, two ban-only
// constraints, a project's own addition to a ban list), a workspace with no firewall at all (no Firebase), a firewall
// already current, and the projects the E4 handoff describes — an untagged library on firebase-admin imported by a
// web app (the leak), an untagged Angular library, an untagged plain library, a package.json-defined project, a library
// importing a server library, and a project that mixes web and server.
import { createRequire } from 'node:module';

const devkit = createRequire(import.meta.url)('@nx/devkit');

// The firewall exactly as firebase-emulators wrote it from 0.36.0 through 0.49.x on an Angular workspace (d1acfe8's
// well-formed splice, c69fbac's framework-neutral comment), plus one project addition to the server list ('react'):
// git show 8a017ae:plugins/house/engine/nx-tools/src/generators/firebase-emulators/generator.ts — addPlatformBoundaries.
// Up to 0.35.0 it was spliced before the closing `]` with an Angular-worded comment (0d09453); that shape is NOT
// listed under historicalShapes because the rung does not recognise that comment (it survives above the guidance).
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

let logs = [];
function captureLogs() {
  logs = [];
  for (const level of ['info', 'warn']) {
    const through = devkit.logger[level];
    devkit.logger[level] = (...args) => {
      logs.push(`${level}: ${args.join(' ')}`);
      return through(...args);
    };
  }
}

export default {
  name: '0.50.0 · close-the-platform-firewall',
  ladder: ['0.50.0/close-the-platform-firewall'],
  cases: [
    {
      name: 'the old firewall gains onlyDependOnLibsWithTags, a shared constraint (union of its own bans) and the guidance',
      setup: (tree) => workspace(tree),
      expect: (tree, t) => {
        const config = t.read('eslint.config.mjs');
        t.occurrences('eslint.config.mjs', "onlyDependOnLibsWithTags: ['platform:web', 'platform:shared']", 1);
        t.occurrences('eslint.config.mjs', "onlyDependOnLibsWithTags: ['platform:server', 'platform:shared']", 1);
        t.occurrences('eslint.config.mjs', "onlyDependOnLibsWithTags: ['platform:shared']", 1);
        t.ok(/sourceTag: 'platform:shared',[\s\S]*bannedExternalImports: \['firebase-admin'[^\]]*'react'\]/.test(config), `shared bans the union, the project's own 'react' kept:\n${config}`);
        t.has('eslint.config.mjs', "bannedExternalImports: ['firebase', 'firebase/*', '@angular/*', 'react']");
        t.has('eslint.config.mjs', 'THE PLATFORM FIREWALL');
        t.has('eslint.config.mjs', 'g @bespunky/nx-tools:platform <project>');
        t.hasNot('eslint.config.mjs', '// by platform: the server-only');
        t.has('eslint.config.mjs', "sourceTag: '*',");
      },
    },
    {
      name: 'untagged projects are classified from evidence; the mixed one and the leak are reported',
      setup: (tree) => {
        workspace(tree);
        captureLogs();
      },
      expect: (tree, t) => {
        t.ok(tagsOf(tree, 'libs/brand/project.json').join() === 'scope:shared,platform:server', `brand: ${tagsOf(tree, 'libs/brand/project.json')}`);
        t.ok(tagsOf(tree, 'libs/ui/project.json').includes('platform:web'), `ui (Angular-built): ${tagsOf(tree, 'libs/ui/project.json')}`);
        t.ok(tagsOf(tree, 'libs/util/project.json').includes('platform:shared'), `util (no evidence; another worktree ignored): ${tagsOf(tree, 'libs/util/project.json')}`);
        t.ok(tagsOf(tree, 'libs/admin-tools/package.json').includes('platform:server'), `admin-tools (imports a server lib), in its nx block: ${tree.read('libs/admin-tools/package.json', 'utf8')}`);
        t.missing('libs/admin-tools/project.json');
        t.ok(!tagsOf(tree, 'libs/mixed/project.json').some((tag) => tag.startsWith('platform:')), 'mixed must stay untagged');
        t.equal(tagsOf(tree, 'apps/web/project.json'), ['platform:web'], 'a declared platform is never re-inferred');
        const text = logs.join('\n');
        t.ok(/Classified `brand` platform:server — imports firebase-admin\/firestore/.test(text), `the inference and its reason:\n${text}`);
        t.ok(/Could not classify `mixed`.*nx g @bespunky\/nx-tools:platform mixed --platform=<web\|server\|shared>/.test(text), `the unresolved one, with its command:\n${text}`);
        t.ok(/`web` \(platform:web\) imports `brand` \(platform:server\)/.test(text), `the leak the firewall now catches:\n${text}`);
      },
    },
    {
      // The dogfood's web-e2e: a hand-written project.json, one line per target. Tagging it must add the tag and
      // move nothing else — devkit's updateProjectConfiguration spread every target (and implicitDependencies) out.
      name: 'a compact hand-written project.json keeps its form: only the tag is added',
      setup: (tree) => {
        workspace(tree);
        tree.write('apps/web-e2e/project.json', COMPACT_E2E);
        tree.write('apps/web-e2e/src/app.spec.ts', "import { test } from '@playwright/test';\n");
      },
      expect: (tree, t) => {
        t.equal(
          t.read('apps/web-e2e/project.json'),
          COMPACT_E2E.replace('"implicitDependencies": ["web"]', '"implicitDependencies": ["web"],\n  "tags": ["platform:shared"]'),
          'only the tag line differs',
        );
      },
    },
    {
      name: 'no firewall (no Firebase): nothing touched, nothing tagged',
      setup: (tree) => workspace(tree, NO_FIREWALL),
      expect: (tree, t) => {
        t.ok(t.read('eslint.config.mjs') === NO_FIREWALL, 'the config changed');
        t.ok(!tagsOf(tree, 'libs/util/project.json').length, 'a project was tagged without a firewall');
      },
    },
    {
      name: 'no eslint.config.mjs: nothing to do',
      setup: (tree) => project(tree, 'libs/util', { projectType: 'library' }),
      expect: (tree, t) => t.ok(!tagsOf(tree, 'libs/util/project.json').length, 'tagged without a firewall'),
    },
  ],
};
