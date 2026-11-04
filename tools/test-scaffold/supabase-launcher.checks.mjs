// The Supabase provider's decisions, with no stack: a fake `supabase` on PATH that records its argv and answers as a script says, and a
// fake `tools/dev/dev.mjs`. Whatever would regress SILENTLY: the pins, a port comparison, what a child is handed, a lock, a refusal.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GENERATORS = join(dirname(fileURLToPath(import.meta.url)), '../../plugins/house/engine/nx-tools/src/generators');
const scratch = mkdtempSync(join(tmpdir(), 'supabase-launcher-'));
const tree = join(scratch, 'tree');
const bin = join(scratch, 'bin');
const calls = join(scratch, 'calls');
const xdg = join(scratch, 'xdg');
const VERSION = '9.9.9';
const render = (from) => {
  for (const file of readdirSync(from)) writeFileSync(join(tree, 'tools/postgres', file.replace(/\.tpl$/, '')), readFileSync(join(from, file), 'utf8').replaceAll('{{SUPABASE_CLI_VERSION}}', VERSION));
};
for (const dir of [join(tree, 'tools/postgres'), join(tree, 'tools/dev'), join(tree, 'supabase/migrations'), join(tree, 'postgres/seed/world'), bin, calls, xdg]) mkdirSync(dir, { recursive: true });
render(join(GENERATORS, 'postgres/files'));
render(join(GENERATORS, 'supabase/files'));
writeFileSync(join(tree, 'supabase/config.toml'), '[db]\nmajor_version = 17\n\n[db.seed]\nenabled = true\nsql_paths = [\n  "../postgres/seed/world/*.sql", # the world\n  "./extra.sql",\n]\n\n[experimental]\nstack = true\n');

const ID = 'stack-id';
const OFFSET = 30000;
const PORTS = { postgres: 5432, 'db-shadow': 5433, 'db-pooler': 5434, 'supabase-api': 5435, studio: 5436, analytics: 5437, mail: 5438, 'mail-smtp': 5439, 'mail-pop3': 5440, 'functions-inspector': 5441 };
const shifted = Object.fromEntries(Object.entries(PORTS).map(([name, port]) => [`PORT_${name.toUpperCase().replace(/-/g, '_')}`, String(port + OFFSET)]));
const home = join(xdg, 'supabase');
mkdirSync(join(home, 'stacks', ID, 'data'), { recursive: true });

// The fake: one file per call, argv then the environment a test asks about; answers from `answers/<first word(s)>`, a shell body.
const answers = join(scratch, 'answers');
mkdirSync(answers);
writeFileSync(join(bin, 'supabase'), `#!/bin/bash
if [ "$1" = "--version" ]; then cat "${scratch}/version" 2>/dev/null || echo ${VERSION}; exit 0; fi
n="$(mktemp "${calls}/call.XXXXXX")"
{ printf '%s\\n' "$@"; echo "--env"; env | grep -E '^(SUPABASE_|PG|DATABASE_URL|DBMATE_|DO_NOT_TRACK)'; } > "$n"
key="$1"; [ "$1" = db ] && key="db-$2"; [ "$1" = stack ] && key="stack-$2"; [ "$1" = migration ] && key="migration-$2"
if [ -f "${answers}/$key" ]; then . "${answers}/$key"; fi
exit 0
`);
chmodSync(join(bin, 'supabase'), 0o755);
writeFileSync(join(bin, 'psql'), `#!/bin/sh\n{ printf '%s\\n' "$@"; echo "--pw=$PGPASSWORD"; } > "${calls}/psql"\n`);
chmodSync(join(bin, 'psql'), 0o755);
const answer = (key, body) => writeFileSync(join(answers, key), body);
const clearCalls = () => readdirSync(calls).forEach((file) => rmSync(join(calls, file)));
const allCalls = () => readdirSync(calls).filter((file) => file.startsWith('call.')).map((file) => readFileSync(join(calls, file), 'utf8'));
const callsOf = (word) => allCalls().filter((call) => call.split('\n')[0] === word);

const endpoints = (port) => Object.fromEntries(Object.entries({ 'database.sql': 'postgres', 'rest.http': 'supabase-api', 'studio.http': 'studio', 'analytics.http': 'analytics', 'mail.http': 'mail', 'mail.smtp': 'mail-smtp', 'mail.pop3': 'mail-pop3', 'functions.inspector': 'functions-inspector' }).map(([key, name]) => [key, { port: port(name) }]));
const startJson = (shift = OFFSET) => JSON.stringify({ id: ID, runtime: 'native', endpoints: endpoints((name) => PORTS[name] + shift), env: { DB_URL: `postgresql://postgres:postgres@127.0.0.1:${5432 + shift}/postgres`, API_URL: `http://127.0.0.1:${5435 + shift}`, MCP_URL: `http://127.0.0.1:${5435 + shift}/mcp` }, message: '' });
const respondsWell = () => {
  answer('start', `cat <<'J'\n${startJson()}\nJ\n`);
  answer('status', `cat <<'J'\n${JSON.stringify({ identity: { id: ID }, owner: 'reachable', lifecycle: 'running', env: { DB_URL: `postgresql://postgres:postgres@127.0.0.1:${5432 + OFFSET}/postgres` } })}\nJ\n`);
  answer('stack-list', `echo '{"stacks":[]}'\n`);
  answer('db-query', `case "$3" in *data_directory*) echo '[{"dir":"${home}/stacks/${ID}/data/m/data"}]' ;; *to_regclass*) echo '[{"ledger":"supabase_migrations.schema_migrations","tables":1}]' ;; *) echo '[]' ;; esac\n`);
};

writeFileSync(join(tree, 'tools/dev/dev.mjs'), `process.stdout.write(process.env.FAKE_PS ?? '[]');\n`);
const row = (extra = {}) => ({ key: `postgres@${OFFSET}`, app: 'postgres', tree, offset: OFFSET, state: 'live', ports: { postgres: 5432 + OFFSET }, stateDir: readyDir, ...extra });
const readyDir = join(scratch, 'ready');
mkdirSync(readyDir);
writeFileSync(join(readyDir, 'postgres.ready'), '');

const baseEnv = (env = {}) => ({ PATH: `${bin}:${process.env.PATH}`, XDG_DATA_HOME: xdg, HOME: scratch, ...env });
const run = (verb, args = [], env = {}) => spawnSync(process.execPath, [join(tree, 'tools/postgres/postgres.mjs'), verb, ...args], { cwd: tree, encoding: 'utf8', env: baseEnv(env), timeout: 30_000 });
const runningStack = () => JSON.stringify([row()]);

let failed = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failed++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${condition ? '' : `: ${detail}`}`);
};

/** A keeper in a process of its own, fd 3 open, as the engine hands it. Stopped by `stopWith`, or left to end. */
function keeper({ env = {}, verb = 'serve' } = {}) {
  const stackDir = join(scratch, `run-${Math.random().toString(16).slice(2)}`, `postgres@${OFFSET}`);
  mkdirSync(stackDir, { recursive: true });
  const child = spawn(process.execPath, [join(tree, 'tools/postgres/postgres.mjs'), verb], { cwd: tree, env: baseEnv({ DEV_STACK_DIR: stackDir, DEV_STACK_TMP: scratch, ...shifted, ...env }), stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (chunk) => (said += chunk));
  child.stderr.on('data', (chunk) => (said += chunk));
  const ended = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, ended, stackDir, said: () => said, ready: () => existsSync(join(stackDir, 'postgres.ready')) };
}
const until = async (test, ms = 15_000) => {
  const deadline = Date.now() + ms;
  while (!test() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  return test();
};
// A process the fake owner.json can name, that reads as the stack's owner in the process table.
const ownerStandIn = () => spawn('bash', ['-c', 'exec -a __supabase_stack_host__ sleep 60'], { stdio: 'ignore' });

try {
  const cli = await import(pathToFileURL(join(tree, 'tools/postgres/supabase-cli.mjs')));
  console.log('the one reader of the CLI');
  check('portGap names what came back other than asked', cli.portGap({ postgres: 1, studio: 2 }, { postgres: 1, studio: 3 }).join() === 'studio 3 (asked 2)');
  check('…and an endpoint a service has not got yet is no gap', cli.portGap({ postgres: 1, 'db-shadow': 2 }, { postgres: 1 }).length === 0);
  for (const [url, what] of [['postgresql://h@db.example.com:5432/x', 'a remote host'], ['postgresql://h@127.0.0.1/x', 'an empty port'], ['nope', 'not a URL']]) {
    let thrown = false;
    try {
      cli.loopbackPort(url, 'it');
    } catch {
      thrown = true;
    }
    check(`loopbackPort refuses ${what}`, thrown);
  }
  check('seedPatterns reads an array over lines, by line', cli.seedPatterns().join() === '../postgres/seed/world/*.sql,./extra.sql', cli.seedPatterns().join());
  check('the launcher\'s base ports are the fragment\'s block', JSON.stringify(cli.PORTS) === JSON.stringify(PORTS));

  console.log('every call');
  respondsWell();
  clearCalls();
  const migrated = run('migrate', [], { FAKE_PS: runningStack(), SUPABASE_HOME: '/hostile', SUPABASE_DB_PORT: '1', PGHOST: 'evil', DATABASE_URL: 'postgres://evil' });
  check('migrate runs', migrated.status === 0, migrated.stderr);
  const up = callsOf('migration')[0] ?? '';
  check('--agent no, so the shape does not depend on who runs it', up.includes('--agent\nno\n'), up);
  check('--workdir, with no ancestor search', up.includes(`--workdir\n${tree}\n`), up);
  check('SUPABASE_HOME is computed, never read: a literal, on the persisted home', up.includes(`SUPABASE_HOME=${home}\n`), up);
  check('no keyring, no telemetry', up.includes('SUPABASE_NO_KEYRING=1') && up.includes('DO_NOT_TRACK=1'), up);
  check('the shell\'s SUPABASE_*, PG* and DATABASE_URL do not reach it', !up.includes('SUPABASE_DB_PORT') && !up.includes('PGHOST') && !up.includes('DATABASE_URL'), up);
  check('a pin never goes with anything but start', !allCalls().some((call) => /SUPABASE_API_PORT/.test(call)));

  console.log('identity');
  answer('status', `cat <<'J'\n${JSON.stringify({ identity: { id: ID }, env: { DB_URL: 'postgresql://postgres:postgres@127.0.0.1:1234/postgres' } })}\nJ\n`);
  let refused = run('migrate', [], { FAKE_PS: runningStack() });
  check('the CLI answering on another port than the stack\'s is refused', refused.status !== 0 && /answers on 1234/.test(refused.stderr), refused.stderr);
  respondsWell();
  answer('db-query', `echo '[{"dir":"/elsewhere/data"}]'\n`);
  refused = run('migrate', [], { FAKE_PS: runningStack() });
  check('a server keeping its data elsewhere is refused', refused.status !== 0 && /not in this stack/.test(refused.stderr), refused.stderr);
  respondsWell();

  console.log('the doors');
  for (const [file, body] of [['.env', 'SUPABASE_DB_PORT=1\n'], ['.env.local', 'export SUPABASE_ACCESS_TOKEN=x\n'], ['supabase/.env', 'SUPABASE_ENV: prod\n']]) {
    writeFileSync(join(tree, file), body);
    refused = run('migrate', [], { FAKE_PS: runningStack() });
    check(`${file} setting SUPABASE_* is refused, by name`, refused.status !== 0 && refused.stderr.includes(file) && /SUPABASE_/.test(refused.stderr), refused.stderr);
    rmSync(join(tree, file));
  }
  writeFileSync(join(tree, '.env'), 'MY_SECRET=1\n');
  check('another name in .env is the project\'s', run('migrate', [], { FAKE_PS: runningStack() }).status === 0);
  rmSync(join(tree, '.env'));

  console.log('migrations');
  writeFileSync(join(tree, 'supabase/migrations/20260101000000_ok.sql'), '-- migrate:up\nselect 1;\n\n-- migrate:down\n');
  check('the moved shape, markers and all, is accepted', run('migrate', [], { FAKE_PS: runningStack() }).status === 0);
  writeFileSync(join(tree, 'supabase/migrations/notamigration.sql'), 'select 1;\n');
  refused = run('migrate', [], { FAKE_PS: runningStack() });
  check('a file the CLI would skip in silence is refused', refused.status !== 0 && /notamigration/.test(refused.stderr), refused.stderr);
  rmSync(join(tree, 'supabase/migrations/notamigration.sql'));
  writeFileSync(join(tree, 'supabase/migrations/20260102000000_down.sql'), 'select 1;\n-- migrate:down\ndrop table x;\n');
  refused = run('migrate', [], { FAKE_PS: runningStack() });
  check('a non-empty down is refused: the CLI would run it as part of the migration', refused.status !== 0 && /forward-only/.test(refused.stderr), refused.stderr);
  rmSync(join(tree, 'supabase/migrations/20260102000000_down.sql'));
  const made = run('new-migration', ['--name=add_users']);
  const created = readdirSync(join(tree, 'supabase/migrations')).find((name) => name.endsWith('_add_users.sql'));
  check('new-migration writes into the CLI\'s folder, later than the last', made.status === 0 && /^\d{14}_add_users\.sql$/.test(created ?? '') && created > '20260101000000', made.stderr);
  rmSync(join(tree, 'supabase/migrations', created));

  console.log('seed and client');
  writeFileSync(join(tree, 'postgres/seed/world/02.sql'), 'select 2;\n');
  writeFileSync(join(tree, 'postgres/seed/world/01.sql'), 'select 1;\n');
  writeFileSync(join(tree, 'postgres/seed/world/note.txt'), 'no\n');
  writeFileSync(join(tree, 'supabase/extra.sql'), 'select 3;\n');
  const seeded = run('seed', [], { FAKE_PS: runningStack() });
  const psql = readFileSync(join(calls, 'psql'), 'utf8');
  check('seed: what config.toml names, in order, in one transaction, in its database', seeded.status === 0 && /--single-transaction\n-f\n\.\.\/postgres\/seed\/world\/01\.sql\n-f\n\.\.\/postgres\/seed\/world\/02\.sql\n-f\nextra\.sql/.test(psql) && psql.includes('-d\npostgres\n') && psql.includes(`-p\n${5432 + OFFSET}\n`), `${seeded.stderr}\n${psql}`);
  rmSync(join(tree, 'postgres/seed/world/note.txt'));
  rmSync(join(tree, 'supabase/extra.sql'));
  run('psql', ['--sql=select 1'], { FAKE_PS: runningStack() });
  const client = readFileSync(join(calls, 'psql'), 'utf8');
  check('psql: its database, the stack\'s port, the local password', client.includes('-d\npostgres\n') && client.includes(`-p\n${5432 + OFFSET}\n`) && client.includes('--pw=postgres'), client);

  console.log('the deploy');
  const noAgent = { CI: 'true' };
  const URL_ = 'postgresql://postgres.ref:p%40ss%3Aw@aws-0-eu.pooler.supabase.com:5432/postgres?sslmode=require';
  clearCalls();
  answer('db-push', `cat "$PGPASSFILE" > "${calls}/passfile"; stat -c %a "$PGPASSFILE" > "${calls}/passmode"; echo "pushed to ${URL_}"\n`);
  const deployed = run('deploy', [], { ...noAgent, POSTGRES_DEPLOY_URL: URL_ });
  const push = callsOf('db')[0] ?? '';
  check('db push --remote --yes', deployed.status === 0 && push.includes('push\n') && push.includes('--yes\n') && /--remote=postgresql:\/\/postgres\.ref@aws-0-eu\.pooler\.supabase\.com:5432\/postgres\?sslmode=require\n/.test(push), `${deployed.stderr}\n${push}`);
  check('the password is not in argv', !push.includes('p%40ss') && !push.includes('p@ss'), push);
  check('a private passfile, the password decoded and escaped', readFileSync(join(calls, 'passfile'), 'utf8') === '*:*:*:*:p@ss\\:w\n' && readFileSync(join(calls, 'passmode'), 'utf8').trim() === '600', readFileSync(join(calls, 'passfile'), 'utf8'));
  check('what it says back is masked', !deployed.stdout.includes('p%40ss'), deployed.stdout);
  check('the passfile is gone', !readdirSync(tmpdir()).some((name) => name.startsWith('bespunky-supabase-') && existsSync(join(tmpdir(), name, 'pgpass')) && readFileSync(join(tmpdir(), name, 'pgpass'), 'utf8').includes('p@ss')));
  refused = run('deploy', [], { ...noAgent, CLAUDECODE: '1', POSTGRES_DEPLOY_URL: URL_ });
  check('an agent cannot, whatever CI says', refused.status !== 0 && /not an agent/.test(refused.stderr), refused.stderr);
  refused = run('deploy', [], { ...noAgent, POSTGRES_DEPLOY_URL: 'postgresql://u:p@host.pooler.supabase.com:6543/postgres' });
  check('the transaction pooler is refused', refused.status !== 0 && /pooler/.test(refused.stderr), refused.stderr);
  refused = run('deploy', [], { POSTGRES_DEPLOY_URL: URL_ });
  check('outside CI, with no terminal, it asks and cannot', refused.status !== 0 && /terminal/.test(refused.stderr), refused.stderr);
  answer('db-push', 'exit 1\n');
  refused = run('deploy', [], { ...noAgent, POSTGRES_DEPLOY_URL: URL_ });
  check('a failed push fails the deploy', refused.status !== 0 && /failed/.test(refused.stderr), refused.stderr);

  console.log('the keeper');
  const owner = ownerStandIn();
  await until(() => {
    try {
      return readFileSync(`/proc/${owner.pid}/cmdline`, 'latin1').includes('__supabase_stack_host__');
    } catch {
      return false;
    }
  });
  writeFileSync(join(home, 'stacks', ID, 'owner.json'), JSON.stringify({ pid: owner.pid }));

  respondsWell();
  clearCalls();
  let k = keeper();
  check('it reaches ready', await until(k.ready), k.said());
  const started = callsOf('start')[0] ?? '';
  check('start: native, never eager, every port pinned', started.includes('--runtime\nnative\n') && !started.includes('--eager') && Object.entries({ SUPABASE_DB_PORT: 'postgres', SUPABASE_DB_SHADOW_PORT: 'db-shadow', SUPABASE_DB_POOLER_PORT: 'db-pooler', SUPABASE_API_PORT: 'supabase-api', SUPABASE_STUDIO_PORT: 'studio', SUPABASE_ANALYTICS_PORT: 'analytics', SUPABASE_LOCAL_SMTP_PORT: 'mail', SUPABASE_LOCAL_SMTP_SMTP_PORT: 'mail-smtp', SUPABASE_LOCAL_SMTP_POP3_PORT: 'mail-pop3', SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT: 'functions-inspector' }).every(([pin, name]) => started.includes(`${pin}=${PORTS[name] + OFFSET}\n`)), started);
  check('a start migrates what is pending', callsOf('migration').length === 1);
  check('it names the local MCP, not a hosted one', /claude mcp add --transport http --scope local supabase-local http:\/\/127\.0\.0\.1/.test(k.said()) && !/mcp\.supabase\.com/.test(k.said()), k.said());
  clearCalls();
  k.child.kill('SIGTERM');
  check('a signal stops the stack, exit 0', (await k.ended) === 0 && callsOf('stop').length === 1, k.said());
  check('the lock is let go', !existsSync(join(xdg, 'bespunky/postgres', readdirSync(join(xdg, 'bespunky/postgres'))[0], 'supabase.lock')));

  // Reported ports other than asked: moved once, then refused, never believed.
  respondsWell();
  clearCalls();
  writeFileSync(join(scratch, 'start-count'), '0');
  answer('start', `c=$(cat "${scratch}/start-count"); echo $((c+1)) > "${scratch}/start-count"; if [ "$c" = 0 ]; then cat <<'J'\n${startJson(1000)}\nJ\nelse cat <<'J'\n${startJson()}\nJ\nfi\n`);
  k = keeper();
  check('a stack on other ports, with no claim on them, is moved', await until(k.ready) && callsOf('stop').length === 1 && callsOf('start').length === 2 && /adopting/.test(k.said()), k.said());
  k.child.kill('SIGTERM');
  await k.ended;

  respondsWell();
  clearCalls();
  answer('start', `cat <<'J'\n${startJson(1000)}\nJ\n`);
  k = keeper();
  check('ports that will not move are a refusal, with the stack stopped', (await k.ended) !== 0 && /did not take the ports/.test(k.said()) && callsOf('stop').length === 2, k.said());

  // A half-built stack, and what is not one.
  respondsWell();
  clearCalls();
  answer('db-query', `case "$3" in *data_directory*) echo '[{"dir":"${home}/stacks/${ID}/data/m/data"}]' ;; *) if [ -f "${scratch}/was-reset" ]; then echo '[{"ledger":"x","tables":1}]'; else echo '[{"ledger":null,"tables":0}]'; fi ;; esac\n`);
  answer('db-reset', `touch "${scratch}/was-reset"\n`);
  k = keeper();
  check('migrations, no ledger, no tables: rebuilt by a reset, before ready', await until(k.ready) && callsOf('db').some((call) => call.startsWith('db\nreset\n')) && /interrupted/.test(k.said()), k.said());
  k.child.kill('SIGTERM');
  await k.ended;
  rmSync(join(scratch, 'was-reset'));

  respondsWell();
  clearCalls();
  answer('db-query', `case "$3" in *data_directory*) echo '[{"dir":"${home}/stacks/${ID}/data/m/data"}]' ;; *) echo '[{"ledger":null,"tables":3}]' ;; esac\n`);
  k = keeper();
  check('tables and no ledger is a first migration arriving, and keeps its rows', await until(k.ready) && !callsOf('db').some((call) => call.startsWith('db\nreset\n')), k.said());
  k.child.kill('SIGTERM');
  await k.ended;

  respondsWell();
  clearCalls();
  const onlySql = readdirSync(join(tree, 'supabase/migrations')).filter((name) => name.endsWith('.sql'));
  onlySql.forEach((name) => rmSync(join(tree, 'supabase/migrations', name)));
  answer('db-query', `case "$3" in *data_directory*) echo '[{"dir":"${home}/stacks/${ID}/data/m/data"}]' ;; *) echo '[{"ledger":null,"tables":0}]' ;; esac\n`);
  k = keeper();
  check('no migrations, no ledger: there is nothing to rebuild', await until(k.ready) && !callsOf('db').some((call) => call.startsWith('db\nreset\n')), k.said());
  k.child.kill('SIGTERM');
  await k.ended;
  onlySql.forEach((name) => writeFileSync(join(tree, 'supabase/migrations', name), '-- migrate:up\nselect 1;\n\n-- migrate:down\n'));

  // A wedged stack: named, with the road; a reset takes the road.
  respondsWell();
  clearCalls();
  answer('start', `echo 'partial lifecycle state: .supabase-postgres-init-pending' >&2; exit 1\n`);
  k = keeper();
  check('a start that cannot recover names postgres:reset', (await k.ended) !== 0 && /left half-built/.test(k.said()) && /reset/.test(k.said()) && !callsOf('stack').length, k.said());
  writeFileSync(join(scratch, 'destroyed'), '');
  rmSync(join(scratch, 'destroyed'));
  answer('stack-destroy', `touch "${scratch}/destroyed"\n`);
  answer('start', `if [ -f "${scratch}/destroyed" ]; then cat <<'J'\n${startJson()}\nJ\nelse echo 'partial lifecycle state' >&2; exit 1; fi\n`);
  answer('db-reset', '');
  clearCalls();
  k = keeper({ verb: 'serve-reset' });
  check('a reset rebuilds it, and stops', (await k.ended) === 0 && callsOf('stack').some((call) => call.startsWith('stack\ndestroy\n')) && callsOf('db').some((call) => call.startsWith('db\nreset\n')) && callsOf('stop').length === 1, k.said());

  // The block, the claim, the declaration.
  respondsWell();
  k = keeper({ env: { PORT_STUDIO: '25000' } });
  check('a port in what the runtime keeps is refused', (await k.ended) !== 0 && /10000-32767/.test(k.said()), k.said());
  k = keeper({ env: { PORT_SUPABASE_API: '' } });
  check('a stack declaring too few ports is refused, naming the upgrade', (await k.ended) !== 0 && /supabase-api/.test(k.said()) && /upgrade/.test(k.said()), k.said());
  k = keeper({ env: { FAKE_PS: JSON.stringify([row({ key: 'web@2000', offset: 2000 })]) } });
  check('a second stack in a tree is refused, naming the one that runs', (await k.ended) !== 0 && /web@2000/.test(k.said()), k.said());
  writeFileSync(join(scratch, 'version'), '1.2.3\n');
  k = keeper();
  check('another CLI than the pin is refused', (await k.ended) !== 0 && /1\.2\.3/.test(k.said()) && /Rebuild/.test(k.said()), k.said());
  rmSync(join(scratch, 'version'));

  // The owner gone: the keeper says so, and fails.
  respondsWell();
  clearCalls();
  k = keeper();
  await until(k.ready);
  owner.kill('SIGKILL');
  check('the owner gone unasked ends the keeper as a failure, without a stop', (await k.ended) === 1 && callsOf('stop').length === 0 && /owner went away/.test(k.said()), k.said());

  console.log('types, functions, hosted secrets');
  respondsWell();
  answer('gen', `printf 'export type Database = {}\\n'; echo 'Target: local' >&2\n`);
  clearCalls();
  let said2 = run('gen-types', [], { FAKE_PS: runningStack() });
  check('gen-types: stdout alone, to the default path', said2.status === 0 && readFileSync(join(tree, 'supabase/types/database.ts'), 'utf8') === 'export type Database = {}\n', said2.stderr);
  check('…in the language asked, through the launcher\'s address', (callsOf('gen')[0] ?? '').includes('--lang\ntypescript\n'), callsOf('gen')[0]);
  mkdirSync(join(tree, '.bespunky'), { recursive: true });
  writeFileSync(join(tree, '.bespunky/supabase.json'), '{ "types": { "out": "libs/db/types.py", "lang": "python", "schema": "public,app" } }\n');
  clearCalls();
  said2 = run('gen-types', [], { FAKE_PS: runningStack() });
  const genCall = callsOf('gen')[0] ?? '';
  check('the project\'s declared path, language and schemas', said2.status === 0 && existsSync(join(tree, 'libs/db/types.py')) && genCall.includes('--lang\npython\n') && genCall.includes('--schema\npublic,app\n'), `${said2.stderr}\n${genCall}`);
  said2 = run('gen-types', ['--out=x/y.ts', '--lang=go'], { FAKE_PS: runningStack() });
  check('a flag wins, for one run', said2.status === 0 && existsSync(join(tree, 'x/y.ts')), said2.stderr);
  for (const out of ['../outside.ts', '/etc/outside.ts']) {
    said2 = run('gen-types', [`--out=${out}`], { FAKE_PS: runningStack() });
    check(`a path outside the tree is refused: ${out}`, said2.status !== 0 && /inside this tree/.test(said2.stderr), said2.stderr);
  }
  rmSync(join(tree, '.bespunky/supabase.json'));
  writeFileSync(join(tree, 'supabase/types/database.ts'), 'kept\n');
  answer('gen', `printf 'half'; echo boom >&2; exit 1\n`);
  said2 = run('gen-types', [], { FAKE_PS: runningStack() });
  check('a failed run keeps the old file', said2.status !== 0 && readFileSync(join(tree, 'supabase/types/database.ts'), 'utf8') === 'kept\n' && /boom/.test(said2.stderr), said2.stderr);
  rmSync(join(tree, 'supabase/types'), { recursive: true });
  rmSync(join(tree, 'libs'), { recursive: true });
  rmSync(join(tree, 'x'), { recursive: true });
  said2 = run('gen-types', [], {});
  check('no stack: says which verb starts one', said2.status !== 0 && /Start one/.test(said2.stderr), said2.stderr);

  clearCalls();
  answer('functions', `cat > "${calls}/functions-stdin"\n`);
  said2 = run('new-function', ['--name=hello']);
  check('new-function: the CLI\'s own, declining its offer to rewrite .vscode', said2.status === 0 && readFileSync(join(calls, 'functions-stdin'), 'utf8') === 'n\n' && (callsOf('functions')[0] ?? '').startsWith('functions\nnew\nhello\n'), said2.stderr);
  said2 = run('new-function', ['--name=../evil']);
  check('…and a name is a name', said2.status !== 0, said2.stdout);

  const REF = 'abcdefghijklmnopqrst';
  said2 = run('secrets-set', [`--project-ref=${REF}`, '--name=A'], { CLAUDECODE: '1' });
  check('secrets-set: refused under an agent', said2.status !== 0 && /not an agent/.test(said2.stderr), said2.stderr);
  said2 = run('secrets-set', [`--project-ref=${REF}`, '--name=A'], {});
  check('…refused with no terminal', said2.status !== 0 && /terminal/.test(said2.stderr), said2.stderr);
  said2 = run('secrets-set', ['--name=A'], {});
  check('…needs a project named', said2.status !== 0 && /project-ref/.test(said2.stderr), said2.stderr);
  said2 = run('secrets-set', ['--project-ref=https://evil', '--name=A'], {});
  check('…a ref, never a URL', said2.status !== 0 && /ref/.test(said2.stderr) && !/https:/.test(said2.stderr), said2.stderr);
  for (const name of ['SUPABASE_X', 'A=b']) {
    said2 = run('secrets-set', [`--project-ref=${REF}`, `--name=${name}`], {});
    check(`…refuses the name ${name}`, said2.status !== 0, said2.stderr);
  }
  // At a real terminal: the value is not echoed, not in argv, not in a file, not printed. `script` gives it a pty.
  answer('secrets', `cat > "${calls}/secrets-stdin"; echo "set with TOPSECRETVALUE"\n`);
  clearCalls();
  const launcherPath = join(tree, 'tools/postgres/postgres.mjs');
  // Typed once it is asking, as a person would: the terminal itself echoes what is typed ahead of the prompt.
  const typed = spawnSync('sh', ['-c', `(sleep 1; printf 'TOPSECRETVALUE\\r'; sleep 2) | script -qec '${process.execPath} ${launcherPath} secrets-set --project-ref=${REF} --name=MY_KEY' /dev/null`], { cwd: tree, encoding: 'utf8', env: baseEnv({ SUPABASE_ACCESS_TOKEN: 'sbp_x' }), timeout: 20_000 });
  const secretCall = callsOf('secrets')[0] ?? '';
  check('the value goes down the pipe, for the CLI\'s /dev/stdin', readFileSync(join(calls, 'secrets-stdin'), 'utf8') === "MY_KEY='TOPSECRETVALUE'\n", typed.stdout);
  check('never argv', secretCall.includes('--env-file\n/dev/stdin\n') && secretCall.includes(`--remote=${REF}\n`) && secretCall.includes('--yes\n') && !secretCall.split('--env')[0].includes('TOPSECRETVALUE'), secretCall);
  check('never echoed, never printed', !typed.stdout.includes('TOPSECRETVALUE') && /set MY_KEY on/.test(typed.stdout), typed.stdout);
  check('the shell\'s token is handed on', secretCall.includes('SUPABASE_ACCESS_TOKEN=sbp_x'), secretCall);
  const { secretLine, functionNames } = await import(pathToFileURL(join(tree, 'tools/postgres/supabase-provider.mjs')));
  check('a value with all three quotes is refused: the CLI\'s env file has no escape', (() => { try { secretLine('A', `'"\``); return false; } catch { return true; } })());
  check('a value with a line break is refused', (() => { try { secretLine('A', 'x\ny'); return false; } catch { return true; } })());

  console.log('a deploy with functions');
  mkdirSync(join(tree, 'supabase/functions/hello'), { recursive: true });
  mkdirSync(join(tree, 'supabase/functions/_shared'), { recursive: true });
  check('_shared is not a function', functionNames().join() === 'hello', functionNames().join());
  const URL2 = 'postgresql://postgres.ref:pw@aws-0-eu.pooler.supabase.com:5432/postgres?sslmode=require';
  answer('db-push', 'echo pushed\n');
  answer('functions', 'echo shipped\n');
  clearCalls();
  said2 = run('deploy', [], { CI: 'true', POSTGRES_DEPLOY_URL: URL2, SUPABASE_ACCESS_TOKEN: 'sbp_x' });
  check('no ref: refused before anything is pushed', said2.status !== 0 && /project-ref/.test(said2.stderr) && !allCalls().length, said2.stderr);
  said2 = run('deploy', [`--project-ref=${REF}`], { CI: 'true', POSTGRES_DEPLOY_URL: URL2 });
  check('no token in CI: refused before anything is pushed', said2.status !== 0 && /SUPABASE_ACCESS_TOKEN/.test(said2.stderr) && !allCalls().length, said2.stderr);
  said2 = run('deploy', [`--project-ref=${REF}`], { CLAUDECODE: '1', CI: 'true', POSTGRES_DEPLOY_URL: URL2, SUPABASE_ACCESS_TOKEN: 'sbp_x' });
  check('an agent cannot, with functions either', said2.status !== 0 && /not an agent/.test(said2.stderr) && !allCalls().length, said2.stderr);
  said2 = run('deploy', [`--project-ref=${REF}`], { CI: 'true', POSTGRES_DEPLOY_URL: URL2, SUPABASE_ACCESS_TOKEN: 'sbp_x' });
  const pushedAt = allCalls().find((call) => call.startsWith('db\npush\n')) ?? '';
  const shipped = callsOf('functions')[0] ?? '';
  check('the schema, then the functions, bundled on Supabase\'s side', said2.status === 0 && Boolean(pushedAt) && shipped.startsWith('functions\ndeploy\n--use-api\n') && shipped.includes(`--remote=${REF}\n`) && shipped.includes('--yes\n') && said2.stdout.indexOf('pushed') < said2.stdout.indexOf('shipped'), `${said2.stderr}\n${shipped}`);
  check('the database credential does not go with the functions, nor the token with the push', !shipped.includes('PGPASSFILE') && !pushedAt.includes('SUPABASE_ACCESS_TOKEN'), `${shipped}\n${pushedAt}`);
  rmSync(join(tree, 'supabase/functions'), { recursive: true });

  console.log('the preflight');
  const probe = (cwd, ...args) => spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(GENERATORS, '../../../house-probe.mts'), ...args], { cwd, encoding: 'utf8' });
  const project = join(scratch, 'probed');
  mkdirSync(join(project, '.bespunky'), { recursive: true });
  writeFileSync(join(project, '.bespunky/postgres.json'), '{ "major": 18 }\n');
  check('a project declaring 18 is refused, with the fix', /^supabase-major-mismatch\t.*"major": 17/.test(probe(project, '--ensure=supabase').stdout), probe(project, '--ensure=supabase').stdout);
  check('…and only where supabase is in play', probe(project, '--ensure=postgres').stdout === '', probe(project, '--ensure=postgres').stdout);
  writeFileSync(join(project, '.bespunky/postgres.json'), '{ "major": 17 }\n');
  check('17 passes', probe(project, '--ensure=supabase').stdout === '', probe(project, '--ensure=supabase').stdout);
  mkdirSync(join(project, 'supabase/migrations'), { recursive: true });
  mkdirSync(join(project, 'postgres/migrations'), { recursive: true });
  writeFileSync(join(project, 'supabase/config.toml'), '[db]\nmajor_version = 16\n[inbucket]\nenabled = true\n');
  writeFileSync(join(project, 'postgres/migrations/1_a.sql'), '');
  writeFileSync(join(project, 'supabase/migrations/1_a.sql'), '');
  const said = probe(project, '--evident=postgres,supabase').stdout;
  check('a config it cannot run, a v2 config, and two folders are refused before anything is written', /^supabase-major-mismatch\t/m.test(said) && /^supabase-config-outdated\t/m.test(said) && /^supabase-migrations-twice\t/m.test(said), said);

  // The lock.
  console.log('the lock');
  const { withStackLock } = await import(pathToFileURL(join(tree, 'tools/postgres/supabase-keeper.mjs')));
  process.env.XDG_DATA_HOME = xdg;
  const order = [];
  await Promise.all([
    withStackLock(async () => {
      order.push('a in');
      await new Promise((resolve) => setTimeout(resolve, 300));
      order.push('a out');
    }),
    new Promise((resolve) => setTimeout(resolve, 50)).then(() => withStackLock(async () => order.push('b'))),
  ]);
  check('one at a time', order.join() === 'a in,a out,b', order.join());
  const treeHome = join(xdg, 'bespunky/postgres', readdirSync(join(xdg, 'bespunky/postgres')).find((name) => !name.startsWith('.')));
  writeFileSync(join(treeHome, 'supabase.lock'), '1 not-its-start-time\n');
  check('a holder that is gone does not hold it', await Promise.race([withStackLock(async () => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))]));
  const holder = spawn('sleep', ['20'], { stdio: 'ignore' });
  const stat = readFileSync(`/proc/${holder.pid}/stat`, 'latin1');
  writeFileSync(join(treeHome, 'supabase.lock'), `${holder.pid} ${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}\n`);
  check('a live holder does, and `giveUp` is how to stop waiting', (await withStackLock(async () => 'ran', { giveUp: () => true })) === undefined);
  holder.kill('SIGKILL');
  rmSync(join(treeHome, 'supabase.lock'), { force: true });
  // Where PID 1 reaps nothing (a container with no init, a CI job's), a holder killed as an orphan stays in the table for good, its start time and all.
  const parent = spawn('sh', ['-c', 'sleep 0.05 & echo $!; exec sleep 20'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const zombie = (await new Promise((resolve) => parent.stdout.once('data', resolve))).toString().trim();
  const fieldsOf = () => {
    const raw = readFileSync(`/proc/${zombie}/stat`, 'latin1');
    return raw.slice(raw.lastIndexOf(')') + 2).split(' ');
  };
  for (let waited = 0; fieldsOf()[0] !== 'Z' && waited < 40; waited++) await new Promise((resolve) => setTimeout(resolve, 50));
  writeFileSync(join(treeHome, 'supabase.lock'), `${zombie} ${fieldsOf()[19]}\n`);
  check('a zombie holder does not hold it', fieldsOf()[0] === 'Z' && (await Promise.race([withStackLock(async () => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))])));
  parent.kill('SIGKILL');
  rmSync(join(treeHome, 'supabase.lock'), { force: true });
} catch (error) {
  failed += 1;
  console.error(`FAIL ${error.stack ?? error}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(failed ? `FAILED: ${failed}` : 'ok');
process.exit(failed ? 1 : 0);
