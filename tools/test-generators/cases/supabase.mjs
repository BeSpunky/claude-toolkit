// THE SUPABASE LAYER'S GENERATOR: a provider on the postgres core, the folder move on the run that chooses it, config.toml's owned
// keys by line, and what must stay the project's. The real CLI is tools/test-supabase.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, requireFromRepo } from '../../test-support/payload.mjs';
import { MATRIX, workspace } from '../workspaces.mjs';

const { addProjectConfiguration, readProjectConfiguration } = requireFromRepo('@nx/devkit');

const SERVE = '@bespunky/nx-tools:serve';
const GENERATORS = join(REPO, 'plugins/house/engine/nx-tools/src/generators');

const wearingAgent = (options) => {
  const tree = workspace(options);
  tree.write('.vscode/.window-identity.json', '{}\n');
  return tree;
};

/** What a run ensuring both does: the plan passes the postgres step the provider, because the tree does not show it yet. */
const ensureBoth = async (tree, ctx) => {
  await ctx.load('generators/postgres/generator').default(tree, { provider: 'supabase' });
  await ctx.load('generators/supabase/generator').default(tree);
};
/** What `add-layer supabase` does to a project already wearing postgres. */
const addToPostgres = ensureBoth;
/** Once: the harness runs a case twice, and the second run must find the project as the first left it. */
const nativeFirst = async (tree, ctx) => {
  if (tree.exists('tools/postgres/provider.mjs')) return false;
  await ctx.load('generators/postgres/generator').default(tree);
  tree.write('.bespunky/postgres.json', '{ "major": 17 }\n');
  return true;
};

const refused = async (tree, ctx, run) => {
  try {
    await run(tree, ctx);
  } catch (error) {
    ctx.error = error.message;
  }
};

const inEveryCell = MATRIX.map(({ layout, link, label }) => ({
  name: `${label}: a fresh project on Supabase: tag, provider, seeds, and nothing of the native provider's`,
  setup: () => wearingAgent({ layout, link }),
  run: ensureBoth,
  expect: (tree, t, ctx) => {
    const { isPresent } = ctx.load('layers/registry');
    t.ok(isPresent(tree, 'supabase') && isPresent(tree, 'postgres'), 'both layers read as worn');
    t.ok(!isPresent(tree, 'web'), 'the project does not start wearing web');
    t.ok(tree.read('tools/postgres/provider.mjs', 'utf8').includes('supabase-provider.mjs'), 'the launcher runs on the Supabase provider');
    for (const file of ['supabase-cli.mjs', 'supabase-keeper.mjs', 'supabase-provider.mjs', 'supabase-reset.mjs']) t.ok(tree.exists(`tools/postgres/${file}`), file);
    const cli = tree.read('tools/postgres/supabase-cli.mjs', 'utf8');
    t.ok(cli.includes(`PINNED_VERSION = '${ctx.load('generators/_utils/versions').SUPABASE_CLI_VERSION}'`) && !cli.includes('{{'), 'the launcher knows the pin');
    t.ok(!tree.exists('.bespunky/postgres.json'), 'no major of its own: config.toml says');
    t.ok(!tree.exists('postgres/migrations'), 'one migrations folder');
    t.ok(!tree.exists('supabase/migrations/.gitkeep'), 'no keep file: the CLI says it skipped one, at every start, and it needs no folder');
    t.ok(tree.exists('postgres/seed/world/.gitkeep'), 'the seeds\' folder is seeded');
    const config = tree.read('supabase/config.toml', 'utf8');
    t.ok(/^stack = true$/m.test(config) && /^sql_paths = \["\.\.\/postgres\/seed\/world\/\*\.sql"\]$/m.test(config) && !config.includes('{{PROJECT_ID'), 'the seeded config');
    t.ok(tree.exists('supabase/supabase.lock') && tree.exists('supabase/.gitignore'), 'the lock and the ignore file');
    const { targets } = readProjectConfiguration(tree, 'postgres');
    t.equal(Object.keys(targets).sort(), ['deploy', 'migrate', 'new-migration', 'psql', 'reset', 'seed', 'start'], 'the same seven verbs');
    t.ok(JSON.stringify(targets.deploy.inputs).includes('supabase/migrations/**/*') && !JSON.stringify(targets.deploy.inputs).includes('postgres/migrations'), `deploy watches the folder: ${JSON.stringify(targets.deploy.inputs)}`);
  },
}));

const served = (tree, name = 'site') => addProjectConfiguration(tree, name, { root: `apps/${name}`, projectType: 'application', targets: { serve: { executor: SERVE }, 'dev-server': { executor: 'nx:run-commands', options: { command: 'x', port: 4200 } } } });

export default {
  name: 'supabase · the layer\'s generator',
  cases: [
    ...inEveryCell,
    {
      name: 'a later plain upgrade keeps the provider: the postgres step alone, on a tree wearing the tag, does not put native back',
      setup: () => wearingAgent(),
      run: async (tree, ctx) => {
        await ensureBoth(tree, ctx);
        await ctx.load('generators/postgres/generator').default(tree);
      },
      expect: (tree, t) => {
        t.ok(tree.read('tools/postgres/provider.mjs', 'utf8').includes('supabase-provider.mjs'), 'still Supabase');
        t.ok(!tree.exists('.bespunky/postgres.json') && !tree.exists('postgres/migrations'), 'no native state came back');
      },
    },
    {
      name: 'the folder moves, whole, with every reference; the old major is cleared; the human step is reported',
      setup: () => wearingAgent(),
      run: async (tree, ctx) => {
        if (!(await nativeFirst(tree, ctx))) return addToPostgres(tree, ctx);
        tree.write('postgres/migrations/20260101000000_first.sql', '-- migrate:up\ncreate table t(v text);\n\n-- migrate:down\n');
        tree.write('postgres/migrations/README.txt', 'notes\n');
        tree.write('README.md', 'Migrations live in postgres/migrations.\n');
        tree.write('.github/workflows/mine.yml', 'on:\n  push:\n    paths: [postgres/migrations/**]\n');
        tree.write('docs/features/2026-01-01-x/DECISION.md', 'we kept postgres/migrations\n');
        await addToPostgres(tree, ctx);
      },
      expect: (tree, t, ctx) => {
        t.ok(tree.exists('supabase/migrations/20260101000000_first.sql') && tree.exists('supabase/migrations/README.txt'), 'moved');
        t.ok(!tree.exists('postgres/migrations'), 'never two');
                t.ok(tree.read('README.md', 'utf8').includes('supabase/migrations') && !tree.read('README.md', 'utf8').includes('postgres/migrations'), 'a README is retargeted');
        t.ok(tree.read('.github/workflows/mine.yml', 'utf8').includes('supabase/migrations/**'), 'a workflow\'s paths are retargeted');
        t.ok(tree.read('docs/features/2026-01-01-x/DECISION.md', 'utf8').includes('postgres/migrations'), 'a past record is not rewritten');
        t.ok(tree.read('tools/postgres/layout.mjs', 'utf8').includes('postgres/migrations'), 'the owned launcher is not a reference to rewrite');
        t.ok(!tree.exists('.bespunky/postgres.json'), 'the major is config.toml\'s now: two would disagree');
        const logs = ctx.logs.join('\n');
        t.ok(/HUMAN_STEP: .*migration repair --status applied 20260101000000 --remote=/.test(logs), `the ledger step is reported: ${logs.slice(0, 400)}`);
        t.ok(/README\.md/.test(logs) && /mine\.yml/.test(logs), 'each rewritten file is named');
        t.ok(/bespunky\/postgres, unused/.test(logs), 'the local data left behind is named');
      },
    },
    {
      name: 'a project declaring 18 is refused before anything is written, with the fix',
      once: 'it throws: there is no second state to compare',
      setup: async () => wearingAgent(),
      run: async (tree, ctx) => {
        await ctx.load('generators/postgres/generator').default(tree);
        ctx.before = tree.exists('supabase/config.toml');
        await refused(tree, ctx, (t, c) => c.load('generators/supabase/generator').default(t));
      },
      expect: (tree, t, ctx) => {
        t.ok(/declares Postgres 18/.test(ctx.error ?? '') && /"major": 17/.test(ctx.error ?? ''), `refused, with the fix: ${ctx.error}`);
        t.ok(!tree.exists('supabase/config.toml') && !tree.exists('tools/postgres/supabase-cli.mjs'), 'nothing written');
        t.ok(tree.read('tools/postgres/provider.mjs', 'utf8').includes('native.mjs'), 'still native');
      },
    },
    ...[
      ['the same migration in both folders', (tree) => { tree.write('postgres/migrations/1_a.sql', 'x'); tree.write('supabase/migrations/1_a.sql', 'y'); }, /1_a\.sql exist in both/],
      ['a config on a major the stack does not run', (tree) => tree.write('supabase/config.toml', '[db]\nmajor_version = 16\n'), /major_version = 16/],
      ['a v2 config the pinned CLI cannot load', (tree) => tree.write('supabase/config.toml', '[inbucket]\nenabled = true\n'), /\[inbucket\]/],
    ].map(([what, plant, says]) => ({
      name: `refused before anything is written: ${what}`,
      once: 'it throws: there is no second state to compare',
      setup: () => wearingAgent(),
      run: async (tree, ctx) => {
        await nativeFirst(tree, ctx);
        plant(tree);
        await refused(tree, ctx, (t, c) => c.load('generators/supabase/generator').default(t));
      },
      expect: (tree, t, ctx) => {
        t.ok(says.test(ctx.error ?? ''), `refused: ${ctx.error}`);
        t.ok(!tree.exists('tools/postgres/supabase-cli.mjs'), 'nothing written');
      },
    })),
    {
      name: 'a config.toml that exists is the project\'s: only the owned key moves, by line, comments and all',
      setup: () => {
        const tree = wearingAgent();
        tree.write('supabase/config.toml', '# mine\nproject_id = "theirs"\n\n[db]\n# my port\nport = 55000 # keep\nmajor_version = 17\n\n[db.seed]\nenabled = true\nsql_paths = ["./seeds/*.sql"]\n\n[experimental]\n# stack = false\nother = 1\n');
        return tree;
      },
      run: ensureBoth,
      expect: (tree, t, ctx) => {
        const text = tree.read('supabase/config.toml', 'utf8');
        t.ok(text.includes('# mine\nproject_id = "theirs"\n\n[db]\n# my port\nport = 55000 # keep\nmajor_version = 17\n'), 'the rest, byte for byte');
        t.ok(text.includes('[experimental]\nstack = true\n# stack = false\nother = 1\n'), `the owned key: ${text}`);
        t.ok(text.includes('sql_paths = ["./seeds/*.sql"]'), 'a project\'s seeds stay');
        t.ok(ctx.logs.join('\n').includes('./seeds/*.sql'), 'and it is said that a reset runs those');
      },
    },
    {
      name: 'init\'s default seed path moves only if the file it names is not there',
      setup: () => {
        const tree = wearingAgent();
        tree.write('supabase/config.toml', '[db.seed]\nsql_paths = ["./seed.sql"]\n');
        tree.write('supabase/seed.sql', 'select 1;\n');
        return tree;
      },
      run: ensureBoth,
      expect: (tree, t) => t.ok(tree.read('supabase/config.toml', 'utf8').includes('sql_paths = ["./seed.sql"]'), 'it stays'),
    },
    {
      name: 'a served app: its process declares every port, keeps what the project set, and only the native URL is replaced',
      setup: () => {
        const tree = wearingAgent();
        served(tree);
        return tree;
      },
      run: async (tree, ctx) => {
        if (!(await nativeFirst(tree, ctx))) return addToPostgres(tree, ctx);
        const declaration = JSON.parse(tree.read('.bespunky/dev.json', 'utf8'));
        const process = declaration.apps.site.processes.find((p) => p.id === 'postgres');
        process.exports.MINE = 'kept';
        process.exports.DIRECT_DATABASE_URL = 'postgresql://custom';
        tree.write('.bespunky/dev.json', JSON.stringify(declaration));
        await addToPostgres(tree, ctx);
      },
      expect: (tree, t, ctx) => {
        const process = JSON.parse(tree.read('.bespunky/dev.json', 'utf8')).apps.site.processes.find((p) => p.id === 'postgres');
        t.equal(process.ports, ctx.load('generators/supabase/dev-fragment').SUPABASE_PORTS, 'every pinned port');
        t.equal(process.avoidPorts, ['10000-32767'], 'and the range the CLI allocates from');
        t.ok(process.exports.DATABASE_URL.endsWith('/postgres?sslmode=disable'), `the stack's database: ${process.exports.DATABASE_URL}`);
        t.ok(process.exports.DIRECT_DATABASE_URL === 'postgresql://custom' && process.exports.MINE === 'kept', 'the project\'s own stay');
        t.ok(process.exports.SUPABASE_URL.includes('${PORT:supabase-api}'), 'the API');
        t.ok(process.ready.timeout === 600, 'a first start downloads');
      },
    },
    {
      name: 'an app served after the layer is worn gets the stack\'s process from the start',
      setup: () => {
        const tree = wearingAgent();
        served(tree);
        return tree;
      },
      run: ensureBoth,
      expect: (tree, t) => {
        const process = JSON.parse(tree.read('.bespunky/dev.json', 'utf8')).apps.site.processes.find((p) => p.id === 'postgres');
        t.ok(process.ports['supabase-api'] === 5435 && process.dependency === true, JSON.stringify(process));
      },
    },
    {
      name: 'the ports the launcher pins are the ports the fragment declares',
      once: 'compares two sources',
      setup: () => workspace(),
      run: () => {},
      expect: (_tree, t, ctx) => {
        const launcher = readFileSync(join(GENERATORS, 'supabase/files/supabase-cli.mjs.tpl'), 'utf8');
        for (const [name, port] of Object.entries(ctx.load('generators/supabase/dev-fragment').SUPABASE_PORTS)) {
          t.ok(new RegExp(`'?${name}'?: \\[${port}, 'SUPABASE_`).test(launcher), `${name}=${port} in the launcher`);
        }
        t.ok(launcher.includes(`ALLOCATES_FROM = '${ctx.load('generators/supabase/dev-fragment').SUPABASE_ALLOCATES_FROM}'`), 'the range');
        const { portBlock } = { portBlock: (ports) => Math.max(...ports) - Math.min(...ports) };
        t.ok(portBlock(Object.values(ctx.load('generators/supabase/dev-fragment').SUPABASE_PORTS)) < 1000, 'one small block, so a stack can shift');
      },
    },
    {
      name: 'config.toml\'s lines: replaced in place, inserted, a new section, an array over lines, CRLF, a commented key is no key',
      once: 'pure functions',
      setup: () => workspace(),
      run: () => {},
      expect: (_tree, t, ctx) => {
        const { hasTomlSection, setTomlValue, tomlValue } = ctx.load('generators/supabase/toml-lines');
        t.ok(setTomlValue('[a]\nk = 1 # why\nj = 2\n', 'a', 'k', '3') === '[a]\nk = 3 # why\nj = 2\n', 'in place, its comment kept');
        t.ok(setTomlValue('[a]\n# k = 1\n', 'a', 'k', '3') === '[a]\nk = 3\n# k = 1\n', 'a comment is not an assignment');
        t.ok(setTomlValue('[a]\nj = 2\n[b]\nk = 1\n', 'a', 'k', '3') === '[a]\nk = 3\nj = 2\n[b]\nk = 1\n', 'never another section\'s');
        t.ok(setTomlValue('[a]\nj = 2\n', 'c', 'k', '3') === '[a]\nj = 2\n\n[c]\nk = 3\n', 'a new section at the end');
        t.ok(setTomlValue('[a.b]\nk = 1\n', 'a', 'k', '3') === '[a.b]\nk = 1\n\n[a]\nk = 3\n', 'a sub-section is another section');
        t.ok(setTomlValue('[a]\nk = [\n "x", # one\n "y]",\n]\nj = 2\n', 'a', 'k', '["z"]') === '[a]\nk = ["z"]\nj = 2\n', 'an array over lines goes whole');
        t.ok(setTomlValue('[a]\r\nk = 1\r\n', 'a', 'k', '3') === '[a]\r\nk = 3\r\n', 'CRLF stays');
        t.ok(tomlValue('[a]\nk = "x#y" # z\n', 'a', 'k') === '"x#y"', 'a value without its comment, a # in a string kept');
        t.ok(tomlValue('[a]\nk = 1\n', 'b', 'k') === undefined && tomlValue('[a]\n', 'a', 'k') === undefined, 'absent');
        t.ok(hasTomlSection('[[a]]\n', 'a') && !hasTomlSection('# [a]\n', 'a'), 'sections');
      },
    },
    {
      name: 'the image: with Supabase, no Debian server and no dbmate; the CLI by exact pin, a literal SUPABASE_HOME, no mount',
      once: 'reads descriptors',
      setup: () => workspace(),
      run: () => {},
      expect: (tree, t, ctx) => {
        const { layer } = ctx.load('layers/registry');
        const postgres = layer('postgres').devcontainer(tree, new Set(['postgres', 'supabase']));
        t.ok(!postgres.archives?.length, 'the postgres layer brings no server');
        t.ok(postgres.osPackages.flatMap((p) => p.packages).includes('postgresql-client'), 'a client stays');
        t.ok(layer('postgres').devcontainer(tree, new Set(['postgres'])).archives.length === 2, 'native keeps both');
        const fragment = layer('supabase').devcontainer;
        const [archive] = fragment.archives;
        t.ok(/^\d+\.\d+\.\d+$/.test(archive.version) && /^[0-9a-f]{64}$/.test(archive.downloads.amd64.sha256) && /^[0-9a-f]{64}$/.test(archive.downloads.arm64.sha256), 'exact, and checked');
        const home = fragment.containerEnv.find((e) => e.name === 'SUPABASE_HOME');
        t.ok(home.value === '{{home}}/.local/share/supabase', `literal, on the persisted volume: ${home.value}`);
        t.ok(fragment.containerEnv.some((e) => e.name === 'SUPABASE_NO_KEYRING' && e.value === '1'), 'no keyring');
        t.ok(!fragment.mounts?.length, 'no mount');
        t.ok(!layer('supabase').claudePlugins?.length, 'the official plugin\'s MCP is hosted, unscoped and writes: not enabled by this layer');
      },
    },
    {
      name: 'the real workflow: the pinned CLI installed and checked, dbmate gone, a secret per environment, no OIDC, and the line needs no target',
      setup: () => {
        const tree = workspace({ pm: 'yarn-berry' });
        tree.write('.nvmrc', '22\n');
        tree.write('.vscode/.window-identity.json', '{}\n');
        tree.write('.bespunky/branches.json', JSON.stringify({ schema: 1, projection: { schema: 1, integration: 'development', production: ['main'], productionPatterns: [], chain: ['development', 'main'], protected: ['development', 'main'], protectedPatterns: [], workBase: 'development', summary: 'development → main', deploys: [{ kind: 'line', line: 'main', ci: { environment: 'production', providers: {} } }] } }));
        return tree;
      },
      run: async (tree, ctx) => {
        await ensureBoth(tree, ctx);
        await ctx.load('generators/ci/generator').default(tree, { layers: ['nx', 'agent', 'node', 'postgres', 'supabase', 'ci'] });
      },
      expect: (tree, t, ctx) => {
        const workflow = tree.read('.github/workflows/deploy.yml', 'utf8');
        const { SUPABASE_CLI_DOWNLOADS, SUPABASE_CLI_VERSION } = ctx.load('generators/_utils/versions');
        t.ok(workflow.includes(`Install the Supabase CLI ${SUPABASE_CLI_VERSION}`) && workflow.includes(SUPABASE_CLI_DOWNLOADS.amd64.sha256), 'the CLI, checked');
        t.ok(!workflow.includes('dbmate'), 'the replaced provider\'s setup is gone');
        t.ok(workflow.includes('secrets.POSTGRES_DEPLOY_URL_PRODUCTION') && !workflow.includes('secrets['), 'the secret by its literal name');
        t.ok(!/^\s*id-token: write/m.test(workflow), 'no OIDC');
        t.ok(!/::error::/.test(workflow) || !/no target/i.test(workflow), 'the line is not blocked');
        t.ok(ctx.logs.join('\n').includes('gh secret set POSTGRES_DEPLOY_URL_PRODUCTION') && ctx.logs.join('\n').includes('SESSION pooler'), `the human step: ${ctx.logs.join(' ').slice(0, 300)}`);
      },
    },
    {
      name: 'the layer as a CI provider: supersedes postgres\'s, a secret per environment by literal name, setup pinned and checked',
      once: 'reads a descriptor',
      setup: () => {
        const tree = wearingAgent();
        return tree;
      },
      run: ensureBoth,
      expect: (tree, t, ctx) => {
        const { layer } = ctx.load('layers/registry');
        const provider = layer('supabase').ciDeploy;
        t.ok(provider.supersedes === 'postgres' && provider.deployStage === 'schema' && provider.oidc === undefined, 'the shape');
        const env = JSON.stringify(provider.deployEnv(['production', 'uat-eu.1']));
        t.ok(env.includes('secrets.POSTGRES_DEPLOY_URL_PRODUCTION') && env.includes('secrets.POSTGRES_DEPLOY_URL_UAT_EU_1') && !env.includes('secrets['), `literal: ${env}`);
        const steps = provider.setupSteps();
        const { SUPABASE_CLI_DOWNLOADS } = ctx.load('generators/_utils/versions');
        t.ok(steps.includes(SUPABASE_CLI_DOWNLOADS.amd64.url) && steps.includes(SUPABASE_CLI_DOWNLOADS.amd64.sha256) && steps.includes('sha256sum --check --strict'), 'pinned and checked');
        t.equal(provider.deployTargets(tree), [{ project: 'postgres', target: 'deploy' }], 'the same target');
        const counts = (command) => provider.deploySignals.some((signal) => signal.test(command));
        t.ok(counts('supabase db push --remote --yes') && counts('npx supabase functions deploy --remote=x'), 'a hosted deploy reads as one');
        t.ok(!counts('supabase db push') && !counts('echo hello'), 'a local push does not');
      },
    },
  ],
};
