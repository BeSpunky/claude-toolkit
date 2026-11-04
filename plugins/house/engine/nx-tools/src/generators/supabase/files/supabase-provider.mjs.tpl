// The Supabase provider: the verbs of the launcher, on the CLI's stack. GENERATOR-OWNED.
//
// THE CLI RUNS THE MIGRATIONS AND THE RESET, into its own ledger. What stays here is what it does not guard: forward-only, a file it
// would skip in silence, the per-stack lock, a reset that runs to completion. Its Postgres is the database: `postgres`, with the
// stack's well-known password, on loopback. Nothing here is a secret or reaches past this machine, but `deploy`.
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { ROOT, ROLE, Refusal } from './layout.mjs';
import { writeNextMigration } from './schema.mjs';
import { ALLOCATES_FROM, MIGRATIONS, PORTS, SUPABASE_DIR, assertNoEnvFileOverride, assertPinnedVersion, cli, genTypes, seedPatterns } from './supabase-cli.mjs';
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

const FUNCTIONS = join(SUPABASE_DIR, 'functions');
const DECLARATION = join(ROOT, '.bespunky/supabase.json');
/** What `functions deploy` would ship: a folder with an entrypoint. `_shared` and friends are not functions. */
export const functionNames = () => (existsSync(FUNCTIONS) ? readdirSync(FUNCTIONS).filter((name) => !name.startsWith('_') && !name.startsWith('.') && statSync(join(FUNCTIONS, name)).isDirectory()) : []);

/** A project or branch ref, never a URL or a word with an `=` that the CLI would read as something else. */
function refOf(flags, verb) {
  const ref = flags['project-ref'];
  if (!ref) throw new Refusal(`${verb} needs --project-ref=<ref>: nothing here chooses a hosted project for you.`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(ref)) throw new Refusal(`--project-ref is a project or branch ref, lower-case letters, digits and dashes: ${/^[\w.-]{0,40}$/.test(ref) ? ref : 'not that'}.`);
  return ref;
}

/** The shell's own token, or none, when the CLI falls back to the login under SUPABASE_HOME. Env files were refused before this. */
const hostedEnv = () => (process.env.SUPABASE_ACCESS_TOKEN ? { SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN } : {});
const refuseUnderAgent = (what) => {
  if (process.env.CLAUDECODE === '1') throw new Refusal(`${what} is not an agent's to run: a human runs it, in a terminal. Hand the user the command.`);
};

/**
 * A line of the env file the CLI reads, by its own grammar, observed (tools/test-supabase sends it these and reads what it would post):
 * inside any of its quotes a character is itself, with no escapes, so a value needs a quote it does not hold. All three: refused.
 */
export function secretLine(name, value) {
  if (/[\r\n]/.test(value)) throw new Refusal(`${name}'s value holds a line break, which this verb does not carry. Encode it, or use the dashboard.`);
  const quote = ["'", '`', '"'].find((candidate) => !value.includes(candidate));
  if (!quote) throw new Refusal(`${name}'s value holds all three quote characters, which the CLI's env file cannot carry. Encode it, or use the dashboard.`);
  return `${name}=${quote}${value}${quote}\n`;
}

/** One line from the terminal, never echoed. Ctrl+C or Ctrl+D ends the verb having sent nothing. */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    let value = '';
    const finish = (settle) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      settle();
    };
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') return finish(() => resolve(value));
        if (char === '\u0003' || char === '\u0004') return finish(() => reject(new Refusal('Not sent; nothing changed.')));
        if (char === '\u007f') value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

function typesOptions(flags) {
  let declared = {};
  if (existsSync(DECLARATION)) {
    try {
      declared = JSON.parse(readFileSync(DECLARATION, 'utf8')).types ?? {};
    } catch (error) {
      throw new Refusal(`.bespunky/supabase.json is not valid JSON (${error.message}).`);
    }
  }
  const options = { out: flags.out ?? declared.out ?? 'supabase/types/database.ts', lang: flags.lang ?? declared.lang ?? 'typescript', schema: flags.schema ?? declared.schema };
  const target = resolvePath(ROOT, options.out);
  if (isAbsolute(options.out) || relative(ROOT, target).startsWith('..')) throw new Refusal(`The types' path is inside this tree, relative to its root: ${options.out}`);
  return { ...options, target };
}

const verbs = ({ parse, addressed }) => ({
  /** From this tree's running stack, to the path the project declared. Written whole or not at all. */
  async 'gen-types'(argv) {
    assertNoEnvFileOverride();
    const { stack, flags } = await addressed(argv, ['offset', 'out', 'lang', 'schema']);
    const { out, lang, schema, target } = typesOptions(flags);
    const types = await genTypes({ lang, schema });
    mkdirSync(dirname(target), { recursive: true });
    const partial = `${target}.${process.pid}.partial`;
    writeFileSync(partial, types);
    renameSync(partial, target);
    console.log(`[postgres] wrote ${out} from ${stack.key} (${lang}).`);
    return 0;
  },
  /** The CLI's own, because it also writes the function's config.toml block. It would offer to rewrite .vscode/settings.json: declined. */
  async 'new-function'(argv) {
    assertNoEnvFileOverride();
    const { flags, rest } = parse(argv, ['name'], { positionals: 1 });
    const name = flags.name ?? rest[0];
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name ?? '')) throw new Refusal('A function needs a name of letters, digits, dashes and underscores: postgres:new-function --name=hello');
    const result = await cli(['functions', 'new', name], { input: 'n\n' });
    if (result.code !== 0) throw new Refusal(`supabase functions new failed: ${(result.stderr || result.stdout).trim()}`);
    console.log(`[postgres] created supabase/functions/${name}. A running stack serves it at once, at <SUPABASE_URL>/functions/v1/${name}. Its local secrets go in supabase/functions/.env, gitignored, read at the next start.`);
    return 0;
  },
  /**
   * Hosted function secrets. A value travels only from a human's terminal, unechoed, down a pipe to the CLI's `--env-file /dev/stdin`:
   * never in argv, where every process could read it, never in a file, never printed. Nothing here can see a value that is already set.
   */
  async 'secrets-set'(argv) {
    refuseUnderAgent('Setting a hosted secret');
    assertPinnedVersion();
    assertNoEnvFileOverride();
    const { flags } = parse(argv, ['project-ref', 'name']);
    const ref = refOf(flags, 'secrets-set');
    const names = (flags.name ?? '').split(',').filter(Boolean);
    if (!names.length) throw new Refusal('Name what to set: --name=STRIPE_KEY[,OTHER]. The values are asked for, unechoed.');
    for (const name of names) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Refusal(`A secret's name is letters, digits and underscores: ${/^[\w-]{0,60}$/.test(name) ? name : 'not that'}.`);
      if (name.startsWith('SUPABASE_')) throw new Refusal(`${name}: Supabase keeps names starting SUPABASE_ for itself.`);
    }
    if (!process.stdin.isTTY) throw new Refusal('A secret\'s value is asked for at a terminal, and there is none. Run this yourself, in one.');
    let body = '';
    const values = [];
    for (const name of names) {
      const value = await readHidden(`${name} on ${ref} (not echoed): `);
      if (!value) throw new Refusal(`${name} is empty; nothing was sent. Unset a secret with: supabase secrets unset ${name} --remote=${ref}`);
      values.push(value);
      body += secretLine(name, value);
    }
    const result = await cli(['secrets', 'set', '--env-file', '/dev/stdin', `--remote=${ref}`, '--yes'], { input: body, env: hostedEnv() });
    const hide = (text) => values.reduce((masked, value) => masked.split(value).join('***'), text);
    if (result.code !== 0) throw new Refusal(`Setting ${names.join(', ')} on ${ref} failed: ${hide(`${result.stderr}${result.stdout}`).trim()}`);
    console.log(`[postgres] set ${names.join(', ')} on ${ref}.`);
    return 0;
  },
});

export const provider = {
  verbs,
  deployFlags: ['project-ref'],
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
  /**
   * `db push`, into the hosted database's own ledger, then every function: schema before the code that needs it. The password reaches
   * the CLI through a private passfile, never argv. A project with functions and no way to ship them is refused BEFORE the push: half
   * a deploy reported whole is what this must not do. `--use-api` bundles on Supabase's side, since this container has no Docker.
   */
  async deploy(url, target, hide, flags = {}) {
    assertPinnedVersion();
    assertNoEnvFileOverride();
    checkMigrations();
    const functions = functionNames();
    const ref = functions.length ? refOf(flags, `Deploying ${functions.join(', ')}`) : undefined;
    if (functions.length && !process.env.SUPABASE_ACCESS_TOKEN && process.env.CI) throw new Refusal(`Deploying ${functions.join(', ')} needs SUPABASE_ACCESS_TOKEN, and it is not set. CI sets it from the environment's secret, SUPABASE_ACCESS_TOKEN_<ENVIRONMENT>. Nothing was pushed.`);
    const { bare, password } = withoutPassword(url);
    const dir = mkdtempSync(join(tmpdir(), 'bespunky-supabase-'));
    chmodSync(dir, 0o700);
    const passfile = join(dir, 'pgpass');
    writeFileSync(passfile, password ? `*:*:*:*:${password.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n` : '', { mode: 0o600 });
    try {
      const result = await cli(['db', 'push', `--remote=${bare}`, '--yes'], { env: { PGPASSFILE: passfile } });
      const said = hide(`${result.stdout}${result.stderr}`).trim();
      if (said) console.log(`${said}`);
      if (result.code !== 0) throw new Refusal(`Migrating ${target.display} failed (supabase exit ${result.code}). What already ran stays, recorded in its ledger.`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (!functions.length) return;
    const shipped = await cli(['functions', 'deploy', '--use-api', `--remote=${ref}`, '--yes'], { env: hostedEnv() });
    const said = hide(`${shipped.stdout}${shipped.stderr}`).trim();
    if (said) console.log(`${said}`);
    if (shipped.code !== 0) throw new Refusal(`The schema is deployed, and deploying ${functions.join(', ')} to ${ref} failed (supabase exit ${shipped.code}). Deploying again changes nothing in the schema, and retries these.`);
  },
};
