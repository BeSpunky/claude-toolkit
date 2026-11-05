// House generator: the SUPABASE layer. The local stack on the CLI's native runtime, behind the postgres:* targets. Runs after the
// `postgres` generator, whose launcher, project and seeds it keeps; it adds a provider, and does not make a second launcher.
//
// Writes, by class (CLAUDE.md):
//   A  tools/postgres/supabase-*.mjs and provider.mjs, rewritten every run. In supabase/config.toml, `[experimental] stack`.
//   B  the layer's tag on the postgres project; the keeper's process in .bespunky/dev.json, given what the stack needs (dev-merge.ts).
//   C  supabase/config.toml, .gitignore, supabase.lock and .bespunky/supabase.json, seeded when absent. The migrations, supabase/functions.
//      One line of supabase/.gitignore is re-asserted: functions/.env.
//
// THE FOLDER MOVE IS A STEP OF THIS GENERATOR, NOT A MIGRATION. A migration carries every project across a version, unasked; this
// happens because one project chose this layer, in the run that ensures it, and a project that never does keeps postgres/migrations
// for good. No shape any existing project has changes by this release, so there is no rung. Nothing left to move is the whole of a
// second run: a mention of the old path after that is a project's own, and stays.
import { type Tree, formatFiles, logger, readProjectConfiguration, updateProjectConfiguration, visitNotIgnoredFiles } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireLayer } from '../../layers/registry';
import { postgresHome } from '../postgres/home';
import { LAUNCHER_ROOT } from '../postgres/generator';
import { POSTGRES_DECLARATION } from '../postgres/major';
import { MIGRATIONS_OF, SUPABASE_TAG } from '../postgres/provider';
import { readDeclaration } from '../dev/declaration';
import { SUPABASE_CLI_VERSION } from '../_utils/versions';
import { workspaceIdentity } from '../_utils/workspace-identity';
import { mergeServedApps } from './dev-merge';
import { envFilesRefused } from './env-doors';
import { refuseWhatCannotMove } from './preflight';
import { setTomlValue, tomlValue } from './toml-lines';

export const SUPABASE_LAUNCHER_FILES = ['supabase-cli.mjs', 'supabase-keeper.mjs', 'supabase-lock.mjs', 'supabase-provider.mjs', 'supabase-reset.mjs'] as const;
export const SUPABASE_CONFIG = 'supabase/config.toml';
const SEEDED_SQL_PATHS = '["../postgres/seed/world/*.sql"]';
const INIT_SQL_PATHS = '["./seed.sql"]';
const FUNCTION_SECRETS = 'functions/.env';
/** Class C: where `postgres:gen-types` writes, and in what language. The project's from the day it is seeded. */
const SUPABASE_DECLARATION = '.bespunky/supabase.json';

const seed = (name: string) => readFileSync(join(__dirname, 'seed', `${name}.tpl`), 'utf8');

/** A config.toml's `project_id`: who this project is. The CLI takes any string and names things after it, and the file is committed. */
const projectId = (tree: Tree): string => workspaceIdentity(tree).replace(/[^\w.-]/g, '-') || 'app';

const migrationFilesIn = (tree: Tree, dir: string): string[] => (tree.exists(dir) ? tree.children(dir).filter((name) => tree.isFile(`${dir}/${name}`)) : []);

function ensureConfig(tree: Tree): void {
  if (!tree.exists(SUPABASE_CONFIG)) {
    tree.write(SUPABASE_CONFIG, seed('config.toml').replace('{{PROJECT_ID}}', projectId(tree)));
    return;
  }
  let text = tree.read(SUPABASE_CONFIG, 'utf8') ?? '';
  // Owned: without it the CLI takes the Docker backend, which this container does not have.
  text = setTomlValue(text, 'experimental', 'stack', 'true');
  // Seeds live with the launcher's on both providers. Only the value `init` writes, with the file it names absent, is free to move:
  // anything else is a project's seeds, and a reset would stop running them.
  const seeds = tomlValue(text, 'db.seed', 'sql_paths');
  if (seeds === undefined || (seeds === INIT_SQL_PATHS && !tree.exists('supabase/seed.sql'))) text = setTomlValue(text, 'db.seed', 'sql_paths', SEEDED_SQL_PATHS);
  else if (seeds !== SEEDED_SQL_PATHS) logger.info(`[supabase] ${SUPABASE_CONFIG} seeds from ${seeds}, and that stays: postgres/seed/world is not what a reset runs here.`);
  tree.write(SUPABASE_CONFIG, text);
}

/** Only the path itself, at a path's start: `services/billing/postgres/migrations` is another project's. `./`, `../` and `{workspaceRoot}/` are still this one. */
const REFERENCE = new RegExp(`(?<![\\w.-])(?<!(?:^|[^}.])/)${MIGRATIONS_OF.native.replace('/', '\\/')}`, 'gm');

/** A rename: every other occurrence of the old path is a reference to what moved. Skips what is not the project's prose or config to rewrite. */
function retargetReferences(tree: Tree): string[] {
  const rewritten: string[] = [];
  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.startsWith(`${LAUNCHER_ROOT}/`) || path.startsWith('docs/features/') || path === 'HOUSE.md' || path === 'HOUSE.rules.md') return;
    const buffer = tree.read(path);
    if (!buffer || buffer.length > 2_000_000 || buffer.includes(0)) return;
    const text = buffer.toString('utf8');
    const retargeted = text.replace(REFERENCE, MIGRATIONS_OF.supabase);
    if (retargeted === text) return;
    tree.write(path, retargeted);
    rewritten.push(path);
  });
  return rewritten;
}

function moveMigrations(tree: Tree): void {
  const from = MIGRATIONS_OF.native;
  const to = MIGRATIONS_OF.supabase;
  const left = tree.exists(from) ? tree.children(from).filter((name) => !tree.isFile(`${from}/${name}`)) : [];
  if (left.length) logger.info(`[supabase] ${from}/ keeps ${left.join(', ')}: the CLI runs only the files directly in ${to}, so a folder under it would never run. No folder was moved. Decide what each is, and move or remove it.`);
  const files = migrationFilesIn(tree, from);
  if (!files.length) return;
  const sql = files.filter((name) => name.endsWith('.sql'));
  // Read before the move: the CLI does not know dbmate's option, so what it asked for is the human's to decide.
  const untransacted = sql.filter((name) => /^-- migrate:up\b.*\btransaction:false\b/m.test(tree.read(`${from}/${name}`, 'utf8') ?? ''));
  for (const name of files) {
    if (name !== '.gitkeep') tree.rename(`${from}/${name}`, `${to}/${name}`);
    else tree.delete(`${from}/${name}`);
  }
  const rewritten = retargetReferences(tree);
  if (untransacted.length) logger.info(`[supabase] ${untransacted.join(', ')} say transaction:false, which is dbmate's and which the CLI does not read. If a statement in one cannot run in a transaction (create index concurrently), split it into a migration of that one statement, and try it with a reset.`);
  if (sql.length) logger.info(`[supabase] moved ${sql.length} migration(s) from ${from} to ${to}: the CLI hard-codes that path, and a project has one folder.`);
  if (rewritten.length) logger.info(`[supabase] retargeted ${from} to ${to} in: ${rewritten.join(', ')}`);
  if (sql.length) {
    logger.info(
      `HUMAN_STEP: if a hosted database already ran these through dbmate, it has no Supabase ledger, and the first deploy would apply them all again. Before it, once per database, in a terminal: ` +
        `supabase migration repair --status applied ${sql.map((name) => name.split('_')[0]).join(' ')} --remote="<its URL>" --yes. dbmate's own schema_migrations table stays there, unused: yours to drop.`,
    );
    logger.info('[supabase] Local data on the native server stays where it was, under ~/.local/share/bespunky/postgres, unused: the stack starts from your migrations and seeds. Remove it when you no longer want it.');
  }
}

function tagTheProject(tree: Tree): void {
  const home = postgresHome(tree);
  if (!home) throw new Error('[supabase] the postgres project is not there: its generator runs first.');
  const project = readProjectConfiguration(tree, home.name);
  updateProjectConfiguration(tree, home.name, { ...project, tags: [...new Set([...(project.tags ?? []), SUPABASE_TAG])] });
}

export default async function supabaseGenerator(tree: Tree): Promise<void> {
  requireLayer(tree, 'postgres', 'supabase');
  refuseWhatCannotMove(tree);

  for (const file of SUPABASE_LAUNCHER_FILES) {
    tree.write(`${LAUNCHER_ROOT}/${file}`, readFileSync(join(__dirname, 'files', `${file}.tpl`), 'utf8').replaceAll('{{SUPABASE_CLI_VERSION}}', SUPABASE_CLI_VERSION));
  }
  tree.write(`${LAUNCHER_ROOT}/provider.mjs`, readFileSync(join(__dirname, 'files', 'provider.mjs.tpl'), 'utf8'));

  ensureConfig(tree);
  if (!tree.exists('supabase/.gitignore')) tree.write('supabase/.gitignore', seed('gitignore'));
  // Owned, as a line: a function's local secrets go here, and the CLI's own ignore file does not cover it.
  const ignored = tree.read('supabase/.gitignore', 'utf8') ?? '';
  if (!ignored.split('\n').some((line) => line.trim() === FUNCTION_SECRETS)) tree.write('supabase/.gitignore', `${ignored.replace(/\n?$/, '\n')}\n# A function's local secrets\n${FUNCTION_SECRETS}\n`);
  if (!tree.exists(SUPABASE_DECLARATION)) tree.write(SUPABASE_DECLARATION, `${JSON.stringify({ types: { out: 'supabase/types/database.ts', lang: 'typescript' } }, null, 2)}\n`);
  if (!tree.exists('supabase/supabase.lock')) tree.write('supabase/supabase.lock', seed('supabase.lock'));
  for (const { file, name } of envFilesRefused(tree)) {
    logger.info(`HUMAN_STEP: ${file} sets ${name}, and the Supabase CLI reads that file, so every postgres:* verb will refuse until it is renamed. config.toml's env() takes any name, and an app can read it under its own.`);
  }

  moveMigrations(tree);
  // The major now lives in config.toml. Two places that can say it are two that can disagree.
  if (tree.exists(POSTGRES_DECLARATION)) tree.delete(POSTGRES_DECLARATION);

  tagTheProject(tree);
  if (readDeclaration(tree)) mergeServedApps(tree);
  await formatFiles(tree);
}
