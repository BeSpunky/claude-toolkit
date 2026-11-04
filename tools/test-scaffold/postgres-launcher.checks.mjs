// The Postgres launcher's decisions, with no database: fakes on PATH and a fake `tools/dev/dev.mjs` saying what runs. Whatever
// would regress SILENTLY: an address, a refusal, what a child is handed. What needs real binaries is tools/test-postgres.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FILES = join(dirname(fileURLToPath(import.meta.url)), '../../plugins/house/engine/nx-tools/src/generators/postgres/files');
const scratch = mkdtempSync(join(tmpdir(), 'postgres-launcher-'));
const tree = join(scratch, 'tree');
const bin = join(scratch, 'bin');
const calls = join(scratch, 'calls');
const xdg = join(scratch, 'xdg');
for (const dir of [join(tree, 'tools/postgres'), join(tree, 'tools/dev'), join(tree, 'postgres/migrations'), join(tree, 'postgres/seed/world'), join(tree, '.bespunky'), bin, calls]) mkdirSync(dir, { recursive: true });
for (const file of readdirSync(FILES)) cpSync(join(FILES, file), join(tree, 'tools/postgres', file.replace(/\.tpl$/, '')));
writeFileSync(join(tree, '.bespunky/postgres.json'), '{ "major": 18 }\n');

// A fake tool records its argv and the environment names a local verb must have scrubbed, and answers as it is told.
const fake = (name, body = '') =>
  writeFileSync(join(bin, name), `#!/bin/sh\n{ printf '%s\\n' "$@"; echo "--cwd=$PWD"; env | grep -E '^(PG[A-Z]|DBMATE_|DATABASE_URL|DIRECT_DATABASE_URL|POSTGRES_DEPLOY_URL)' ; } > "${calls}/${name}.$$"\n${body}\nexit 0\n`, { mode: 0o755 });
fake('dbmate');
fake('psql', `case "$*" in *pg_control_system*) cat "${scratch}/answer" ;; esac`);
const say = (answer) => writeFileSync(join(scratch, 'answer'), `${answer}\n`);
const stacksAre = (rows) => writeFileSync(join(tree, 'tools/dev/dev.mjs'), `process.stdout.write(${JSON.stringify(JSON.stringify(rows))});\n`);
const row = (offset, extra = {}) => ({ key: `postgres@${offset}`, app: 'postgres', tree, offset, state: 'live', ports: { postgres: 5432 + offset }, ...extra });

const run = (verb, args = [], env = {}) =>
  spawnSync(process.execPath, [join(tree, 'tools/postgres/postgres.mjs'), verb, ...args], { cwd: tree, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, XDG_DATA_HOME: xdg, HOME: scratch, ...env } });
const lastCall = (name) => {
  const found = readdirSync(calls).filter((file) => file.startsWith(`${name}.`));
  return found.map((file) => readFileSync(join(calls, file), 'utf8'));
};
const clearCalls = () => readdirSync(calls).forEach((file) => rmSync(join(calls, file)));

let failed = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failed++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${condition ? '' : `: ${detail}`}`);
};

// ── the URL a deploy is handed ──
const { parseDeployUrl } = await import(pathToFileURL(join(tree, 'tools/postgres/url.mjs')));
for (const [url, why] of [
  ['postgresql://u:p@host:/db', /empty port/],
  ['postgresql://u:p@/db', /no host/],
  ['postgresql:///db', /no host/],
  ['postgresql://a:1,b:2/db', /several hosts/],
  ['postgresql://host:5432', /no database/],
  ['postgresql://host:99999/db', /port/],
  ['postgresql://host:abc/db', /port/],
  ['postgresql://host:5432/db?host=other', /`host`/],
  ['postgresql://host:5432/db?hostaddr=1.2.3.4', /`hostaddr`/],
  ['postgresql://host:5432/db?service=prod', /`service`/],
  ['mysql://host/db', /postgres/],
  ['', /postgres/],
]) {
  let message = '';
  try {
    parseDeployUrl(url);
  } catch (error) {
    message = error.message;
  }
  check(`refused: ${url || '(empty)'}`, why.test(message) && !message.includes(':p@'), message);
}
const good = parseDeployUrl('postgresql://user:p%40ss@db.example.com:6000/shop?sslmode=require');
check('a good URL: host, port, database, and a display with no password', good.display === 'db.example.com:6000/shop' && good.password === 'p%40ss');
check('no port is the default said out loud, not an error', parseDeployUrl('postgres://db.example.com/shop').display === 'db.example.com:5432/shop');
check('an IPv6 host', parseDeployUrl('postgresql://[::1]:6000/shop').host === '[::1]');
check('a password holding @ and :', parseDeployUrl('postgresql://u:a@b:c@host:1/d').password === 'a@b:c');
for (const pooled of ['postgres://u@h:6543/d', 'postgres://u@h/d?pgbouncer=true', 'postgres://u@ep-x-pooler.neon.tech/d']) check(`a transaction pooler is recognised: ${pooled}`, parseDeployUrl(pooled).pooled);
check('a session pooler on 5432 is not', !parseDeployUrl('postgres://u@aws-0.pooler.supabase.com:5432/d').pooled);

// ── which server a verb means ──
const identityAt = (key) => {
  const home = join(xdg, 'bespunky/postgres');
  const { createHash } = globalThis.__crypto;
  const hash = createHash('sha256').update(tree).digest('hex').slice(0, 16);
  const dir = join(home, hash, key, '18');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'identity'), '777\n');
};
globalThis.__crypto = await import('node:crypto');
say(777);

stacksAre([]);
let result = run('migrate');
check('none running: names the target that starts one', result.status !== 0 && /postgres:start/.test(result.stderr), result.stderr);

stacksAre([row(100, { tree: join(scratch, 'elsewhere') })]);
result = run('reset');
check('another tree\'s stack is not this tree\'s', result.status !== 0 && /postgres:start/.test(result.stderr), result.stderr);

stacksAre([{ ...row(100), ports: { web: 4300 } }]);
result = run('reset');
check('a stack with no Postgres port is not addressed', result.status !== 0 && /postgres:start/.test(result.stderr), result.stderr);

stacksAre([row(100), row(200)]);
result = run('reset');
check('several: refused, listing each, asking for --offset', result.status !== 0 && /--offset/.test(result.stderr) && /postgres@100/.test(result.stderr) && /postgres@200/.test(result.stderr), result.stderr);
result = run('reset', ['--offset=300']);
check('an offset that is not running: refused, listing what is', result.status !== 0 && /postgres@100/.test(result.stderr), result.stderr);
result = run('migrate', ['--offset=abc']);
check('a non-numeric offset: refused', result.status !== 0 && /whole number/.test(result.stderr), result.stderr);

stacksAre([row(100, { state: 'orphaned' })]);
result = run('reset');
check('an orphan is not usable, and dev ps is named', result.status !== 0 && /dev ps/.test(result.stderr) && /orphaned/.test(result.stderr), result.stderr);

stacksAre([row(100, { waitingFor: 'postgres' })]);
result = run('reset');
check('a starting stack: try again', result.status !== 0 && /still starting/.test(result.stderr), result.stderr);

// ── identity ──
stacksAre([row(100)]);
clearCalls();
result = run('reset');
check('no recorded identity: fails closed', result.status !== 0 && /no recorded identity/.test(result.stderr), result.stderr);
identityAt('postgres@100');
say(888);
clearCalls();
result = run('reset');
check('a different identifier: refused, and nothing was dropped', result.status !== 0 && /not the one/.test(result.stderr) && !lastCall('psql').some((call) => call.includes('DROP')), result.stderr);
writeFileSync(join(scratch, 'answer'), '');
result = run('reset');
check('no answer: refused', result.status !== 0 && /not the one|Could not read/.test(result.stderr), result.stderr);
say(777);

// ── what a local verb hands its children ──
writeFileSync(join(tree, 'postgres/migrations/20260101000000_a.sql'), '-- migrate:up\nSELECT 1;\n-- migrate:down\n');
writeFileSync(join(tree, '.env'), 'DATABASE_URL=postgresql://decoy/x\nPGHOST=decoy\n');
clearCalls();
result = run('migrate', [], { PGHOST: 'decoy', PGPORT: '1', PGSERVICE: 'prod', PGPASSFILE: '/x', DATABASE_URL: 'postgresql://decoy/x', DIRECT_DATABASE_URL: 'x', DBMATE_MIGRATIONS_DIR: '/x', DBMATE_STRICT: 'false', POSTGRES_DEPLOY_URL: 'postgresql://prod/x' });
const [dbmate] = lastCall('dbmate');
check('migrate succeeds', result.status === 0, result.stderr);
check('dbmate gets the stack\'s complete URL', dbmate?.includes('--url\npostgresql://postgres@127.0.0.1:5532/app?sslmode=disable'), dbmate);
check('an empty env file, explicit paths, no schema dump, the lock, strict', ['--env-file', `-d\n${join(tree, 'postgres/migrations')}`, '--no-dump-schema', '--migration-lock', 'migrate\n--strict'].every((part) => dbmate?.includes(part)), dbmate);
const envFile = /--env-file\n(.*)\n/.exec(dbmate ?? '')?.[1] ?? '';
check('its cwd is outside the tree', !/--cwd=.*\/tree/.test(dbmate ?? '') && Boolean(envFile), dbmate);
check('nothing of PG*, DBMATE_* or a URL reaches any child', ![...lastCall('dbmate'), ...lastCall('psql')].some((call) => /^(PG[A-Z]|DBMATE_|DATABASE_URL|DIRECT_DATABASE_URL|POSTGRES_DEPLOY_URL)/m.test(call)), dbmate);
rmSync(join(tree, '.env'));

// ── verbs refuse what they do not take ──
for (const [verb, flag] of [['migrate', '--url=postgresql://prod/x'], ['reset', '--host=prod'], ['seed', '--database-url=x'], ['psql', '--host=prod'], ['psql', '-h'], ['deploy', '--url=x']]) {
  result = run(verb, [flag]);
  check(`${verb} ${flag}: refused`, result.status !== 0 && /not an option/.test(result.stderr), result.stderr);
}

// ── the migration format ──
const MIGRATIONS = join(tree, 'postgres/migrations');
const refusesFile = (name, body, why) => {
  writeFileSync(join(MIGRATIONS, name), body);
  clearCalls();
  const refused = run('migrate');
  check(`refused before dbmate: ${name}`, refused.status !== 0 && why.test(refused.stderr) && lastCall('dbmate').length === 0, refused.stderr);
  rmSync(join(MIGRATIONS, name));
};
refusesFile('2026_short.sql', '-- migrate:up\n', /14 digits/);
refusesFile('20260102000000_Upper.sql', '-- migrate:up\n', /14 digits/);
refusesFile('20260102000000_noup.sql', 'SELECT 1;\n', /migrate:up/);
refusesFile('20260102000000_down.sql', '-- migrate:up\nCREATE TABLE a();\n-- migrate:down\nDROP TABLE a;\n', /forward-only/);
refusesFile('20260102000000_order.sql', '-- migrate:down\n-- migrate:up\nSELECT 1;\n', /forward-only/);

// ── new-migration ──
writeFileSync(join(MIGRATIONS, '29990101000000_future.sql'), '-- migrate:up\n');
result = run('new-migration', ['--name=add_users']);
check('stamped after every migration before it, even when the clock disagrees', existsSync(join(MIGRATIONS, '29990101000001_add_users.sql')), result.stdout + result.stderr);
check('a bare positional name works too', run('new-migration', ['second']).status === 0 && existsSync(join(MIGRATIONS, '29990101000002_second.sql')));
check('a name that is not lower_snake: refused', run('new-migration', ['--name=Add-Users']).status !== 0);
check('the file\'s down is empty', readFileSync(join(MIGRATIONS, '29990101000001_add_users.sql'), 'utf8') === '-- migrate:up\n\n\n-- migrate:down\n');
for (const file of readdirSync(MIGRATIONS)) rmSync(join(MIGRATIONS, file));
writeFileSync(join(MIGRATIONS, '20260101000000_a.sql'), '-- migrate:up\nSELECT 1;\n-- migrate:down\n');

// ── deploy ──
const SECRET = 'postgresql://u:hunter2@db.example.com:6000/shop';
clearCalls();
result = run('deploy');
check('no URL: refused, naming the variable', result.status !== 0 && /POSTGRES_DEPLOY_URL is not set/.test(result.stderr), result.stderr);
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET });
check('outside CI with no terminal: refused', result.status !== 0 && /asks a human/.test(result.stderr) && lastCall('dbmate').length === 0, result.stderr);
for (const name of ['.env', '.env.local', '.local.env', '.deploy.env', 'postgres/.env']) {
  writeFileSync(join(tree, name), `export POSTGRES_DEPLOY_URL=${SECRET}\n`);
  result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'true' });
  check(`a URL in ${name}: refused`, result.status !== 0 && /never from a file/.test(result.stderr) && !result.stderr.includes('hunter2'), result.stderr);
  rmSync(join(tree, name));
}
result = run('deploy', [], { POSTGRES_DEPLOY_URL: 'postgres://u:hunter2@h:6543/d', CI: 'true' });
check('a transaction pooler: refused, with no password said', result.status !== 0 && /pooler/.test(result.stderr) && !result.stderr.includes('hunter2'), result.stderr);
clearCalls();
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'true', PGHOST: 'decoy', DATABASE_URL: 'postgresql://decoy/x', DBMATE_MIGRATIONS_DIR: '/x' });
const [deployCall] = lastCall('dbmate');
check('in CI: runs', result.status === 0, result.stderr);
check('says where, with no password', result.stdout.includes('db.example.com:6000/shop') && !(result.stdout + result.stderr).includes('hunter2'), result.stdout);
check('the URL is in dbmate\'s environment, and not on its command line', /^DATABASE_URL=postgresql:\/\/u:hunter2@db\.example\.com:6000\/shop$/m.test(deployCall ?? '') && !/^--url/m.test(deployCall ?? '') && /--env\nDATABASE_URL\n/.test(deployCall ?? ''), deployCall);
check('and only that: the rest of a hostile environment is gone', !/^(PGHOST|DBMATE_)/m.test(deployCall ?? ''), deployCall);

// ── serve only inside a stack ──
result = run('serve');
check('`serve` outside a dev stack: refused, naming the target', result.status !== 0 && /postgres:start/.test(result.stderr), result.stderr);

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `FAILED: ${failed}` : 'ok');
process.exit(failed ? 1 : 0);
