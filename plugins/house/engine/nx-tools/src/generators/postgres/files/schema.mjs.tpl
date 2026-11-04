// The database's contents: creating it, migrating it, seeding it. GENERATOR-OWNED.
//
// MIGRATIONS ARE FORWARD-ONLY: `<14 digits>_<name>.sql`, with `-- migrate:up` and an EMPTY `-- migrate:down`. Checked here,
// before dbmate runs, because a non-empty down runs as part of the migration under the Supabase CLI, with no error: the
// format is what lets this folder move to that runner one day. To undo a migration, write the next one.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DATABASE, MIGRATIONS, ROLE, ROOT, Refusal, SEEDS } from './layout.mjs';
import { psqlArgs, query, run, scrubbedEnv, withEmptyEnvFile } from './tools.mjs';

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+\.sql$/;
const SEEDED = 'bespunky: seeded';

/** The URL of a local stack. It holds no secret: the server trusts loopback, and listens nowhere else. */
export const localUrl = (port) => `postgresql://${ROLE}@127.0.0.1:${port}/${DATABASE}?sslmode=disable`;

export function migrationFiles() {
  if (!existsSync(MIGRATIONS)) return [];
  return readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
}

/** Every migration file, held to the format. One bad file refuses the run, before anything is applied. */
export function checkMigrations() {
  for (const name of migrationFiles()) {
    const where = `postgres/migrations/${name}`;
    if (!MIGRATION_NAME.test(name)) throw new Refusal(`${where}: a migration is named <14 digits>_<lower_snake_name>.sql. Create one with: postgres:new-migration`);
    const body = readFileSync(join(MIGRATIONS, name), 'utf8');
    const up = /^-- migrate:up\b.*$/m.exec(body);
    if (!up) throw new Refusal(`${where} has no \`-- migrate:up\` line.`);
    const down = /^-- migrate:down\b.*$/m.exec(body);
    if (down && (down.index < up.index || body.slice(down.index + down[0].length).trim())) {
      throw new Refusal(`${where}: migrations are forward-only, so \`-- migrate:down\` stays empty and comes last. To undo a migration, write the next one.`);
    }
  }
}

/** The one way dbmate is run: an empty env file so `.env` stays shut, a complete URL, explicit paths, and a cwd outside the tree. */
export async function dbmateMigrate(connection, { signal, onOutput } = {}) {
  checkMigrations();
  if (!migrationFiles().length) return;
  await withEmptyEnvFile(async (dir, emptyEnv) => {
    const args = [...connection.args, '--env-file', emptyEnv, '-d', MIGRATIONS, '--migrations-table', 'schema_migrations', '--no-dump-schema', '--migration-lock', 'migrate', '--strict'];
    const result = await run('dbmate', args, { cwd: dir, env: scrubbedEnv(connection.env), signal });
    if (result.aborted) return;
    const said = onOutput ? onOutput(result.stdout + result.stderr) : result.stdout + result.stderr;
    if (said.trim()) console.log(`${said.trim()}`);
    if (result.code !== 0) throw new Refusal(`Migrating failed (dbmate exit ${result.code}). Nothing after the failed migration ran.`);
  });
}

export const localMigrate = (port, options) => dbmateMigrate({ args: ['--url', localUrl(port)] }, options);

export async function ensureDatabase(port, { signal } = {}) {
  const found = await query(port, `SELECT 1 FROM pg_database WHERE datname = '${DATABASE}'`, { database: 'postgres', signal });
  if (found !== '1') await query(port, `CREATE DATABASE ${DATABASE}`, { database: 'postgres', signal });
}

export const dropDatabase = (port, { signal } = {}) => query(port, `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`, { database: 'postgres', signal });

const seedFiles = () => (existsSync(SEEDS) ? readdirSync(SEEDS).filter((name) => name.endsWith('.sql')).sort() : []);

/**
 * Apply the seed world, in file-name order, as ONE transaction, with the mark that it happened inside that transaction. So a
 * failed seed leaves nothing and no mark, and the mark lives and dies with the database: a reset cannot leave a stale one.
 * Run from the world's folder, so a seed can `\copy` a file beside it.
 */
export async function applySeeds(port, { signal } = {}) {
  const files = seedFiles();
  if (!files.length) return false;
  const args = [...psqlArgs(port), '--single-transaction', ...files.flatMap((file) => ['-f', file]), '-c', `COMMENT ON DATABASE ${DATABASE} IS '${SEEDED}'`];
  const result = await run('psql', args, { cwd: SEEDS, signal });
  if (result.aborted) return false;
  if (result.code !== 0) throw new Refusal(`Seeding failed, so nothing of it was kept, unless a file committed by itself (${relative(ROOT, SEEDS)}): ${result.stderr.trim()}`);
  return files.length;
}

/** Seed a database that has not been seeded: what a start and a reset do. `seed` the verb always applies. */
export async function seedOnce(port, options) {
  const mark = await query(port, `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${DATABASE}'`, { database: 'postgres', signal: options?.signal });
  return mark === SEEDED ? false : applySeeds(port, options);
}

/** The next migration's file, stamped later than every one before it even when the clock disagrees. */
export function newMigration(name) {
  if (!/^[a-z0-9_]+$/.test(name ?? '')) throw new Refusal('A migration needs a lower_snake name: postgres:new-migration --name=add_users');
  const stamp = (date) => date.toISOString().replace(/\D/g, '').slice(0, 14);
  const latest = migrationFiles().map((file) => file.slice(0, 14)).filter((file) => /^\d{14}$/.test(file)).at(-1);
  let now = new Date();
  if (latest && stamp(now) <= latest) {
    const [y, mo, d, h, mi, s] = latest.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/).slice(1).map(Number);
    now = new Date(Date.UTC(y, mo - 1, d, h, mi, s + 1));
  }
  const file = join(MIGRATIONS, `${stamp(now)}_${name}.sql`);
  writeFileSync(file, '-- migrate:up\n\n\n-- migrate:down\n');
  return relative(ROOT, file);
}
