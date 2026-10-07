// FIREBASE DEPLOYS ARE DECLARED — what `nx affected -t deploy` (by hand, or the `ci` layer) relies on:
//   - every deployable house project has a target named exactly `deploy`: never cached, never beside another task
//     (two deploys must not race one Firebase project), forwarding extra arguments to the Firebase CLI;
//   - the root Firebase files (firebase.json, .firebaserc, root rules) are `{workspaceRoot}/…` inputs of the deploy
//     targets themselves — they belong to no project, so without them `affected` never sees a rules-only change;
//   - Nx owns the functions build: no `predeploy` in firebase.json building it a second time;
//   - `firebase:deploy` ships the rules and indexes firebase.json declares and nothing else, and rules are SEEDED only
//     when the layer is being created — a plain upgrade never puts a placeholder where the console keeps the live
//     rules. A seeded file is marked, and the deploy skips it until a human makes it theirs.
// The last case RUNS the rendered deploy script against a fake Firebase CLI: the behaviour, not just the text.
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, SCOPE } from '../workspaces.mjs';

const { writeJson, readJson, getProjects, updateJson } = requireFromRepo('@nx/devkit');
const generate = (extra = {}) => async (tree, ctx) => {
  await ctx.load('generators/firebase-emulators/generator').default(tree, { workspaceName: SCOPE, ...extra });
};
const MARKER = 'bespunky:house-seed';
const ROOT_INPUTS = ['{workspaceRoot}/firebase.json', '{workspaceRoot}/.firebaserc'];

export default {
  name: 'firebase-emulators · declared deploys',
  cases: [
    {
      name: 'a plain run: deploy targets honour the contract, firebase.json has no predeploy, no rules are seeded',
      setup: () => {
        const tree = workspace();
        updateJson(tree, 'package.json', (json) => ({ ...json, devDependencies: { ...json.devDependencies, '@nx/eslint': '23.1.0' } }));
        return tree;
      },
      run: generate(),
      expect: (tree, t) => {
        const projects = getProjects(tree);
        const functionsDeploy = projects.get('functions')?.targets?.deploy;
        const suiteDeploy = projects.get('firebase')?.targets?.deploy;
        for (const [name, target] of [['functions:deploy', functionsDeploy], ['firebase:deploy', suiteDeploy]]) {
          t.ok(target, `${name} exists`);
          t.equal([target?.cache, target?.parallelism], [false, false], `${name}: never cached, never beside another task`);
          t.ok(ROOT_INPUTS.every((input) => target?.inputs?.includes(input)), `${name}: the root Firebase files are inputs: ${target?.inputs}`);
          t.equal(target?.options?.cwd, '{workspaceRoot}', `${name}: runs from the root`);
        }
        t.equal(functionsDeploy?.dependsOn, ['build', 'lint'], 'functions:deploy: Nx builds and lints what ships');
        t.equal(functionsDeploy?.options?.command, 'firebase deploy --only functions', 'functions:deploy command');
        t.equal(suiteDeploy?.options?.command, 'node tools/firebase-deploy-rules.mjs', 'firebase:deploy command');
        t.ok(suiteDeploy?.inputs?.includes('{workspaceRoot}/firestore.rules'), 'a root firestore.rules is watched before it is declared');
        const firebaseJson = t.json('firebase.json');
        t.ok(!('predeploy' in (firebaseJson?.functions?.[0] ?? {})), `no predeploy: ${JSON.stringify(firebaseJson?.functions)}`);
        t.ok(!('firestore' in firebaseJson) && !('storage' in firebaseJson), 'no rules declared by a plain run');
        for (const file of ['firestore.rules', 'firestore.indexes.json', 'storage.rules']) t.missing(`firebase/${file}`);
        t.has('tools/firebase-deploy-rules.mjs', `const MARKER = '${MARKER}'`);
        t.ok(!/\{\{\s*\w+\s*\}\}/.test(t.read('tools/firebase-deploy-rules.mjs')), 'no leftover {{…}}');
      },
    },
    {
      name: '--seedRules (the layer being ADDED): deny-all, marked rules seeded into firebase/ and declared',
      setup: () => workspace(),
      run: generate({ seedRules: true }),
      expect: (tree, t) => {
        t.equal(
          [t.json('firebase.json')?.firestore, t.json('firebase.json')?.storage],
          [{ rules: 'firebase/firestore.rules', indexes: 'firebase/firestore.indexes.json' }, { rules: 'firebase/storage.rules' }],
          'declared, inside the firebase project',
        );
        for (const file of ['firestore.rules', 'storage.rules']) {
          t.has(`firebase/${file}`, MARKER);
          t.has(`firebase/${file}`, 'allow read, write: if false;');
        }
        t.equal(t.json('firebase/firestore.indexes.json'), { indexes: [], fieldOverrides: [] }, 'empty indexes');
        t.ok(!getProjects(tree).get('firebase')?.targets?.deploy?.inputs?.includes('{workspaceRoot}/firebase/firestore.rules'), 'inside the project: `default` covers them');
      },
    },
    {
      name: '--seedRules never seeds over what the project has: declared rules stay; a loose root file is reported',
      setup: () => {
        const tree = workspace();
        writeJson(tree, 'firebase.json', { firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' } });
        tree.write('firestore.rules', 'rules_version = "2"; // the live rules\n');
        tree.write('storage.rules', 'rules_version = "2"; // copied in, never declared\n');
        return tree;
      },
      run: generate({ seedRules: true }),
      expect: (tree, t, ctx) => {
        const firebaseJson = t.json('firebase.json');
        t.equal(firebaseJson?.firestore, { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, 'the project\'s declaration kept');
        t.ok(!('storage' in firebaseJson), 'no storage seed over a loose storage.rules');
        t.missing('firebase/firestore.rules');
        t.missing('firebase/storage.rules');
        t.has('firestore.rules', 'the live rules');
        t.ok(ctx.logs.some((l) => l.includes('storage.rules') && l.includes('not seeding')), `reported: ${ctx.logs}`);
        t.ok(getProjects(tree).get('firebase')?.targets?.deploy?.inputs?.includes('{workspaceRoot}/firestore.indexes.json'), 'declared root files are inputs');
      },
    },
    {
      name: 'an upgrade from 0.49: predeploy gone, lint joins dependsOn, the project\'s own deploy edits survive',
      setup: () => {
        const tree = workspace();
        updateJson(tree, 'package.json', (json) => ({ ...json, devDependencies: { ...json.devDependencies, '@nx/eslint': '23.1.0' } }));
        writeJson(tree, 'firebase.json', {
          functions: [{ source: 'dist/apps/functions', codebase: 'default', predeploy: ['npx --no-install nx lint functions', 'npx --no-install nx build functions'] }],
          firestore: { rules: 'firestore.rules' },
        });
        tree.write('firestore.rules', 'rules_version = "2";\n');
        writeJson(tree, 'apps/functions/project.json', {
          name: 'functions',
          root: 'apps/functions',
          projectType: 'application',
          tags: ['platform:server'],
          targets: {
            deploy: {
              executor: 'nx:run-commands',
              dependsOn: ['build'],
              inputs: ['{workspaceRoot}/firebase.json', 'firebaseConfig'],
              configurations: { staging: { args: '-P staging' } },
              options: { command: 'firebase deploy --only functions', cwd: '{workspaceRoot}' },
            },
          },
        });
        return tree;
      },
      run: generate(),
      expect: (tree, t, ctx) => {
        t.ok(!('predeploy' in (t.json('firebase.json')?.functions?.[0] ?? {})), 'predeploy gone');
        t.equal(t.json('firebase.json')?.firestore, { rules: 'firestore.rules' }, 'the project\'s rules declaration kept');
        const deploy = t.json('apps/functions/project.json')?.targets?.deploy;
        t.equal(deploy?.dependsOn, ['build', 'lint'], 'dependsOn');
        t.ok(deploy?.inputs?.includes('firebaseConfig'), `the project's own input kept: ${deploy?.inputs}`);
        t.equal(deploy?.configurations, { staging: { args: '-P staging' } }, 'the project\'s configuration kept');
        t.equal(ctx.logs.filter((l) => l.includes('functions:deploy')), [], 'nothing of the project\'s replaced, nothing said');
        t.ok(getProjects(tree).get('firebase')?.targets?.deploy?.inputs?.includes('{workspaceRoot}/firestore.rules'), 'firebase:deploy watches the root rules');
      },
    },
    {
      name: 'the deploy script, run: ships what is declared, skips a seed, explains adoption, refuses a missing file',
      once: 'it runs the rendered script on disk — the generator ran once in setup',
      setup: async (ctx) => {
        const tree = workspace();
        await generate({ seedRules: true })(tree, ctx);
        return tree;
      },
      run: (tree, ctx) => {
        const dir = mkdtempSync(join(tmpdir(), 'bespunky-deploy-rules-'));
        try {
          mkdirSync(join(dir, 'tools'));
          mkdirSync(join(dir, 'firebase'));
          mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
          writeFileSync(join(dir, 'tools/firebase-deploy-rules.mjs'), tree.read('tools/firebase-deploy-rules.mjs', 'utf8'));
          // A fake Firebase CLI on node_modules/.bin — the script must find the project's own first.
          writeFileSync(join(dir, 'node_modules/.bin/firebase'), `#!/bin/sh\necho "FIREBASE $*" > "${join(dir, 'called')}"\n`);
          chmodSync(join(dir, 'node_modules/.bin/firebase'), 0o755);
          const copy = (file) => writeFileSync(join(dir, file), tree.read(file, 'utf8'));
          const deploy = () => {
            rmSync(join(dir, 'called'), { force: true });
            const r = spawnSync(process.execPath, ['tools/firebase-deploy-rules.mjs', '--project=prod', '--non-interactive'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
            let called = null;
            try {
              called = readFileSync(join(dir, 'called'), 'utf8').trim();
            } catch {}
            return { status: r.status, out: r.stdout + r.stderr, called };
          };
          // 1. Nothing declared.
          writeFileSync(join(dir, 'firebase.json'), JSON.stringify({ functions: [] }));
          ctx.none = deploy();
          // 2. The seeds, as written: rules skipped, the (empty) indexes ship.
          for (const file of ['firebase.json', 'firebase/firestore.rules', 'firebase/firestore.indexes.json', 'firebase/storage.rules']) copy(file);
          ctx.seeded = deploy();
          // 3. A human made the rules theirs.
          for (const file of ['firebase/firestore.rules', 'firebase/storage.rules']) {
            writeFileSync(join(dir, file), tree.read(file, 'utf8').split('\n').filter((l) => !l.includes(MARKER)).join('\n'));
          }
          ctx.adopted = deploy();
          // 4. A declared file is missing.
          rmSync(join(dir, 'firebase/storage.rules'));
          ctx.missing = deploy();
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      expect: (tree, t, ctx) => {
        t.equal([ctx.none.status, ctx.none.called], [0, null], `nothing declared: no deploy, success (${ctx.none.out})`);
        t.ok(ctx.none.out.includes('npx firebase init firestore storage -P <alias>'), 'nothing declared: says how to adopt the live rules');
        t.equal(ctx.seeded.called, 'FIREBASE deploy --only firestore:indexes --project=prod --non-interactive', 'seeds: rules skipped, args forwarded');
        t.ok(ctx.seeded.out.includes('SKIPPING firestore:rules') && ctx.seeded.out.includes('SKIPPING storage'), `seeds: said (${ctx.seeded.out})`);
        t.equal(ctx.adopted.called, 'FIREBASE deploy --only firestore:rules,firestore:indexes,storage --project=prod --non-interactive', 'adopted: all three');
        t.equal([ctx.missing.status, ctx.missing.called], [1, null], `a missing declared file: refused before anything ships (${ctx.missing.out})`);
      },
    },
  ],
};
