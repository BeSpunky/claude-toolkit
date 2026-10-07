// 0.50.0 — the ORDER of the 0.50.0 rungs, proved by running them as ONE ladder, in migrations.json's own order.
//
// ── WHY THE ORDER IS A CONTRACT, AND WHERE IT IS WRITTEN DOWN ──────────────────────────────────────────────────
//
// Every 0.50.0 rung declares the same version, so `nx migrate` orders them by FILE ORDER — and only because
// `executeMigrations` (nx 23.1 dist/src/command-line/migrate/migrate.js) sorts with `lt(a, b) ? -1 : 1`, a comparator
// that is inconsistent for equal versions, which V8's stable TimSort then resolves to input order. That is an engine
// detail, not an Nx contract — so the order is stated here, with its reasons, and this case reads it out of
// migrations.json rather than copying it: reorder the file and this case runs the new order.
//
// The dependencies inside 0.50.0 (a rung that CREATES the input another one reads must run first):
//   - recompose-pre-0.3-serve-leftovers → lint-house-apps. An e76c12a app (`serve` IS the Angular dev-server) becomes
//     a house app — a `dev-stack` composer — only inside recompose, and lint-house-apps lints only house apps. Run
//     after it, the recomposed app was never linted (nor reported): a real ladder runs once. (R9-2.)
//   - recompose → stack-owned-dev-processes → split-serve-follower. Recompose writes the CURRENT shape through the
//     serve generator, which both later rungs already accept (a non-continuous leaf, the composer on `dev-stack`);
//     it sits before them so that every serve rung after it sees one shape. stack-owned keys on the composer being
//     `serve`, so it must run BEFORE split-serve-follower moves the composer to `dev-stack`.
//   - close-the-platform-firewall → lint-house-apps. The firewall tags untagged projects; lint-house-apps then
//     reports every `platform:`-tagged project nothing lints, which needs those tags in place.
// Every other 0.50.0 rung reads only state no other 0.50.0 rung writes (its own file or target), so its position is
// free. refresh-pre-0.39-local-stub reads only .devcontainer/post-create.local.sh, which nothing else in 0.50.0
// touches — it stays where it is.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { addProjectConfiguration, readProjectConfiguration } = createRequire(import.meta.url)('@nx/devkit');

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../plugins/house/engine/nx-tools/migrations.json');
/** The 0.50.0 rungs in migrations.json's order — the order nx migrate runs them in. */
const LADDER_0_50 = Object.entries(JSON.parse(readFileSync(MIGRATIONS, 'utf8')).generators)
  .filter(([, migration]) => migration.version === '0.50.0')
  .map(([, migration]) => migration.implementation.replace(/^\.\/src\/migrations\//, '').replace(/\.js$/, ''));

const EMULATORS = {
  emulators: { continuous: true, executor: 'nx:run-commands', options: { command: 'firebase emulators:start --project=demo-web', cwd: '{workspaceRoot}' } },
};

/** e76c12a (git show e76c12a): the Nx Angular app's own `serve`, continuous, pointed at the app-level suite. */
const e76c12a = (tree) => {
  tree.write('firebase.json', '{ "emulators": { "auth": { "port": 9099 } } }\n');
  addProjectConfiguration(tree, 'old', {
    root: 'apps/old',
    projectType: 'application',
    targets: {
      build: { executor: '@angular/build:application', options: { outputPath: 'dist/apps/old', browser: 'apps/old/src/main.ts' }, configurations: { production: {}, development: {} }, defaultConfiguration: 'production' },
      serve: {
        continuous: true,
        dependsOn: ['emulators'],
        executor: '@angular/build:dev-server',
        configurations: { production: { buildTarget: 'old:build:production' }, development: { buildTarget: 'old:build:development' } },
        defaultConfiguration: 'development',
      },
      ...EMULATORS,
    },
  });
};

export default {
  name: '0.50.0 · the ladder order (cross-rung)',
  cases: [
    {
      name: 'an e76c12a app through 0.24.0 → 0.24.1 → every 0.50.0 rung: recomposed AND reached by lint-house-apps in ONE run',
      ladder: ['0.24.0/unify-serve-targets', '0.24.1/relocate-emulator-targets', ...LADDER_0_50],
      setup: e76c12a,
      expect: (tree, t, lines) => {
        t.ok(LADDER_0_50.length > 1, `migrations.json lists the 0.50.0 rungs: ${LADDER_0_50}`);
        const { targets } = readProjectConfiguration(tree, 'old');
        t.equal(targets['dev-stack']?.executor, '@bespunky/nx-tools:serve', 'recomposed: dev-stack is the composer');
        // @nx/angular is not installed for this harness, so lint-house-apps REPORTS the house app it would lint —
        // the report is the proof it was reached (the add itself runs in tools/test-generators).
        t.ok(
          lines.some((line) => line.includes('lint-house-apps') && line.includes('add-linting --projectName=old')),
          `lint-house-apps reached the recomposed app in the same run: ${lines.filter((line) => line.includes('lint-house-apps'))}`,
        );
      },
    },
  ],
};
