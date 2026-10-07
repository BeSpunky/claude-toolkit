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

const FALSE = ['--environment staging', 'GitHub-driven', '`apphosting.yaml` at the workspace root'];

export default {
  name: '0.50.0 · correct-app-hosting-guidance',
  ladder: [RUNG],
  cases: [
    ...['v1', 'v2', 'v3'].map((v) => ({
      name: `apphosting.yaml (${v} header) + staging + environment.prod.ts at the root: every false line corrected, config untouched`,
      setup: (tree) => {
        project(tree, 'apps/web');
        tree.write('apphosting.yaml', stock(`apphosting.${v}.yaml`));
        tree.write('apphosting.staging.yaml', stock('apphosting.staging.yaml'));
        tree.write('apps/web/src/environments/environment.prod.ts', stock('environment.prod.ts'));
      },
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
    })),
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
