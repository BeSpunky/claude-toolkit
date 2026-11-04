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
    t.ok(readProjectConfiguration(tree, 'postgres').projectType === undefined, 'no projectType: layout inference must not read postgres/ as the apps directory');
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
      name: 'a project on a Node the launcher cannot load on is refused, naming the file to move',
      once: 'it throws: there is no second state to compare',
      setup: () => {
        const tree = wearingAgent();
        tree.write('.nvmrc', '16\n');
        return tree;
      },
      run: async (tree, ctx) => {
        try {
          await generate(tree, ctx);
        } catch (error) {
          ctx.error = error.message;
        }
      },
      expect: (_t, t, ctx) => {
        t.ok(/needs Node 18 or newer/.test(ctx.error ?? '') && /\.nvmrc/.test(ctx.error ?? ''), `says what to move: ${ctx.error}`);
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
      name: 'evidence is the tag: a project of the repo\'s own at postgres/ does not make this repo wear the layer',
      once: 'asserts detection, with no generator run',
      setup: () => {
        const tree = wearingAgent();
        addProjectConfiguration(tree, 'db', { root: 'postgres', tags: ['tooling'], targets: {} });
        return tree;
      },
      run: () => {},
      expect: (tree, t, ctx) => t.ok(!ctx.load('layers/registry').isPresent(tree, 'postgres'), 'not worn'),
    },
    ...[
      ['a library named postgres elsewhere', (tree) => addProjectConfiguration(tree, 'postgres', { root: 'libs/postgres', targets: {} }), /project "postgres" at libs\/postgres/],
      ['a project of the repo\'s own at postgres/', (tree) => addProjectConfiguration(tree, 'db', { root: 'postgres', targets: {} }), /project "db" at postgres/],
      ['a package at postgres/', (tree) => tree.write('postgres/package.json', '{ "name": "mine" }\n'), /postgres\/package\.json/],
    ].map(([what, plant, says]) => ({
      name: `add-layer postgres over ${what}: refused before anything is written, with the way out`,
      setup: () => {
        const tree = wearingAgent();
        plant(tree);
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
        t.ok(says.test(ctx.error ?? '') && (ctx.error ?? '').includes('type:postgres'), `said: ${ctx.error}`);
        t.ok(!tree.exists('tools/postgres/postgres.mjs') && !tree.exists('.bespunky/postgres.json'), 'nothing written');
      },
    })),
    {
      name: 'a project given the tag is this layer\'s, wherever it lives: the targets join it',
      setup: () => {
        const tree = wearingAgent();
        addProjectConfiguration(tree, 'database', { root: 'libs/database', tags: ['type:postgres'], targets: { own: { command: 'echo' } } });
        return tree;
      },
      run: generate,
      expect: (tree, t, ctx) => {
        const { targets } = readProjectConfiguration(tree, 'database');
        t.ok(Boolean(targets.start) && Boolean(targets.own), 'the verbs joined, its own target stays');
        t.ok(!tree.exists('postgres/project.json'), 'no second project');
        t.ok(ctx.postgresLayer === true, 'the layer detects itself');
        t.equal(ctx.load('layers/registry').layer('postgres').ciDeploy.deployTargets(tree), [{ project: 'database', target: 'deploy' }], 'and CI finds it by the tag');
      },
    },
    {
      name: 'an app only dev.json declares: left as it is, and told the process to add; quiet once it has one',
      once: 'it asserts both runs itself',
      setup: () => {
        const tree = wearingAgent();
        tree.write('.bespunky/dev.json', JSON.stringify({ apps: { api: { processes: [{ id: 'api', cmd: ['uvicorn', 'main:app'], primary: true, ports: { http: 8000 } }] }, done: { processes: [{ id: 'postgres', cmd: ['mine'] }] } } }));
        return tree;
      },
      run: async (tree, ctx) => {
        await generate(tree, ctx);
        ctx.declared = JSON.parse(tree.read('.bespunky/dev.json', 'utf8'));
      },
      expect: (_tree, t, ctx) => {
        const said = ctx.logs.filter((line) => line.includes('declared by hand'));
        t.ok(said.length === 1 && said[0].includes('api is declared by hand') && said[0].includes('"dependency": true') && said[0].includes('DATABASE_URL'), `said: ${said.join(' | ')}`);
        t.equal(ctx.declared.apps.api.processes.map((p) => p.id), ['api'], 'nothing added to it');
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
      name: 'on a wrapper host, a served app is seeded to run Nx by node: ./nx is a script a stop would kill and leave Nx running',
      setup: () => {
        const tree = wearingAgent();
        tree.delete('package.json');
        addProjectConfiguration(tree, 'site', { root: 'apps/site', targets: { serve: { executor: SERVE }, 'dev-server': { executor: 'nx:run-commands', options: { command: 'x', port: 4300 } } } });
        return tree;
      },
      run: generate,
      expect: (tree, t) => {
        const app = JSON.parse(tree.read('.bespunky/dev.json', 'utf8')).apps.site.processes.find((p) => p.id === 'app');
        t.equal(app.cmd.slice(0, 4), ['node', '.nx/nxw.js', 'run', 'site:dev-server'], 'node, the wrapper\'s own program, then the target');
      },
    },
    {
      name: 'on a node host, the same app is seeded to run Nx from node_modules',
      setup: () => {
        const tree = wearingAgent();
        addProjectConfiguration(tree, 'site', { root: 'apps/site', targets: { serve: { executor: SERVE }, 'dev-server': { executor: 'nx:run-commands', options: { command: 'x', port: 4300 } } } });
        return tree;
      },
      run: generate,
      expect: (tree, t) => {
        const app = JSON.parse(tree.read('.bespunky/dev.json', 'utf8')).apps.site.processes.find((p) => p.id === 'app');
        t.equal(app.cmd.slice(0, 3), ['node_modules/.bin/nx', 'run', 'site:dev-server'], 'the installed binary');
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
      name: 'with the ci layer: a line that names no target still deploys it, in the schema stage, with its secret and no id-token',
      setup: () => {
        const tree = wearingAgent({ pm: 'yarn-berry' });
        tree.write('.bespunky/branches.json', JSON.stringify({ schema: 1, projection: { schema: 1, integration: 'development', production: ['main'], productionPatterns: [], chain: ['development', 'main'], protected: ['development', 'main'], protectedPatterns: [], workBase: 'development', summary: 'development → main', deploys: [{ kind: 'line', line: 'main', ci: { environment: 'production', providers: {} } }] } }, null, 2));
        return tree;
      },
      run: async (tree, ctx) => {
        await generate(tree, ctx);
        await ctx.load('generators/ci/generator').default(tree, { layers: ['nx', 'agent', 'postgres', 'ci'] });
      },
      expect: (tree, t) => {
        const workflow = tree.read('.github/workflows/deploy.yml', 'utf8') ?? '';
        t.ok(workflow.includes("POSTGRES_DEPLOY_URL: ${{ needs.resolve.outputs.environment == 'production' && secrets.POSTGRES_DEPLOY_URL_PRODUCTION || '' }}"), `the secret reaches the deploy step, by the environment's own name:\n${workflow}`);
        t.ok(!workflow.includes('secrets.POSTGRES_DEPLOY_URL '), 'nothing a repo-level secret of the plain name could fill in for');
        t.ok(!workflow.includes('secrets['), 'no dynamic index, which would hand the runner every secret');
        t.ok(Boolean(requireFromRepo('yaml').parse(workflow).jobs.deploy), 'and it is YAML');
        t.ok(!workflow.includes('id-token: write'), 'no OIDC: the job cannot mint a token');
        const install = workflow.indexOf('Install dbmate');
        t.ok(install > 0 && install < workflow.indexOf('POSTGRES_DEPLOY_URL: ${{'), 'the stock runner gets dbmate, before the step that needs it');
        t.ok(/sha256sum --check --strict/.test(workflow.slice(install)), 'checked against its pin');
        t.ok(!workflow.slice(0, install).includes('POSTGRES_DEPLOY_URL'), 'and the install holds no secret');
        const { targets } = readProjectConfiguration(tree, 'postgres');
        t.ok(!JSON.stringify(targets.deploy).includes('postgresql://'), 'no URL in project.json');
      },
    },
    {
      name: 'a line deploying it gets a HUMAN_STEP naming the secret and the command, once, and no value on the command line',
      setup: () => {
        const tree = wearingAgent({ pm: 'yarn-berry' });
        tree.write('.bespunky/branches.json', JSON.stringify({ schema: 1, projection: { schema: 1, integration: 'development', production: ['main'], productionPatterns: [], chain: ['development', 'main'], protected: ['development', 'main'], protectedPatterns: [], workBase: 'development', summary: 'development → main', deploys: [{ kind: 'line', line: 'main', ci: { environment: 'production', providers: {} } }] } }, null, 2));
        return tree;
      },
      once: 'its run is already the two runs: it asserts what the second does not say',
      run: async (tree, ctx) => {
        await generate(tree, ctx);
        const ci = ctx.load('generators/ci/generator').default;
        await ci(tree, { layers: ['nx', 'agent', 'postgres', 'ci'] });
        await ci(tree, { layers: ['nx', 'agent', 'postgres', 'ci'] }); // nothing changed, so it must not be said again
      },
      expect: (_tree, t, ctx) => {
        const steps = ctx.logs.filter((line) => line.includes('HUMAN_STEP:') && line.includes('POSTGRES_DEPLOY_URL'));
        t.ok(steps.length === 1, `one step for the one environment: ${ctx.logs.join(' | ')}`);
        t.ok(steps[0]?.includes('gh secret set POSTGRES_DEPLOY_URL_PRODUCTION --env production'), steps[0]);
        t.ok(!/--body|-b /.test(steps[0] ?? ''), 'it prompts: the value is on no command line');
      },
    },
    {
      name: 'the layer as a CI provider: a schema stage, its URL from a secret, no OIDC, its own deploy target',
      setup: () => wearingAgent(),
      run: generate,
      expect: (tree, t, ctx) => {
        const provider = ctx.load('layers/registry').layer('postgres').ciDeploy;
        t.ok(provider.deployStage === 'schema', 'before every code deploy');
        t.equal(provider.deployEnv(['production', 'uat-eu.1']), { POSTGRES_DEPLOY_URL: "${{ needs.resolve.outputs.environment == 'production' && secrets.POSTGRES_DEPLOY_URL_PRODUCTION || needs.resolve.outputs.environment == 'uat-eu.1' && secrets.POSTGRES_DEPLOY_URL_UAT_EU_1 || '' }}" }, 'each environment names its own secret literally');
        t.equal(ctx.load('generators/postgres/ci-provider').postgresDeploySecret('uat-eu.1'), 'POSTGRES_DEPLOY_URL_UAT_EU_1', 'upper case, and only what a secret name holds');
        t.ok(provider.oidc === undefined, 'no OIDC');
        t.equal(provider.deployTargets(tree), [{ project: 'postgres', target: 'deploy' }], 'its deploy target');
        const credentialed = provider.credentialedDeploySignals;
        t.ok(!credentialed.some((signal) => signal.test('dbmate --help')), '`dbmate --help` is not a pipeline');
        for (const command of ['dbmate --url x up', 'docker run amacneil/dbmate:2 up', 'dbmate-linux-amd64 up', 'ghcr.io/amacneil/dbmate:2.37 --url $U up']) {
          t.ok(credentialed.some((signal) => signal.test(command)), `\`${command}\` is one, holding a credential`);
        }
        t.ok(provider.deploySignals.some((signal) => signal.test('node tools/postgres/postgres.mjs deploy')), 'the launcher\'s deploy is one, whatever it holds');
      },
    },
  ],
};
