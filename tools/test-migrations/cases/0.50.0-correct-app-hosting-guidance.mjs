// 0.50.0 — the App Hosting guidance the house seeded into comments stops saying what is false.
//
// The stock files are the templates exactly as each shipped (`0.50.0-stock-templates/`, taken from git: the
// apphosting.yaml header changed twice — the original, the GitHub-link paragraph, the house rename), because the
// migration recognises the blocks by their exact text and a fixture that paraphrased them would prove nothing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const stock = (name) => readFileSync(join(HERE, '0.50.0-stock-templates', `${name}.tpl`), 'utf8').replaceAll('{{projectName}}', 'web');
const RUNG = '0.50.0/correct-app-hosting-guidance';
const project = (tree, root) => tree.write(`${root}/project.json`, JSON.stringify({ name: root.split('/').pop(), root, projectType: 'application' }));

/**
 * environment.prod.ts as the two earlier releases shipped it. Everything down to the `import` line — the guidance
 * blocks included — is byte-identical to the stock (0d09453) template; only the body below it differs, kept verbatim.
 */
const PROD_HEAD = (() => {
  const text = stock('environment.prod.ts');
  const at = text.indexOf("import type { Environment } from './environment.interface';\n\n");
  return text.slice(0, at) + "import type { Environment } from './environment.interface';\n\n";
})();
const PROD_SHAPES = {
  // git show 5d61983:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/environment.prod.ts.tpl
  '5d61983': `${PROD_HEAD}// No \`emulators\` block. The Environment interface marks it optional precisely
// so the prod file can omit it. Reason: even though firebase.config.ts's
// \`connect*Emulator(...)\` calls are dead code in prod (DCE strips them via the
// \`!environment.production\` gate), the emulator string/number LITERALS would
// still ship as part of this const object — DCE removes unreachable code, not
// unreachable property values on a live exported object. Omitting the block
// means there's literally nothing about local dev addresses in the production
// bundle.
export const environment: Environment = {
  production: true,
  firebase: {
    projectId: '{{projectId}}',
    apiKey: '{{apiKey}}',
    appId: '{{appId}}',
  },
};
`,
  // git show 6106999:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/environment.prod.ts.tpl
  '6106999': `${PROD_HEAD}export const environment: Environment = {
  production: true,
  firebase: {
    projectId: '{{projectId}}',
    apiKey: '{{apiKey}}',
    appId: '{{appId}}',
  },
  // Emulator endpoints are kept on the shape so the Environment interface stays
  // identical across env files (simpler types, no \`emulators?:\`). They're never
  // accessed in production — provideAppFirebase() gates emulator wiring behind
  // \`!environment.production\`, which @angular/build tree-shakes out of the prod
  // bundle.
  emulators: {
    auth:      'http://localhost:9099',
    firestore: { host: 'localhost', port: 8080 },
    storage:   { host: 'localhost', port: 9199 },
    functions: { host: 'localhost', port: 5001 },
  },
};
`,
};

/** The canonical tree: the v3 header, the staging overrides and the prod environment, each overridable by a shape. */
const seed = (tree, { apphosting = stock('apphosting.v3.yaml'), prod = stock('environment.prod.ts') } = {}) => {
  project(tree, 'apps/web');
  tree.write('apphosting.yaml', apphosting);
  tree.write('apphosting.staging.yaml', stock('apphosting.staging.yaml'));
  tree.write('apps/web/src/environments/environment.prod.ts', prod);
};

const FALSE = ['--environment staging', 'GitHub-driven', '`apphosting.yaml` at the workspace root'];

export default {
  name: '0.50.0 · correct-app-hosting-guidance',
  ladder: [RUNG],
  cases: [
    {
      name: 'apphosting.yaml (v3 header) + staging + environment.prod.ts at the root: every false line corrected, config untouched',
      setup: (tree) => seed(tree, { apphosting: stock('apphosting.v3.yaml') }),
      // The rung recognises the blocks by exact text, so every header the templates shipped must land on the same tree.
      // apphosting.staging.yaml shipped one shape only (46d6436 = 8ec2259, the stock fixture); environment.prod.ts's
      // guidance block is the same in all three shipped shapes, but its BODY changed — those shapes end elsewhere.
      historicalShapes: [
        // git show 7b0d3f6:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/apphosting.yaml.tpl
        { name: 'apphosting.yaml v1 header (7b0d3f6)', setup: (tree) => seed(tree, { apphosting: stock('apphosting.v1.yaml') }) },
        // git show 057f16f:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/apphosting.yaml.tpl (unchanged through 8ec2259)
        { name: 'apphosting.yaml v2 header (057f16f)', setup: (tree) => seed(tree, { apphosting: stock('apphosting.v2.yaml') }) },
        ...[
          // git show 6106999:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/environment.prod.ts.tpl
          ['6106999', 'environment.prod.ts with the emulators block (6106999)'],
          // git show 5d61983:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/environment.prod.ts.tpl
          ['5d61983', 'environment.prod.ts before authDomain (5d61983)'],
        ].map(([sha, name]) => ({
          name,
          diverges: "the file's body (emulators block / authDomain) is that release's own, outside the guidance the rung rewrites",
          setup: (tree) => seed(tree, { prod: PROD_SHAPES[sha] }),
          expect: (tree, t) => {
            const path = 'apps/web/src/environments/environment.prod.ts';
            for (const needle of FALSE) t.hasNot(path, needle);
            t.has(path, '--root-dir');
            t.has(path, 'bespunky-house:firebase-app-hosting skill');
          },
        })),
      ],
      expect: (tree, t) => {
        for (const path of ['apphosting.yaml', 'apphosting.staging.yaml', 'apps/web/src/environments/environment.prod.ts']) {
          for (const needle of FALSE) t.hasNot(path, needle);
        }
        t.has('apphosting.yaml', 'WHERE THIS FILE IS READ FROM');
        t.has('apphosting.yaml', '# runConfig:');
        t.has('apphosting.staging.yaml', 'Settings → Environment');
        t.has('apphosting.staging.yaml', 'buildCommand: npx nx build web --configuration=staging');
        t.has('apps/web/src/environments/environment.prod.ts', '--root-dir');
        t.has('apps/web/src/environments/environment.prod.ts', 'export const environment');
      },
    },
    {
      name: 'files the project moved into the app directory are corrected there',
      setup: (tree) => {
        project(tree, 'apps/web');
        tree.write('apps/web/apphosting.yaml', stock('apphosting.v3.yaml'));
        tree.write('apps/web/apphosting.staging.yaml', stock('apphosting.staging.yaml'));
      },
      expect: (tree, t) => {
        t.hasNot('apps/web/apphosting.yaml', 'GitHub-driven');
        t.hasNot('apps/web/apphosting.staging.yaml', '--environment staging');
      },
    },
    {
      name: 'an edited block is not guessed at: left byte-identical (and reported)',
      setup: (tree) => {
        project(tree, 'apps/web');
        tree.write('apphosting.staging.yaml', '# ours: firebase apphosting:backends:create --environment staging\nscripts:\n  buildCommand: x\n');
      },
      expect: (tree, t) =>
        t.ok(tree.read('apphosting.staging.yaml', 'utf8') === '# ours: firebase apphosting:backends:create --environment staging\nscripts:\n  buildCommand: x\n', 'edited file changed'),
    },
    {
      name: 'no App Hosting files: nothing to do',
      setup: (tree) => project(tree, 'apps/web'),
      expect: (tree, t) => t.missing('apphosting.yaml'),
    },
  ],
};
