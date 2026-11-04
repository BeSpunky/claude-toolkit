// THE DEPLOY CONTRACT IS NEUTRAL (_utils/deploy-contract) — a project that is not Firebase's, with schema files as what
// it ships, gets the same promises: never cached, never beside another task, what it requires re-asserted, and
// `nx affected` sees a change to what it watches. The last is asked of the real Nx CLI, not of our reading of it.
// Firebase's use of the seam is covered by cases/firebase-deploy.mjs.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REPO, requireFromRepo, snapshot } from '../../test-support/payload.mjs';
import { workspace } from '../workspaces.mjs';

const { getProjects, updateJson } = requireFromRepo('@nx/devkit');

const CANONICAL_ROOT = 'database';
const SPEC = {
  command: 'node tools/database.mjs deploy',
  inputs: ['default'],
  // One glob outside the project, one file outside it, and one inside it, which `default` already covers.
  watches: ['schema/migrations/**/*', 'schema/config.toml', `${CANONICAL_ROOT}/seed.sql`],
  requires: [{ projects: ['api'], target: 'build' }],
  gates: ['lint'],
};
const ensure = (tree, ctx) => {
  const { deployTarget } = ctx.load('generators/_utils/deploy-contract');
  const { ensureHouseProject, houseProjectHome } = ctx.load('generators/_utils/project-files');
  const home = houseProjectHome(tree, CANONICAL_ROOT, CANONICAL_ROOT);
  const deploy = deployTarget(tree, home.root, SPEC);
  ensureHouseProject(tree, 'a-database-capability', home, {
    projectType: 'application',
    tags: ['platform:server', 'tooling'],
    contract: { deploy: deploy.contract },
    targets: { deploy: deploy.target },
  });
};
const deployOf = (tree) => getProjects(tree).get(CANONICAL_ROOT)?.targets?.deploy;
/**
 * Nx's own answer, per changed file: the tree on disk with a real `nx show projects --affected --files=<file>`.
 * The temporary workspace links the repo's node_modules, so it runs the repo's Nx; the repo itself is not touched.
 */
function affectedBy(tree, files) {
  const root = mkdtempSync(join(tmpdir(), 'deploy-contract-'));
  try {
    for (const [path, text] of Object.entries(JSON.parse(snapshot(tree)))) {
      if (path === 'package-lock.json') continue; // the fixture's is a `{}` stand-in, which Nx's lockfile parser refuses
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text ?? '');
    }
    symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules')); // Nx looks for itself in the workspace
    return Object.fromEntries(
      files.map((file) => {
        const run = spawnSync(join(REPO, 'node_modules/.bin/nx'), ['show', 'projects', '--affected', `--files=${file}`, '--json'], {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, NX_DAEMON: 'false', NX_WORKSPACE_ROOT_PATH: root, CI: 'true' },
        });
        if (run.status !== 0) throw new Error(`nx failed for ${file}: ${run.stderr || run.stdout}`);
        return [file, JSON.parse(run.stdout)];
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export default {
  name: 'deploy contract · a neutral seam',
  cases: [
    {
      name: 'a non-Firebase project: the contract holds, and only files outside its root become root inputs',
      setup: () => workspace(),
      run: ensure,
      expect: (tree, t) => {
        const deploy = deployOf(tree);
        t.equal(deploy.cache, false, 'never cached');
        t.equal(deploy.parallelism, false, 'never beside another task');
        t.equal(deploy.dependsOn, [{ projects: ['api'], target: 'build' }, 'lint'], 'requires, then gates: a cross-project order is expressible');
        t.equal(deploy.inputs, ['default', '{workspaceRoot}/schema/migrations/**/*', '{workspaceRoot}/schema/config.toml'], 'what is inside the root is left to `default`');
        t.equal(deploy.options, { command: 'node tools/database.mjs deploy', cwd: '{workspaceRoot}' }, 'runs from the root');
        t.ok(!tree.exists('firebase.json'), 'nothing of Firebase arrived with it');
      },
    },
    {
      name: 'the real Nx CLI marks the project affected for what it watches, and for nothing else',
      setup: () => workspace(),
      run: ensure,
      expect: (tree, t) => {
        const migration = 'schema/migrations/20261104000000_add.sql';
        const deep = 'schema/migrations/nested/deep.sql';
        const seen = affectedBy(tree, [migration, deep, 'schema/config.toml', 'schema/README.md', `${CANONICAL_ROOT}/seed.sql`]);
        t.equal(seen[migration], [CANONICAL_ROOT], 'a new migration under the glob');
        t.equal(seen[deep], [CANONICAL_ROOT], 'at any depth');
        t.equal(seen['schema/config.toml'], [CANONICAL_ROOT], 'a watched file');
        t.equal(seen['schema/README.md'], [], 'a file nothing watches');
        t.equal(seen[`${CANONICAL_ROOT}/seed.sql`], [CANONICAL_ROOT], 'a file inside the project');
      },
    },
    {
      name: 'a bare directory watches nothing beneath it: why the contract refuses one',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        const { deployTarget } = ctx.load('generators/_utils/deploy-contract');
        const { ensureHouseProject, houseProjectHome } = ctx.load('generators/_utils/project-files');
        const home = houseProjectHome(tree, CANONICAL_ROOT, CANONICAL_ROOT);
        // The input a bare directory would have become, written by hand: deployTarget no longer lets one through.
        const deploy = deployTarget(tree, home.root, { ...SPEC, watches: [] });
        deploy.target.inputs.push('{workspaceRoot}/schema/migrations');
        ensureHouseProject(tree, 'a-database-capability', home, { tags: [], contract: { deploy: deploy.contract }, targets: { deploy: deploy.target } });
      },
      expect: (tree, t) => {
        const file = 'schema/migrations/20261104000000_add.sql';
        t.equal(affectedBy(tree, [file])[file], [], 'the failure is silent, so this case is the proof that it is one');
      },
    },
    {
      name: 'a bare directory in watches is refused where it is declared, naming the glob to write; a file or a glob passes',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        const { deployTarget } = ctx.load('generators/_utils/deploy-contract');
        tree.write('schema/migrations/1_a.sql', '');
        tree.write('Dockerfile', '');
        const refusal = (watch) => {
          try {
            deployTarget(tree, 'database', { ...SPEC, watches: [watch] });
            return null;
          } catch (err) {
            return err.message;
          }
        };
        ctx.refused = Object.fromEntries(['schema/migrations', './schema/migrations', 'schema/migrations/', 'schema', 'not/seeded/yet', '.'].map((w) => [w, refusal(w)]));
        ctx.passed = ['schema/migrations/**/*', 'Dockerfile', 'schema/migrations/1_a.sql', 'firestore.rules', 'not/seeded/yet/**/*', './a/b.toml', '.firebaserc'].map((w) => [w, refusal(w)]);
        ctx.insideOwnRoot = refusal('database/migrations');
      },
      expect: (_tree, t, ctx) => {
        t.ok(ctx.refused['schema/migrations'].includes("'schema/migrations/**/*'"), 'an existing directory: refused, with the glob');
        t.ok(ctx.refused['./schema/migrations'].includes("'schema/migrations/**/*'"), '…however it is spelled');
        t.ok(ctx.refused['schema/migrations/'].includes("'schema/migrations/**/*'"), '…a trailing slash too');
        t.ok(ctx.refused.schema.includes("'schema/**/*'"), '…any depth');
        t.ok(ctx.refused['not/seeded/yet'].includes("'not/seeded/yet/**/*'") && ctx.refused['not/seeded/yet'].includes('seed it'), 'a missing path with no extension: refused, naming both fixes');
        t.ok(ctx.refused['.'].includes("'./**/*'"), 'the workspace root is a directory');
        t.equal(ctx.passed.filter(([, message]) => message), [], 'a file (with or without an extension), a future file and a glob pass');
        t.ok(ctx.insideOwnRoot, "one inside the project's own root is refused too: `default` covers it, but the spelling is still wrong");
      },
    },
    {
      name: 'the contract is re-asserted over the project and reported; a gate it dropped and an input it added stay',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ensure(tree, ctx);
        updateJson(tree, `${CANONICAL_ROOT}/project.json`, (project) => {
          const deploy = project.targets.deploy;
          if (deploy.cache === false && !deploy.inputs.includes('{workspaceRoot}/ours.sql')) {
            project.targets.deploy = {
              ...deploy,
              cache: true,
              dependsOn: [],
              inputs: [...deploy.inputs, '{workspaceRoot}/ours.sql'],
            };
          }
          return project;
        });
        ensure(tree, ctx);
      },
      expect: (tree, t) => {
        const deploy = deployOf(tree);
        t.equal(deploy.cache, false, 'cache came back');
        t.equal(deploy.dependsOn, [{ projects: ['api'], target: 'build' }], 'what it requires came back; the lint gate it dropped did not');
        t.ok(deploy.inputs.includes('{workspaceRoot}/ours.sql'), "the project's own input stayed");
      },
    },
    {
      name: 'a project at the workspace root keeps every watched path; `./` is normalised and duplicates collapse',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        const { watchedInputs } = ctx.load('generators/_utils/deploy-contract');
        ctx.atRoot = watchedInputs('.', ['./a.sql', 'a.sql', 'db/b.sql']);
        ctx.nested = watchedInputs('db', ['db', 'db/b.sql', 'dbx/c.sql']);
      },
      expect: (_tree, t, ctx) => {
        t.equal(ctx.atRoot, ['{workspaceRoot}/a.sql', '{workspaceRoot}/db/b.sql'], 'nothing is inside `.` by path');
        t.equal(ctx.nested, ['{workspaceRoot}/dbx/c.sql'], 'a sibling sharing the prefix is outside');
      },
    },
  ],
};
