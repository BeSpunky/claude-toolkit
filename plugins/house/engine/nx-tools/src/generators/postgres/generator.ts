// House generator: the POSTGRES layer. A server per dev stack, forward-only migrations, seeds, and a deploy that only CI or a
// human's own variable can aim. Needs nothing above the `agent` layer: the launcher is Node built-ins, the server and dbmate
// come with the image, so a Python repo wears it as well as a Node one. Idempotent and safe in upgrade mode.
//
// Writes, by class (CLAUDE.md):
//   A  tools/postgres/*.mjs: the launcher, rewritten every run.
//   B  the project tagged `type:postgres`, by default postgres/project.json: the targets, three-way merged like every house
//      project's. A project.json island whatever the workspace's linking, because it has no package of its own. The tag is this
//      layer's evidence (home.ts), and something else holding its name or folder is refused before anything is written.
//   C  postgres/migrations, postgres/seed/world, .bespunky/postgres.json: seeded once, the project's from then on.
//
// A running server is declared in `.bespunky/dev.json` for every served app (`postgres.devFragment`); with nothing served,
// `postgres:start` is a stack of its own through `tools/dev/dev run`. Which of the two is not decided here.
import { type Tree, addProjectConfiguration, formatFiles, logger } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireLayer } from '../../layers/registry';
import { FIREWALL_CONFIG, ensurePlatformFirewall, hasPlatformFirewall } from '../../platform';
import { deployTarget } from '../_utils/deploy-contract';
import { nodeVersionFile, projectNode } from '../_utils/node-version';
import { ensureHouseProject, houseProjectHome } from '../_utils/project-files';
import { readDeclaration } from '../dev/declaration';
import { POSTGRES_DEFAULT_MAJOR } from '../_utils/versions';
import { seedServedApps, servedProjects } from '../dev/generator';
import { localServerFragment, POSTGRES_PORT_NAME } from './dev-fragment';
import { POSTGRES_ROOT, POSTGRES_TAG, postgresHome, refuseForeignHolder } from './home';
import { POSTGRES_DECLARATION, postgresMajor } from './major';
import { MIGRATIONS_OF, type LocalServerProvider, providerOf } from './provider';

/** The launcher's files, relative to tools/postgres/: each written from files/<name>.tpl. */
export const LAUNCHER_FILES = ['postgres.mjs', 'layout.mjs', 'tools.mjs', 'url.mjs', 'stack.mjs', 'schema.mjs', 'server.mjs', 'native.mjs'] as const;
export const LAUNCHER_ROOT = 'tools/postgres';

const LAUNCH = 'node tools/postgres/postgres.mjs';

function verbTarget(verb: string, extra: Record<string, unknown> = {}) {
  // Never cached: each verb acts on a running server, and a cached one would be a skipped one. Not continuous: a stack is the
  // engine's to share, and Nx sharing a continuous task would let a second stack wait on the first.
  return {
    cache: false,
    continuous: false,
    executor: 'nx:run-commands',
    options: { command: `${LAUNCH} ${verb}`, cwd: '{workspaceRoot}', ...extra },
  };
}

function ensurePostgresProject(tree: Tree, provider: LocalServerProvider): void {
  // Tooling, with no `projectType`: neither an app nor a library, so layout inference does not read `postgres/` as where this
  // workspace keeps its apps.
  const tags = ['tooling', POSTGRES_TAG];
  const found = postgresHome(tree);
  if (!found) addProjectConfiguration(tree, POSTGRES_ROOT, { root: POSTGRES_ROOT, tags, targets: {} });
  const home = found ?? houseProjectHome(tree, POSTGRES_ROOT, POSTGRES_ROOT);
  const deploy = deployTarget(tree, home.root, {
    command: `${LAUNCH} deploy`,
    inputs: ['default'],
    watches: [`${MIGRATIONS_OF[provider]}/**/*`, ...(provider === 'supabase' ? ['supabase/functions/**/*', 'supabase/config.toml'] : [])],
  });
  ensureHouseProject(tree, 'postgres', home, {
    tags,
    contract: { deploy: deploy.contract },
    targets: {
      start: verbTarget('start'),
      migrate: verbTarget('migrate'),
      'new-migration': verbTarget('new-migration'),
      seed: verbTarget('seed'),
      reset: verbTarget('reset'),
      psql: verbTarget('psql', { tty: true }),
      deploy: deploy.target,
      ...(provider === 'supabase' ? { 'gen-types': verbTarget('gen-types'), 'new-function': verbTarget('new-function'), 'secrets-set': verbTarget('secrets-set', { tty: true }) } : {}),
    },
  });
}

/** Seeded once: a `.gitkeep`, so git holds the folder. Removing the folder later is the project's to do, and it stays removed. */
function seedFolder(tree: Tree, dir: string, seeded: boolean): void {
  if (seeded) tree.write(`${dir}/.gitkeep`, '');
}

/** Seeding reaches the apps Nx serves. An app only `.bespunky/dev.json` declares is the project's to wire, so it is told how. */
function reportHandDeclaredApps(tree: Tree): void {
  const served = new Set(servedProjects(tree));
  const [process] = localServerFragment(tree).processes;
  for (const [app, entry] of Object.entries(readDeclaration(tree)?.apps ?? {})) {
    const processes = entry.processes ?? [];
    if (served.has(app) || processes.some((p) => p.id === process.id || POSTGRES_PORT_NAME in (p.ports ?? {}))) continue;
    logger.info(`[postgres] ${app} is declared by hand in .bespunky/dev.json, so no server was seeded beside it. If it uses this database, add this to its processes:\n${JSON.stringify(process, null, 2)}`);
  }
}

/** The launcher and the dev engine need Node's own APIs from this major on (Node 16 crashes loading the launcher). */
const LAUNCHER_NODE_FLOOR = 18;

function refuseOldNode(tree: Tree): void {
  const node = projectNode(tree);
  if (node.state !== 'declared') return; // nothing declared: the project is seeded with the house's own Node
  if (node.major < LAUNCHER_NODE_FLOOR) {
    throw new Error(`postgres: the launcher needs Node ${LAUNCHER_NODE_FLOOR} or newer, and this project declares Node ${node.major}. Move ${nodeVersionFile(tree)} forward first, then add the layer.`);
  }
}

export default async function postgresGenerator(tree: Tree, options: { provider?: LocalServerProvider } = {}): Promise<void> {
  requireLayer(tree, 'agent', 'postgres');
  const provider = providerOf(tree, options.provider);
  // Before anything is written: a declaration this toolkit cannot honour stops the run here, naming what it can.
  if (provider === 'native') postgresMajor(tree);
  refuseOldNode(tree);
  if (!postgresHome(tree)) refuseForeignHolder(tree);

  for (const file of LAUNCHER_FILES) {
    tree.write(`${LAUNCHER_ROOT}/${file}`, readFileSync(join(__dirname, 'files', `${file}.tpl`), 'utf8'));
  }

  // Only the native provider has a major of its own and a folder of its own: with Supabase, both are the stack's (generators/supabase).
  const creating = provider === 'native' ? !tree.exists(POSTGRES_DECLARATION) : !postgresHome(tree);
  if (provider === 'native') {
    tree.write(`${LAUNCHER_ROOT}/provider.mjs`, readFileSync(join(__dirname, 'files', 'provider.mjs.tpl'), 'utf8'));
    if (creating) tree.write(POSTGRES_DECLARATION, `${JSON.stringify({ major: Number(POSTGRES_DEFAULT_MAJOR) }, null, 2)}\n`);
    seedFolder(tree, MIGRATIONS_OF.native, creating);
  }
  seedFolder(tree, `${POSTGRES_ROOT}/seed/world`, creating);

  ensurePostgresProject(tree, provider);
  // The project now exists, which is what the layer's dev fragment asks: every served app gets its server, and on a first
  // scaffold the web layer's own seeding ran before this step.
  seedServedApps(tree, 'postgres');
  reportHandDeclaredApps(tree);

  // A database driver must never reach a browser bundle. Lint is what enforces that: with no root ESLint config there is
  // nothing to enforce it with, and that is said rather than left silent.
  ensurePlatformFirewall(tree, 'postgres');
  if (!tree.exists(FIREWALL_CONFIG) || !hasPlatformFirewall(tree.read(FIREWALL_CONFIG, 'utf8') ?? '')) {
    logger.info(`[postgres] No platform firewall here (it lives in a root ${FIREWALL_CONFIG}), so nothing keeps \`pg\` out of a browser bundle if this repo ever builds one.`);
  }

  await formatFiles(tree);
}
