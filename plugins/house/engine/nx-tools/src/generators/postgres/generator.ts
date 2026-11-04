// House generator: the POSTGRES layer. A server per dev stack, forward-only migrations, seeds, and a deploy that only CI or a
// human's own variable can aim. Needs nothing above the `agent` layer: the launcher is Node built-ins, the server and dbmate
// come with the image, so a Python repo wears it as well as a Node one. Idempotent and safe in upgrade mode.
//
// Writes, by class (CLAUDE.md):
//   A  tools/postgres/*.mjs: the launcher, rewritten every run.
//   B  postgres/project.json: the targets, three-way merged like every house project's; a project.json island whatever the
//      workspace's linking, because it has no package of its own and it is this layer's evidence.
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
import { ensureHouseProject, houseProjectHome } from '../_utils/project-files';
import { POSTGRES_DEFAULT_MAJOR } from '../_utils/versions';
import { seedServedApps } from '../dev/generator';
import { POSTGRES_DECLARATION, postgresMajor } from './major';

/** The launcher's files, relative to tools/postgres/: each written from files/<name>.tpl. */
export const LAUNCHER_FILES = ['postgres.mjs', 'layout.mjs', 'tools.mjs', 'url.mjs', 'stack.mjs', 'schema.mjs', 'server.mjs'] as const;
export const LAUNCHER_ROOT = 'tools/postgres';
export const POSTGRES_ROOT = 'postgres';
export const POSTGRES_MIGRATIONS = `${POSTGRES_ROOT}/migrations`;

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

function ensurePostgresProject(tree: Tree): void {
  // Tooling, with no `projectType`: neither an app nor a library, so layout inference does not read `postgres/` as where this
  // workspace keeps its apps.
  const tags = ['tooling'];
  if (!houseProjectHome(tree, POSTGRES_ROOT, POSTGRES_ROOT).exists) {
    addProjectConfiguration(tree, POSTGRES_ROOT, { root: POSTGRES_ROOT, tags, targets: {} });
  }
  const deploy = deployTarget(tree, POSTGRES_ROOT, {
    command: `${LAUNCH} deploy`,
    inputs: ['default'],
    watches: [`${POSTGRES_MIGRATIONS}/**/*`],
  });
  ensureHouseProject(tree, 'postgres', houseProjectHome(tree, POSTGRES_ROOT, POSTGRES_ROOT), {
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
    },
  });
}

/** Seeded once: a `.gitkeep`, so git holds the folder. Removing the folder later is the project's to do, and it stays removed. */
function seedFolder(tree: Tree, dir: string, seeded: boolean): void {
  if (seeded) tree.write(`${dir}/.gitkeep`, '');
}

export default async function postgresGenerator(tree: Tree): Promise<void> {
  requireLayer(tree, 'agent', 'postgres');
  // Before anything is written: a declaration this toolkit cannot honour stops the run here, naming what it can.
  postgresMajor(tree);

  for (const file of LAUNCHER_FILES) {
    tree.write(`${LAUNCHER_ROOT}/${file}`, readFileSync(join(__dirname, 'files', `${file}.tpl`), 'utf8'));
  }

  const creating = !tree.exists(POSTGRES_DECLARATION);
  if (creating) tree.write(POSTGRES_DECLARATION, `${JSON.stringify({ major: Number(POSTGRES_DEFAULT_MAJOR) }, null, 2)}\n`);
  seedFolder(tree, POSTGRES_MIGRATIONS, creating);
  seedFolder(tree, `${POSTGRES_ROOT}/seed/world`, creating);

  ensurePostgresProject(tree);
  // The project now exists, which is what the layer's dev fragment asks: every served app gets its server, and on a first
  // scaffold the web layer's own seeding ran before this step.
  seedServedApps(tree, 'postgres');

  // A database driver must never reach a browser bundle. Lint is what enforces that: with no root ESLint config there is
  // nothing to enforce it with, and that is said rather than left silent.
  ensurePlatformFirewall(tree, 'postgres');
  if (!tree.exists(FIREWALL_CONFIG) || !hasPlatformFirewall(tree.read(FIREWALL_CONFIG, 'utf8') ?? '')) {
    logger.info(`[postgres] No platform firewall here (it lives in a root ${FIREWALL_CONFIG}), so nothing keeps \`pg\` out of a browser bundle if this repo ever builds one.`);
  }

  await formatFiles(tree);
}
