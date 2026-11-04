// The Supabase provider: the verbs of the launcher, on the CLI's stack. GENERATOR-OWNED.
//
// THE CLI RUNS THE MIGRATIONS AND THE RESET, into its own ledger. What stays here is what it does not guard: forward-only, a file it
// would skip in silence, the per-stack lock, a reset that runs to completion. Its Postgres is the database: `postgres`, with the
// stack's well-known password, on loopback. Nothing here is a secret or reaches past this machine, but `deploy`.
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { ROOT, ROLE, Refusal } from './layout.mjs';
import { writeNextMigration } from './schema.mjs';
import { ALLOCATES_FROM, MIGRATIONS, PORTS, SUPABASE_DIR, assertNoEnvFileOverride, assertPinnedVersion, cli, seedPatterns } from './supabase-cli.mjs';
import { assertStackIdentity, resetToCompletion, serve } from './supabase-keeper.mjs';
import { psqlArgs, run, scrubbedEnv } from './tools.mjs';

const DATABASE = 'postgres';
const clientEnv = () => scrubbedEnv({ PGPASSWORD: 'postgres' });

/** A file the CLI's own pattern misses is skipped with a message and an exit of 0. A non-empty down runs AS PART of the migration. */
function checkMigrations() {
  if (!existsSync(MIGRATIONS)) return;
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql'))) {
    const where = `supabase/migrations/${name}`;
    if (!/^\d+_.*\.sql$/.test(name)) throw new Refusal(`${where}: the CLI runs only <digits>_<name>.sql, and would skip this one without failing.`);
    const body = readFileSync(join(MIGRATIONS, name), 'utf8');
    const down = /^-- migrate:down\b.*$/m.exec(body);
    if (down && body.slice(down.index + down[0].length).trim()) throw new Refusal(`${where}: migrations are forward-only, and the CLI would run what follows \`-- migrate:down\` as part of this migration, reporting no error. To undo a migration, write the next one.`);
  }
}

/** What config.toml's seed patterns match now, relative to supabase/, in the order a reset runs them. Only a last segment may be a glob. */
function seedFiles() {
  return seedPatterns().flatMap((pattern) => {
    const full = resolvePath(SUPABASE_DIR, pattern);
    if (!/[*?]/.test(pattern)) return existsSync(full) ? [relative(SUPABASE_DIR, full)] : [];
    const dir = dirname(full);
    if (!existsSync(dir)) return [];
    const matches = new RegExp(`^${full.slice(dir.length + 1).replace(/[.+^$()|{}]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    return readdirSync(dir).filter((name) => matches.test(name)).sort().map((name) => relative(SUPABASE_DIR, join(dir, name)));
  });
}

/** `postgresql://user:password@host…` without the password, and a passfile holding it: argv is readable by every process on the machine. */
function withoutPassword(url) {
  const { protocol, rest } = /^(?<protocol>[^:]+:\/\/)(?<rest>.*)$/s.exec(url).groups;
  const slash = rest.search(/[/?#]/);
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const at = authority.lastIndexOf('@');
  if (at < 0) return { bare: url, password: '' };
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  if (colon < 0) return { bare: url, password: '' };
  return { bare: `${protocol}${userinfo.slice(0, colon)}${authority.slice(at)}${slash < 0 ? '' : rest.slice(slash)}`, password: decodeURIComponent(userinfo.slice(colon + 1)) };
}

export const provider = {
  ports: PORTS,
  avoidPorts: [ALLOCATES_FROM],
  seedsLabel: 'config.toml\'s [db.seed] sql_paths',
  serve,
  assertIdentity: assertStackIdentity,
  /** One stack per tree: no key to ask which. */
  stacksWithData: () => [],
  async migrate() {
    assertNoEnvFileOverride();
    checkMigrations();
    const result = await cli(['migration', 'up'], { echo: true });
    if (result.code !== 0) throw new Refusal('Migrating failed, above. Nothing after the failed migration ran.');
  },
  /** Again, on purpose: the CLI's own seeding happens only at a first start and a reset, and it has no verb for this. As one transaction. */
  async seed(stack) {
    const files = seedFiles();
    if (!files.length) return 0;
    const result = await run('psql', [...psqlArgs(stack.port, DATABASE), '--single-transaction', ...files.flatMap((file) => ['-f', file])], { cwd: SUPABASE_DIR, env: clientEnv() });
    if (result.code !== 0) throw new Refusal(`Seeding failed, so nothing of it was kept, unless a file committed by itself: ${result.stderr.trim()}`);
    return files.length;
  },
  /** Whatever happens to this process, the reset finishes: it is not this process's child in any way a signal could reach. */
  async reset() {
    assertNoEnvFileOverride();
    checkMigrations();
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, () => console.error('[postgres] a reset runs to completion: interrupting one can wedge the stack. Stopping when it ends.'));
    if ((await resetToCompletion()) !== 0) throw new Refusal('The reset failed, above.');
  },
  client: (stack) => ({ args: ['-h', '127.0.0.1', '-p', String(stack.port), '-U', ROLE, '-d', DATABASE], env: clientEnv() }),
  newMigration(name) {
    mkdirSync(MIGRATIONS, { recursive: true });
    return writeNextMigration(MIGRATIONS, name, '-- Forward-only: to undo a migration, write the next one.\n\n');
  },
  /** `db push`, into the hosted database's own ledger. The password reaches the CLI through a private passfile, never argv. */
  async deploy(url, target, hide) {
    assertPinnedVersion();
    assertNoEnvFileOverride();
    checkMigrations();
    const { bare, password } = withoutPassword(url);
    const dir = mkdtempSync(join(tmpdir(), 'bespunky-supabase-'));
    chmodSync(dir, 0o700);
    const passfile = join(dir, 'pgpass');
    writeFileSync(passfile, password ? `*:*:*:*:${password.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n` : '', { mode: 0o600 });
    try {
      const result = await cli(['db', 'push', `--remote=${bare}`, '--yes'], { env: { PGPASSFILE: passfile } });
      const said = hide(`${result.stdout}${result.stderr}`).trim();
      if (said) console.log(said);
      if (result.code !== 0) throw new Refusal(`Migrating ${target.display} failed (supabase exit ${result.code}). What already ran stays, recorded in its ledger.`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
