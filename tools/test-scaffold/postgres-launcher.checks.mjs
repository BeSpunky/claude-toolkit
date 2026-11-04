// The Postgres launcher's decisions, with no database: fakes on PATH and a fake `tools/dev/dev.mjs` saying what runs. Whatever
// would regress SILENTLY: an address, a refusal, what a child is handed. What needs real binaries is tools/test-postgres.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
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
fake('postgres', `case "$*" in --version) echo 'postgres (PostgreSQL) 18.6 (Debian x)' ;; esac`);
fake('psql', `case "$*" in *pg_control_system*) cat "${scratch}/answer" ;; esac`);
const say = (answer) => writeFileSync(join(scratch, 'answer'), `${answer}\n`);
const engineCalls = join(scratch, 'engine-calls');
const stacksAre = (rows) =>
  writeFileSync(join(tree, 'tools/dev/dev.mjs'), `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(engineCalls)}, process.argv.slice(2).join(' ') + '\\n');\nprocess.stdout.write(${JSON.stringify(JSON.stringify(rows))});\n`);
const lastEngineCall = () => readFileSync(engineCalls, 'utf8').trim().split('\n').filter((line) => !line.startsWith('ps')).at(-1) ?? '';
const readyState = join(scratch, 'ready-state');
mkdirSync(readyState, { recursive: true });
writeFileSync(join(readyState, 'postgres.ready'), '');
const row = (offset, extra = {}) => ({ key: `postgres@${offset}`, app: 'postgres', tree, offset, state: 'live', ports: { postgres: 5432 + offset }, stateDir: readyState, ...extra });

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
  ['postgresql://u:p@host:5432/db?socket=/tmp', /`socket`/],
  ['postgresql://u:p@host:5432/db?SOCKET=/tmp', /`SOCKET`/],
  ['postgresql://u@host:5432/db?password=SECRETQ', /`password`/],
  ['postgresql://u@host:5432/db?sslpassword=SECRETQ', /`sslpassword`/],
  ['postgresql://u:p@host:5432/db?%68ost=other', /`host`/],
  ['postgresql://u:p@host:5432/db?sslmode=disable', /in clear/],
  ['postgresql://u:p@host:5432/db?sslmode=prefer', /in clear/],
  ['postgresql://u:p@host%zz/db', /percent/],
  ['postgresql://admin:1234/abc@prod.example.com/db', /unencoded/],
  ['mysql://host/db', /postgres/],
  ['', /postgres/],
]) {
  let message = '';
  try {
    parseDeployUrl(url);
  } catch (error) {
    message = error.message;
  }
  check(`refused: ${url || '(empty)'}`, why.test(message) && !message.includes(':p@') && !message.includes('SECRETQ') && !message.includes('abc@prod'), message);
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
result = run('migrate');
check('another tree\'s stack is not this tree\'s', result.status !== 0 && /postgres:start/.test(result.stderr), result.stderr);

stacksAre([{ ...row(100), ports: { web: 4300 } }]);
result = run('migrate');
check('a stack with no Postgres port is not addressed', result.status !== 0 && /postgres:start/.test(result.stderr), result.stderr);

stacksAre([row(100), row(200)]);
result = run('reset');
check('several: refused, listing each, asking for --offset', result.status !== 0 && /--offset/.test(result.stderr) && /postgres@100/.test(result.stderr) && /postgres@200/.test(result.stderr), result.stderr);
result = run('migrate', ['--offset=999']);
check('an offset that is not running: refused, listing what is', result.status !== 0 && /postgres@100/.test(result.stderr), result.stderr);
result = run('migrate', ['--offset=abc']);
check('a non-numeric offset: refused', result.status !== 0 && /whole number/.test(result.stderr), result.stderr);

stacksAre([row(100, { state: 'orphaned' })]);
result = run('reset');
check('an orphan is not usable, and dev ps is named', result.status !== 0 && /dev ps/.test(result.stderr) && /orphaned/.test(result.stderr), result.stderr);

// A `dev run` stack waits on nothing the engine knows of, so what says "up" is the launcher's own mark: migrated and seeded.
stacksAre([row(100, { stateDir: join(scratch, 'no-mark-yet') })]);
result = run('reset');
check('a live stack whose launcher is still bringing it up: try again', result.status !== 0 && /still starting/.test(result.stderr), result.stderr);

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
clearCalls();
result = run('psql', ['--sql=SELECT 1']);
check('psql --sql reads no startup file, where a \\connect would leave the server just checked', lastCall('psql').some((call) => call.includes('SELECT 1\n') && /^-X$/m.test(call)), lastCall('psql').join('---'));
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

check('loopback may say sslmode=disable: nothing crosses a network', parseDeployUrl('postgresql://u:p@127.0.0.1:6000/shop?sslmode=disable').sslmode === 'disable');
check('a hosted provider\'s usual parameters pass', parseDeployUrl('postgresql://u:p@db.example.com/shop?sslmode=verify-full&channel_binding=require&options=endpoint%3Dx').host === 'db.example.com');

// ── deploy ──
const SECRET = 'postgresql://u:hunter2@db.example.com:6000/shop';
clearCalls();
result = run('deploy');
check('no URL: refused, naming the variable', result.status !== 0 && /POSTGRES_DEPLOY_URL is not set/.test(result.stderr), result.stderr);
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET });
check('outside CI with no terminal: refused', result.status !== 0 && /asks a human/.test(result.stderr) && lastCall('dbmate').length === 0, result.stderr);
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'true', CLAUDECODE: '1' });
check('under Claude Code, with CI set: refused, saying a human runs it or CI does', result.status !== 0 && /a human runs it, or CI does/.test(result.stderr) && lastCall('dbmate').length === 0, result.stderr);
check('…and names no secret', !(result.stdout + result.stderr).includes('hunter2'), result.stderr);
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CLAUDECODE: '1' });
check('under Claude Code, with no CI: the same refusal, not the terminal question', /a human runs it, or CI does/.test(result.stderr), result.stderr);
for (const name of ['.env', '.env.local', '.local.env', '.deploy.env', 'postgres/.env']) {
  writeFileSync(join(tree, name), `export POSTGRES_DEPLOY_URL=${SECRET}\n`);
  result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'true' });
  check(`a URL in ${name}: refused`, result.status !== 0 && /never from a file/.test(result.stderr) && !result.stderr.includes('hunter2'), result.stderr);
  rmSync(join(tree, name));
}
for (const [name, body] of [['.env', `POSTGRES_DEPLOY_URL: ${SECRET}\n`], ['.env.local', `export POSTGRES_DEPLOY_URL: ${SECRET}\n`]]) {
  writeFileSync(join(tree, name), body);
  result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'true' });
  check(`dotenv's other spelling in ${name}: refused`, result.status !== 0 && /never from a file/.test(result.stderr), result.stderr);
  rmSync(join(tree, name));
}
clearCalls();
writeFileSync(join(tree, '.env'), 'CI: true\n');
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'true' });
check('CI set in a file: refused, because it would skip the confirmation', result.status !== 0 && /would skip/.test(result.stderr) && lastCall('dbmate').length === 0, result.stderr);
rmSync(join(tree, '.env'));
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'false' });
check('CI=false is not CI: it asks a human', result.status !== 0 && /asks a human/.test(result.stderr) && lastCall('dbmate').length === 0, result.stderr);

// The prompt, on a real terminal: the only guard on a hand-run production migration.
const onATerminal = (answer) =>
  spawnSync('script', ['-qec', `"${process.execPath}" tools/postgres/postgres.mjs deploy`, '/dev/null'], {
    cwd: tree,
    encoding: 'utf8',
    input: `${answer}\n`,
    env: { PATH: `${bin}:${process.env.PATH}`, XDG_DATA_HOME: xdg, HOME: scratch, POSTGRES_DEPLOY_URL: SECRET },
  });
if (spawnSync('script', ['--version']).status === 0) {
  clearCalls();
  result = onATerminal('nope');
  check('a wrong answer at the prompt: nothing ran', /Not confirmed/.test(result.stdout) && lastCall('dbmate').length === 0, result.stdout + result.stderr);
  result = onATerminal('shop');
  check('the database\'s name at the prompt: it runs', lastCall('dbmate').length === 1, result.stdout + result.stderr);
  clearCalls();
} else {
  console.log('  skip the prompt (no `script` here)');
}

// An npm package with a `dbmate` bin: first on PATH under Nx, and it would be handed the URL.
mkdirSync(join(tree, 'node_modules/.bin'), { recursive: true });
writeFileSync(join(tree, 'node_modules/.bin/dbmate'), `#!/bin/sh\necho poisoned > "${scratch}/poisoned"\n`, { mode: 0o755 });
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'true', PATH: `${join(tree, 'node_modules/.bin')}:${bin}:${process.env.PATH}` });
check('a bin in node_modules/.bin is not the pinned tool', result.status === 0 && !existsSync(join(scratch, 'poisoned')), result.stderr);
rmSync(join(tree, 'node_modules'), { recursive: true });
mkdirSync(join(scratch, 'empty-path'));
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'true', PATH: join(scratch, 'empty-path') });
check('no dbmate in CI: says what installs it, not to rebuild a devcontainer', result.status !== 0 && /deploy workflow/.test(result.stderr) && !/rebuild/.test(result.stderr), result.stderr);

// What a client says back, with the URL in it, stays masked.
fake('dbmate', 'echo "failed on $DATABASE_URL"; exit 1');
result = run('deploy', [], { POSTGRES_DEPLOY_URL: SECRET, CI: 'true' });
check('dbmate echoing its URL: the password is masked', result.status !== 0 && !(result.stdout + result.stderr).includes('hunter2') && /\*\*\*/.test(result.stdout), result.stdout);
fake('dbmate');

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

// ── under an agent, Nx shows nothing of a task until it ends ──
const summaryRenderer = join(tree, 'node_modules/nx/dist/src/tasks-runner/life-cycles');
mkdirSync(summaryRenderer, { recursive: true });
writeFileSync(join(summaryRenderer, 'summary-terminal-output-life-cycle.js'), '');
const underNx = { CLAUDECODE: '1', NX_TASK_TARGET_PROJECT: 'postgres' };
stacksAre([]);
result = run('start', [], underNx);
check('postgres:start through a silent Nx, under an agent: refused, naming what prints the port and the handle', result.status !== 0 && /node tools\/postgres\/postgres\.mjs start/.test(result.stderr), result.stderr);
for (const [what, extra] of [['Nx streaming', { NX_DEFAULT_OUTPUT_STYLE: 'stream' }], ['a human', { CLAUDECODE: '' }]]) {
  result = run('start', [], { ...underNx, ...extra });
  check(`…not with ${what}`, result.status === 0, result.stderr);
}
result = run('start', [], { CLAUDECODE: '1' });
check('…not when it is not Nx running it', result.status === 0, result.stderr);
rmSync(join(tree, 'node_modules'), { recursive: true });
result = run('start', [], underNx);
check('…not on an Nx with no summary renderer, which streams', result.status === 0, result.stderr);
result = run('migrate', [], { CLAUDECODE: '1' });
check('under an agent, a verb with no server names the command that prints its handle', result.status !== 0 && /node tools\/postgres\/postgres\.mjs start/.test(result.stderr), result.stderr);

// ── what reaches the engine when a stack is made ──
stacksAre([]);
result = run('reset', ['--offset=300']);
check('reset with nothing running: boots through dev run, on the offset asked', result.status === 0 && /^run postgres .*--port-offset=300 .*serve-reset$/.test(lastEngineCall()), lastEngineCall());
stacksAre([row(100)]);
result = run('reset', ['--offset=300']);
check('reset of an offset nothing runs on, another running: boots for that one too', /--port-offset=300 .*serve-reset$/.test(lastEngineCall()), lastEngineCall());
stacksAre([row(100, { state: 'orphaned' })]);
writeFileSync(engineCalls, '');
result = run('reset', ['--offset=100']);
check('reset of an orphan is refused, never booted over', result.status !== 0 && /orphaned/.test(result.stderr) && lastEngineCall() === '', result.stderr);
// Data is keyed by the whole stack: booting postgres@300 would reset a database nobody uses, and report success.
stacksAre([]);
identityAt('web@300');
result = run('reset', ['--offset=300']);
check('reset of the offset a serve failed on: boots THAT stack\'s cluster', result.status === 0 && /^run web .*--port-offset=300 .*serve-reset$/.test(lastEngineCall()), lastEngineCall());
result = run('reset', ['--stack=web@300']);
check('…and by its key', result.status === 0 && /^run web .*--port-offset=300 .*serve-reset$/.test(lastEngineCall()), lastEngineCall());
identityAt('api@300');
writeFileSync(engineCalls, '');
result = run('reset', ['--offset=300']);
check('two stacks with data on that offset: asks which, and boots nothing', result.status !== 0 && /--stack=/.test(result.stderr) && result.stderr.includes('web@300') && result.stderr.includes('api@300') && lastEngineCall() === '', result.stderr);
result = run('reset', ['--stack=nobody@300']);
check('a stack with no data: refused, listing those with some', result.status !== 0 && result.stderr.includes('web@300') && lastEngineCall() === '', result.stderr);
result = run('reset', ['--stack=web@300', '--offset=300']);
check('--stack and --offset together: refused', result.status !== 0 && /one or the other/.test(result.stderr), result.stderr);
result = run('reset', ['--stack=web']);
check('a --stack that is no key: refused', result.status !== 0 && /<app>@<offset>/.test(result.stderr), result.stderr);
for (const key of ['web@300', 'api@300']) rmSync(join(xdg, 'bespunky/postgres', createHash('sha256').update(realpathSync(tree)).digest('hex').slice(0, 16), key), { recursive: true });
stacksAre([]);
result = run('start');
check('the main tree: no block asked for, so the engine\'s base block', result.status === 0 && !/--port-offset/.test(lastEngineCall()), lastEngineCall());
writeFileSync(join(tree, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');
result = run('start');
check('a linked worktree: auto, never the base block', result.status === 0 && /--port-offset=auto/.test(lastEngineCall()), lastEngineCall());
result = run('reset', [], { XDG_DATA_HOME: join(scratch, 'no-data-yet') });
check('…and a reset with no data and nothing running: auto too', /--port-offset=auto .*serve-reset$/.test(lastEngineCall()), lastEngineCall());
result = run('start', ['--port-offset=700']);
check('…unless a block was asked for', /--port-offset=700/.test(lastEngineCall()) && !/auto/.test(lastEngineCall()), lastEngineCall());
rmSync(join(tree, '.git'));

// ── the sweep: a deletion must be proven ──
// `~/.local` is a volume, so a tree another container mounts is invisible from this one, and treating it as gone loses its data.
const sweepHome = join(xdg, 'bespunky/postgres');
const recordTree = (name, recorded, origin = {}) => {
  const dir = join(sweepHome, name);
  mkdirSync(join(dir, 'postgres@0/18/data'), { recursive: true });
  writeFileSync(join(dir, 'tree'), `${recorded}\n`);
  // The record a start leaves: this host, and the device of the tree's parent, where it can be read.
  let parentDevice = 0;
  try {
    parentDevice = statSync(dirname(recorded)).dev;
  } catch {
    // no such parent: nothing to record
  }
  writeFileSync(join(dir, 'origin'), `${JSON.stringify({ host: hostname(), parentDevice, ...origin })}\n`);
  return dir;
};
const sweep = () =>
  spawnSync(process.execPath, ['--input-type=module', '-e', `(await import(${JSON.stringify(pathToFileURL(join(tree, 'tools/postgres/server.mjs')).href)})).sweepDeadTrees();`], {
    cwd: tree,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, XDG_DATA_HOME: xdg, HOME: scratch },
  });
const worktrees = join(scratch, 'worktrees');
mkdirSync(join(worktrees, 'alive'), { recursive: true });
writeFileSync(join(scratch, 'a-file'), '');
const removed = recordTree('removed', join(worktrees, 'removed'));
const alive = recordTree('alive', join(worktrees, 'alive'));
const otherHost = recordTree('other-host', join(worktrees, 'gone-host'), { host: 'another-container' });
const otherDevice = recordTree('other-device', join(worktrees, 'gone-device'), { parentDevice: 1 });
const noOrigin = recordTree('no-origin', join(worktrees, 'gone-origin'));
rmSync(join(noOrigin, 'origin'));
const invisible = recordTree('invisible', join(scratch, 'mounted-elsewhere/project'));
const deeper = recordTree('deeper', join(scratch, 'mounted-elsewhere/a/b/project'));
const underFile = recordTree('under-file', join(scratch, 'a-file/project'));
const relative = recordTree('relative', 'worktrees/removed');
const blank = recordTree('blank', '');
const swept = sweep();
check('the sweep ran', swept.status === 0, swept.stderr);
const asideOf = (name) => readdirSync(sweepHome).find((entry) => entry.startsWith('.swept-') && entry.endsWith(`-${name}`));
check('a removed worktree, its parent here: set aside, not deleted', !existsSync(removed) && existsSync(join(sweepHome, asideOf('removed') ?? 'none', 'postgres@0/18/data')), swept.stdout);
check('…and reported, naming the tree and the mv that restores it', swept.stdout.includes(`set aside the Postgres data of ${join(worktrees, 'removed')}`) && swept.stdout.includes(`mv -T '${join(sweepHome, asideOf('removed') ?? 'none')}' '${removed}'`), swept.stdout);
check('a tree another host recorded: kept, though it looks removed from here', existsSync(join(otherHost, 'postgres@0/18/data')) && swept.stdout.includes(`kept the Postgres data of ${join(worktrees, 'gone-host')}`), swept.stdout);
check('a parent on another device than recorded (an unmounted disk): kept', existsSync(join(otherDevice, 'postgres@0/18/data')), swept.stdout);
check('no record of who wrote it: kept', existsSync(join(noOrigin, 'postgres@0/18/data')), swept.stdout);
check('a tree that is here: kept, with nothing said', existsSync(alive) && !swept.stdout.includes(join(worktrees, 'alive')), swept.stdout);
check('a tree whose parent is not here: kept', existsSync(join(invisible, 'postgres@0/18/data')) && existsSync(join(deeper, 'postgres@0/18/data')));
check('…and reported as kept, naming the tree and the directory to remove', swept.stdout.includes(`kept the Postgres data of ${join(scratch, 'mounted-elsewhere/project')}`) && swept.stdout.includes(invisible), swept.stdout);
check('a path under a file proves nothing: kept', existsSync(underFile));
check('a record that is no absolute path proves nothing: kept, though it reads as a removed worktree from here', existsSync(relative) && existsSync(blank), swept.stdout);
check('nothing was set aside but the removed worktree', swept.stdout.match(/set aside the Postgres data/g)?.length === 1, swept.stdout);
if (process.getuid?.() !== 0) {
  // Root reads through any mode, so this one cannot be staged as root.
  const sealed = join(scratch, 'sealed');
  mkdirSync(sealed, { mode: 0o000 });
  const behind = recordTree('sealed', join(sealed, 'project'));
  const again = sweep();
  chmodSync(sealed, 0o755);
  check('a parent that cannot be read proves nothing: kept', existsSync(behind) && again.stdout.includes('kept the Postgres data of') && again.stdout.includes(sealed), again.stdout);
}
rmSync(sweepHome, { recursive: true, force: true });
if (process.getuid?.() !== 0) {
  // One dead tree's unreadable stack dir: housekeeping for it must not stop anyone else's start.
  const stuck = recordTree('stuck', join(worktrees, 'removed-too'));
  const other = recordTree('other', join(worktrees, 'removed-also'));
  chmodSync(join(stuck, 'postgres@0'), 0o000);
  const survived = sweep();
  chmodSync(join(stuck, 'postgres@0'), 0o755);
  check('an entry the sweep cannot read does not stop the sweep', survived.status === 0 && survived.stdout.includes(`kept what is left of ${stuck}`) && !existsSync(other), survived.stdout + survived.stderr);
  rmSync(sweepHome, { recursive: true, force: true });
}

// ── the heartbeat: another container on this data ──
const age = (file, seconds) => utimesSync(file, new Date(Date.now() - seconds * 1000), new Date(Date.now() - seconds * 1000));
const beating = (name, recorded, host, seconds = 0) => {
  const dir = recordTree(name, recorded);
  const owner = join(dir, 'postgres@0/18/owner');
  writeFileSync(owner, `${host}\n`);
  age(owner, seconds);
  return dir;
};
const stillBeating = beating('beating', join(worktrees, 'gone-a'), 'other-container');
const staleBeat = beating('stale', join(worktrees, 'gone-b'), 'other-container', 120);
const myBeat = beating('mine', join(worktrees, 'gone-c'), hostname());
const beats = sweep();
check('the sweep: a tree proven gone with a fresh heartbeat from another host: kept', existsSync(stillBeating));
check('…and named, with the host', beats.stdout.includes('container other-container is running a server') && beats.stdout.includes(join(worktrees, 'gone-a')), beats.stdout);
check('the sweep: its heartbeat stale: set aside', !existsSync(staleBeat) && Boolean(asideOf('stale')), beats.stdout);
check('the sweep: its heartbeat this host\'s own: set aside, no server being there', !existsSync(myBeat) && Boolean(asideOf('mine')), beats.stdout);
// Only time deletes what was set aside.
const young = join(sweepHome, `.swept-${Date.now() - 6 * 86_400_000}-young`);
const old = join(sweepHome, `.swept-${Date.now() - 8 * 86_400_000}-old`);
mkdirSync(young, { recursive: true });
mkdirSync(old, { recursive: true });
const expired = sweep();
check('set aside under 7 days: still there', existsSync(young), expired.stdout);
check('set aside over 7 days: deleted, and said', !existsSync(old) && expired.stdout.includes(`deleted ${old}`), expired.stdout);
rmSync(sweepHome, { recursive: true, force: true });

// A start inside a stack, against a cluster that already exists, and a server that exits at once and says what it found.
const stackDir = join(tree, '.bespunky/run/postgres@0');
mkdirSync(stackDir, { recursive: true });
const hash = createHash('sha256').update(realpathSync(tree)).digest('hex').slice(0, 16);
const clusterAt = join(sweepHome, hash, 'postgres@0/18');
const serveVerb = (extra = {}) =>
  spawnSync(process.execPath, [join(tree, 'tools/postgres/postgres.mjs'), 'serve'], {
    cwd: tree,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    env: { PATH: `${bin}:${process.env.PATH}`, XDG_DATA_HOME: xdg, HOME: scratch, DEV_STACK_DIR: stackDir, DEV_STACK_TMP: scratch, PORT_POSTGRES: '45432', ...extra },
  });
const staged = (host, seconds) => {
  mkdirSync(join(clusterAt, 'data'), { recursive: true });
  writeFileSync(join(clusterAt, 'identity'), '42\n');
  writeFileSync(join(clusterAt, 'data/postmaster.pid'), '999999\n');
  writeFileSync(join(clusterAt, 'owner'), `${host}\n`);
  age(join(clusterAt, 'owner'), seconds);
  mkdirSync(dirname(clusterAt), { recursive: true });
  writeFileSync(join(sweepHome, hash, 'tree'), `${realpathSync(tree)}\n`);
};
writeFileSync(join(bin, 'postgres'), `#!/bin/sh\ncase "$*" in --version) echo 'postgres (PostgreSQL) 18.6'; exit 0 ;; esac\ncat "${clusterAt}/owner" > "${calls}/owner-at-boot"; test -e "${clusterAt}/data/postmaster.pid" && touch "${calls}/pid-at-boot"; exit 3\n`, { mode: 0o755 });
staged('other-container', 5);
clearCalls();
result = serveVerb();
check('a fresh heartbeat from another host: refused', result.status !== 0 && /Container other-container is running/.test(result.stderr), result.stderr);
check('…naming the cause and the way out', /share a ~\/\.local volume/.test(result.stderr) && /folder of its own name/.test(result.stderr) && /clears within 30s/.test(result.stderr), result.stderr);
check('…with postmaster.pid and the owner left alone, and no server started', existsSync(join(clusterAt, 'data/postmaster.pid')) && readFileSync(join(clusterAt, 'owner'), 'utf8').trim() === 'other-container' && !existsSync(join(calls, 'owner-at-boot')));
staged('other-container', 120);
clearCalls();
result = serveVerb();
check('a stale heartbeat from another host, as after a rebuild: taken over, the server started', existsSync(join(calls, 'owner-at-boot')) && readFileSync(join(calls, 'owner-at-boot'), 'utf8').trim() === hostname(), result.stderr);
check('…with the dead postmaster.pid gone first', !existsSync(join(calls, 'pid-at-boot')));
check('…and letting go when it ended', !existsSync(join(clusterAt, 'owner')));
staged(hostname(), 1);
clearCalls();
result = serveVerb();
check('a fresh heartbeat of this very host: no refusal: a launcher killed outright here is recovered', existsSync(join(calls, 'owner-at-boot')), result.stderr);
rmSync(bin + '/postgres');
rmSync(sweepHome, { recursive: true, force: true });
rmSync(join(tree, '.bespunky/run'), { recursive: true, force: true });

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `FAILED: ${failed}` : 'ok');
process.exit(failed ? 1 : 0);
