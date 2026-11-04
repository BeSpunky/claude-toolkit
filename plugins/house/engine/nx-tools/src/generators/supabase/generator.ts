// House generator: the SUPABASE layer. The local stack on the CLI's native runtime, behind the postgres:* targets. Runs after the
// `postgres` generator, whose launcher, project and seeds it keeps; it adds a provider, and does not make a second launcher.
//
// Writes, by class (CLAUDE.md):
//   A  tools/postgres/supabase-*.mjs and provider.mjs, rewritten every run. In supabase/config.toml, `[experimental] stack`.
//   B  the layer's tag on the postgres project; a served app's process in .bespunky/dev.json, reshaped the once (dev-merge.ts).
//   C  supabase/config.toml, .gitignore and supabase.lock, seeded when absent. The migrations.
//
// THE FOLDER MOVE IS A STEP OF THIS GENERATOR, NOT A MIGRATION. A migration carries every project across a version, unasked; this
// happens because one project chose this layer, in the run that ensures it, and a project that never does keeps postgres/migrations
// for good. No shape any existing project has changes by this release, so there is no rung. The move is idempotent for the same
// reason everything here is: nothing left to move is the whole of the second run.
import { type Tree, formatFiles, logger, readProjectConfiguration, updateProjectConfiguration, visitNotIgnoredFiles } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireLayer } from '../../layers/registry';
import { postgresHome } from '../postgres/home';
import { LAUNCHER_ROOT } from '../postgres/generator';
import { POSTGRES_DECLARATION } from '../postgres/major';
import { MIGRATIONS_OF, SUPABASE_TAG } from '../postgres/provider';
import { readDeclaration } from '../dev/declaration';
import { SUPABASE_CLI_VERSION, SUPABASE_MAJORS } from '../_utils/versions';
import { mergeServedApps } from './dev-merge';
import { hasTomlSection, setTomlValue, tomlValue } from './toml-lines';

export const SUPABASE_LAUNCHER_FILES = ['supabase-cli.mjs', 'supabase-keeper.mjs', 'supabase-provider.mjs', 'supabase-reset.mjs'] as const;
export const SUPABASE_CONFIG = 'supabase/config.toml';
const SEEDED_SQL_PATHS = '["../postgres/seed/world/*.sql"]';
const INIT_SQL_PATHS = '["./seed.sql"]';
const SUPPORTED_MAJOR = SUPABASE_MAJORS.at(-1)!;

const seed = (name: string) => readFileSync(join(__dirname, 'seed', `${name}.tpl`), 'utf8');

/** A config.toml's `project_id`: the CLI takes any string, and names things after it. */
const projectId = (tree: Tree): string => {
  try {
    return (JSON.parse(tree.read('package.json', 'utf8') ?? '{}') as { name?: string }).name?.replace(/^@[^/]+\//, '').replace(/[^\w.-]/g, '-') || 'app';
  } catch {
    return 'app';
  }
};

const migrationFilesIn = (tree: Tree, dir: string): string[] => (tree.exists(dir) ? tree.children(dir).filter((name) => tree.isFile(`${dir}/${name}`)) : []);

/**
 * The backstop of `house-probe.mts`, which refuses these before anything is written. A generator run straight, or a project that
 * changed between the two, still stops here, before this generator has written.
 */
function refuseWhatCannotMove(tree: Tree): void {
  if (tree.exists(POSTGRES_DECLARATION)) {
    const { major } = JSON.parse(tree.read(POSTGRES_DECLARATION, 'utf8') ?? '{}') as { major?: unknown };
    if (String(major) !== SUPPORTED_MAJOR) {
      throw new Error(
        `[supabase] ${POSTGRES_DECLARATION} declares Postgres ${major}, and the Supabase stack runs ${SUPPORTED_MAJOR}. uuidv7() and virtual generated columns, for two, do not exist there. Nothing was written.\n` +
          `  If your migrations use nothing newer: set { "major": ${SUPPORTED_MAJOR} } in ${POSTGRES_DECLARATION}, check them against it (house.sh upgrade, rebuild, postgres:reset), and add the layer again.`,
      );
    }
  }
  if (tree.exists(SUPABASE_CONFIG)) {
    const text = tree.read(SUPABASE_CONFIG, 'utf8') ?? '';
    const major = tomlValue(text, 'db', 'major_version');
    if (major !== undefined && !(SUPABASE_MAJORS as readonly string[]).includes(major)) {
      throw new Error(`[supabase] ${SUPABASE_CONFIG} says major_version = ${major}, and the stack runs ${SUPABASE_MAJORS.join(' or ')}. Nothing was written. Set one of them.`);
    }
    if (hasTomlSection(text, 'inbucket')) throw new Error(`[supabase] ${SUPABASE_CONFIG} has an [inbucket] section, which CLI ${SUPABASE_CLI_VERSION} cannot load. Nothing was written. Rename it to [local_smtp].`);
  }
  const twins = migrationFilesIn(tree, MIGRATIONS_OF.native).filter((name) => name.endsWith('.sql') && tree.exists(`${MIGRATIONS_OF.supabase}/${name}`));
  if (twins.length) {
    throw new Error(`[supabase] ${twins.join(', ')} exist in both ${MIGRATIONS_OF.native} and ${MIGRATIONS_OF.supabase}, and a project has one folder. Nothing was written. Keep one of each and run this again.`);
  }
}

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

/** A rename: every other occurrence of the old path is a reference to what moved. Skips what is not the project's prose or config to rewrite. */
function retargetReferences(tree: Tree): string[] {
  const rewritten: string[] = [];
  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.startsWith(`${LAUNCHER_ROOT}/`) || path.startsWith('docs/features/') || path === 'HOUSE.md' || path === 'HOUSE.rules.md') return;
    const buffer = tree.read(path);
    if (!buffer || buffer.length > 2_000_000 || buffer.includes(0)) return;
    const text = buffer.toString('utf8');
    if (!text.includes(MIGRATIONS_OF.native)) return;
    tree.write(path, text.split(MIGRATIONS_OF.native).join(MIGRATIONS_OF.supabase));
    rewritten.push(path);
  });
  return rewritten;
}

function moveMigrations(tree: Tree): void {
  const from = MIGRATIONS_OF.native;
  const to = MIGRATIONS_OF.supabase;
  const files = migrationFilesIn(tree, from);
  const sql = files.filter((name) => name.endsWith('.sql'));
  for (const name of files) {
    if (name !== '.gitkeep') tree.rename(`${from}/${name}`, `${to}/${name}`);
    else tree.delete(`${from}/${name}`);
  }
  const rewritten = retargetReferences(tree);
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
  if (!tree.exists('supabase/supabase.lock')) tree.write('supabase/supabase.lock', seed('supabase.lock'));

  moveMigrations(tree);
  // The major now lives in config.toml. Two places that can say it are two that can disagree.
  if (tree.exists(POSTGRES_DECLARATION)) tree.delete(POSTGRES_DECLARATION);

  tagTheProject(tree);
  if (readDeclaration(tree)) mergeServedApps(tree);
  await formatFiles(tree);
}
