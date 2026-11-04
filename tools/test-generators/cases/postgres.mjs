// THE POSTGRES LAYER'S GENERATOR, in every layout × linking cell: the three classes of output, and what it must leave alone.
//
// The project stays a project.json island whatever the linking, because that file is the layer's evidence: a package.json
// project under TS-solution linking would make the layer invisible to every later upgrade, silently.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, requireFromRepo } from '../../test-support/payload.mjs';
import { MATRIX, workspace } from '../workspaces.mjs';

const { addProjectConfiguration, readProjectConfiguration } = requireFromRepo('@nx/devkit');

const SERVE = '@bespunky/nx-tools:serve';
const VERBS = ['start', 'migrate', 'new-migration', 'seed', 'reset', 'psql', 'deploy'];
const LAUNCHER = ['postgres.mjs', 'layout.mjs', 'tools.mjs', 'url.mjs', 'stack.mjs', 'schema.mjs', 'server.mjs'];

const wearingAgent = (options) => {
  const tree = workspace(options);
  tree.write('.vscode/.window-identity.json', '{}\n'); // the agent layer's evidence
  return tree;
};
const generate = async (tree, ctx) => {
  await ctx.load('generators/postgres/generator').default(tree);
  ctx.postgresLayer = ctx.load('layers/registry').isPresent(tree, 'postgres');
  ctx.webLayer = ctx.load('layers/registry').isPresent(tree, 'web');
};

const inEveryCell = MATRIX.map(({ layout, link, label }) => ({
  name: `${label}: launcher, targets, seeds; a project.json island, and the layer detects itself`,
  setup: () => wearingAgent({ layout, link }),
  run: generate,
  expect: (tree, t, ctx) => {
    for (const file of LAUNCHER) t.ok(tree.exists(`tools/postgres/${file}`), `tools/postgres/${file}`);
    t.ok(tree.exists('postgres/project.json') && !tree.exists('postgres/package.json'), 'a project.json island');
    t.ok(ctx.postgresLayer === true, 'the evidence is there');
    t.ok(ctx.webLayer === false, 'the project does not start wearing web');
    t.ok(!tree.exists('.bespunky/dev.json'), 'nothing served: no declaration');
    const { targets } = readProjectConfiguration(tree, 'postgres');
    t.equal(Object.keys(targets).sort(), [...VERBS].sort(), 'the seven verbs');
    for (const verb of VERBS) t.ok(targets[verb].cache === false, `${verb} is never cached`);
    t.ok(targets.start.options.command === 'node tools/postgres/postgres.mjs start', 'start runs the launcher');
    t.ok(targets.deploy.parallelism === false, 'deploy holds the contract');
    t.equal(JSON.parse(tree.read('.bespunky/postgres.json', 'utf8')), { major: 18 }, 'the major is seeded');
    t.ok(tree.exists('postgres/migrations/.gitkeep') && tree.exists('postgres/seed/world/.gitkeep'), 'the folders are seeded');
  },
}));

export default {
  name: 'postgres · the layer\'s generator',
  cases: [
    ...inEveryCell,
    {
      name: 'needs the agent layer',
      once: 'it throws: there is no second state to compare',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        try {
          await generate(tree, ctx);
        } catch (error) {
          ctx.error = error.message;
        }
      },
      expect: (_tree, t, ctx) => t.ok(/agent/.test(ctx.error ?? ''), `refused: ${ctx.error}`),
    },
    {
      name: 'class C stays the project\'s: a moved major, a removed .gitkeep, and migrations are all left alone',
      setup: () => {
        const tree = wearingAgent();
        tree.write('.bespunky/postgres.json', '{ "major": 17 }\n');
        tree.write('postgres/migrations/20260101000000_mine.sql', '-- migrate:up\n');
        return tree;
      },
      run: generate,
      expect: (tree, t, ctx) => {
        t.equal(JSON.parse(tree.read('.bespunky/postgres.json', 'utf8')), { major: 17 }, 'the major stays');
        t.ok(!tree.exists('postgres/migrations/.gitkeep'), 'nothing seeded over a project that has its declaration');
        t.ok(tree.read('postgres/migrations/20260101000000_mine.sql', 'utf8') === '-- migrate:up\n', 'the migration stays');
        const fragment = ctx.load('layers/registry').layer('postgres').devcontainer(tree);
        t.ok(fragment.archives[0].bin === 'usr/lib/postgresql/17/bin', 'the image follows the declared major');
        t.ok(Boolean(fragment.archives[0].closures.trixie), 'the closure is the major\'s');
      },
    },
    {
      name: 'a major this toolkit has no packages for is refused, naming what it has',
      once: 'it throws: there is no second state to compare',
      setup: () => {
        const tree = wearingAgent();
        tree.write('.bespunky/postgres.json', '{ "major": 12 }\n');
        return tree;
      },
      run: async (tree, ctx) => {
        try {
          await generate(tree, ctx);
        } catch (error) {
          ctx.error = error.message;
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(/12/.test(ctx.error ?? '') && /18/.test(ctx.error ?? ''), `refused: ${ctx.error}`);
        t.ok(!tree.exists('tools/postgres/postgres.mjs'), 'before anything was written');
      },
    },
    {
      name: 'class B: what the project added to a target survives; what the house owns is re-asserted',
      setup: () => wearingAgent(),
      run: async (tree, ctx) => {
        await generate(tree, ctx);
        const path = 'postgres/project.json';
        const project = JSON.parse(tree.read(path, 'utf8'));
        project.targets.seed.dependsOn = ['mine'];
        project.targets.mine = { command: 'echo mine' };
        tree.write(path, JSON.stringify(project));
        tree.write('tools/postgres/layout.mjs', '// hand-edited\n');
        await generate(tree, ctx);
      },
      expect: (tree, t) => {
        const { targets } = readProjectConfiguration(tree, 'postgres');
        t.equal(targets.seed.dependsOn, ['mine'], 'the addition inside a house target stays');
        t.ok(Boolean(targets.mine), 'its own target stays');
        t.ok(tree.read('tools/postgres/layout.mjs', 'utf8').includes('export const ROOT'), 'the launcher is re-asserted');
      },
    },
    {
      name: 'a served app gets the server as a dependency: first, exporting both URLs, the app still primary',
      setup: () => {
        const tree = wearingAgent();
        addProjectConfiguration(tree, 'site', { root: 'apps/site', targets: { serve: { executor: SERVE }, 'dev-server': { executor: 'nx:run-commands', options: { command: 'x', port: 4300 } } } });
        return tree;
      },
      run: generate,
      expect: (tree, t) => {
        const { processes } = JSON.parse(tree.read('.bespunky/dev.json', 'utf8')).apps.site;
        const server = processes.find((p) => p.id === 'postgres');
        t.ok(server?.dependency === true && !server.primary, 'a dependency');
        t.ok(processes.find((p) => p.id === 'app')?.primary === true, 'the app stays the primary');
        t.ok(server.ready.cmd.includes('${STACK_DIR}/postgres.ready'), 'ready is the launcher\'s marker, not a port');
        t.equal(Object.keys(server.exports).sort(), ['DATABASE_URL', 'DIRECT_DATABASE_URL'], 'runtime and direct');
        t.ok(server.exports.DATABASE_URL.includes('${PORT:postgres}'), 'at the stack\'s port');
      },
    },
    {
      name: 'the launcher and the fragment agree on the port, the marker and the process\'s command',
      once: 'reads templates; nothing is generated',
      setup: () => wearingAgent(),
      run: () => {},
      expect: (_tree, t, ctx) => {
        const { POSTGRES_BASE_PORT, POSTGRES_READY_MARKER, POSTGRES_PORT_NAME } = ctx.load('generators/postgres/dev-fragment');
        const layout = readFileSync(join(REPO, 'plugins/house/engine/nx-tools/src/generators/postgres/files/layout.mjs.tpl'), 'utf8');
        t.ok(layout.includes(`BASE_PORT = ${POSTGRES_BASE_PORT};`), 'one base port');
        t.ok(layout.includes(`READY_MARKER = '${POSTGRES_READY_MARKER}'`), 'one marker');
        t.ok(layout.includes(`PORT_NAME = '${POSTGRES_PORT_NAME}'`), 'one port name');
      },
    },
    {
      name: 'the firewall comes with the layer where a root ESLint config can carry it; where none can, that is said',
      setup: () => {
        const tree = wearingAgent();
        tree.write('eslint.config.mjs', "import nx from '@nx/eslint-plugin';\n\nexport default [\n  ...nx.configs['flat/base'],\n  {\n    files: ['**/*.ts'],\n    rules: {\n      '@nx/enforce-module-boundaries': ['error', { depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }] }],\n    },\n  },\n];\n");
        return tree;
      },
      run: generate,
      expect: (tree, t) => t.ok(/'pg'|"pg"/.test(tree.read('eslint.config.mjs', 'utf8')), '`pg` is banned from browser code'),
    },
    {
      name: 'no root ESLint config: no firewall, and the log says what that leaves open',
      setup: () => wearingAgent(),
      run: generate,
      expect: (_tree, t, ctx) => t.ok(ctx.logs.join('\n').includes('No platform firewall here'), `said: ${ctx.logs.join(' | ')}`),
    },
    {
      name: 'the layer as a CI provider: a schema stage, its URL from a secret, no OIDC, its own deploy target',
      setup: () => wearingAgent(),
      run: generate,
      expect: (tree, t, ctx) => {
        const provider = ctx.load('layers/registry').layer('postgres').ciDeploy;
        t.ok(provider.deployStage === 'schema', 'before every code deploy');
        t.equal(provider.deployEnv, { POSTGRES_DEPLOY_URL: '${{ secrets.POSTGRES_DEPLOY_URL }}' }, 'the URL from a secret');
        t.ok(provider.oidc === undefined, 'no OIDC');
        t.equal(provider.deployTargets(tree), [{ project: 'postgres', target: 'deploy' }], 'its deploy target');
        t.ok(provider.deploySignals.some((signal) => signal.test('dbmate --url x up')), 'a foreign `dbmate up` is a pipeline');
        t.ok(!provider.deploySignals.some((signal) => signal.test('dbmate --help')), '`dbmate --help` is not');
      },
    },
  ],
};
