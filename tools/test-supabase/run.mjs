#!/usr/bin/env node
// THE TRIPWIRE: the Supabase provider on the real pinned CLI and its real native runtime, under the real dev engine, in fixture git
// repos. No container engine, by design. Grown out of research/spike-native-tripwire.mjs; the alpha's contract is what this watches.
//
//   node tools/test-supabase/run.mjs [--only=<substring>]
//
// Needs the network once: the CLI through the GENERATED installer, unprivileged, and the stack's artifacts. SUPABASE_TOOLS_CACHE
// (default under the system temp dir) keeps both, about 1.9 GB: ~2 min from nothing, ~1 min after. ONE stack at a time, on a free block
// outside 10000-32767, never a base port, stopped by its handle. Nothing here reaches a hosted project or logs in. It leaves CLAUDECODE
// as it finds it: an agent's run is a run a generated project sees too. `~/.supabase` follows the passwd home, which no variable moves.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compilePayload } from '../test-support/payload.mjs';
import { ensureCli } from './tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const GENERATORS = join(REPO, 'plugins/house/engine/nx-tools/src/generators');
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
const OWNER = process.env.DEV_OWNER || 'test-supabase';
const scratch = mkdtempSync(join(tmpdir(), 'bespunky-test-supabase-'));
const cache = process.env.SUPABASE_TOOLS_CACHE || join(tmpdir(), 'bespunky-supabase-tools');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ── the CLI, through the installer the project gets ──
const { load, dispose } = compilePayload('bespunky-test-supabase');
const { SUPABASE_CLI_VERSION: PIN } = load('generators/_utils/versions');
const FRAGMENT = { supabaseFragment: load('generators/supabase/dev-fragment').supabaseFragment().processes };
const STACK_PORTS = load('generators/supabase/dev-fragment').SUPABASE_PORTS;
dispose();
const { bin: toolsBin } = ensureCli({ cache });
const xdg = join(cache, 'xdg');
const HOME_ = join(xdg, 'supabase');
const hadSupabaseDir = existsSync(join(process.env.HOME, '.supabase'));

const baseEnv = () => {
  const env = { ...process.env, PATH: `${toolsBin}:${process.env.PATH}`, DEV_OWNER: OWNER, XDG_DATA_HOME: xdg, NO_COLOR: '1' };
  delete env.CI;
  return env;
};
const cliEnv = () => ({ ...baseEnv(), SUPABASE_HOME: HOME_, SUPABASE_NO_KEYRING: '1', DO_NOT_TRACK: '1' });

const isFree = (port) =>
  new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
/** A block with every port free, above what the native runtime keeps for itself: an explicit offset is honoured unprobed. */
const freeOffset = async () => {
  for (;;) {
    const offset = 1000 * (28 + Math.floor(Math.random() * 25));
    const all = await Promise.all(Array.from({ length: 10 }, (_, i) => isFree(5432 + offset + i)));
    if (all.every(Boolean)) return offset;
  }
};

const renderDir = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) renderDir(join(from, entry.name), join(to, entry.name));
    else writeFileSync(join(to, entry.name.replace(/\.tpl$/, '')), readFileSync(join(from, entry.name), 'utf8').replaceAll('{{SUPABASE_CLI_VERSION}}', PIN));
  }
};

let fixtures = 0;
function fixture({ migrations = true, root = scratch } = {}) {
  const dir = join(root, `repo-${++fixtures}`);
  mkdirSync(join(dir, 'supabase/migrations'), { recursive: true });
  mkdirSync(join(dir, 'postgres/seed/world'), { recursive: true });
  renderDir(join(GENERATORS, 'dev/files'), join(dir, 'tools/dev'));
  chmodSync(join(dir, 'tools/dev/dev'), 0o755);
  renderDir(join(GENERATORS, 'postgres/files'), join(dir, 'tools/postgres'));
  renderDir(join(GENERATORS, 'supabase/files'), join(dir, 'tools/postgres'));
  const seeded = join(GENERATORS, 'supabase/seed');
  writeFileSync(join(dir, 'supabase/config.toml'), readFileSync(join(seeded, 'config.toml.tpl'), 'utf8').replace('{{PROJECT_ID}}', `fx${fixtures}`));
  cpSync(join(seeded, 'gitignore.tpl'), join(dir, 'supabase/.gitignore'));
  cpSync(join(seeded, 'supabase.lock.tpl'), join(dir, 'supabase/supabase.lock'));
  writeFileSync(join(dir, '.gitignore'), '.bespunky/run\n');
  if (migrations) {
    writeFileSync(join(dir, 'supabase/migrations/20260101000000_base.sql'), 'create table public.thing(v text);\n');
    writeFileSync(join(dir, 'postgres/seed/world/01.sql'), "insert into public.thing values ('seeded');\n");
  }
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-qb', 'work');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture');
  return dir;
}

const TIMEOUT = 240_000;
const launcher = (dir, ...args) => spawnSync(process.execPath, ['tools/postgres/postgres.mjs', ...args], { cwd: dir, env: baseEnv(), encoding: 'utf8', timeout: TIMEOUT });
const dev = (dir, ...args) => spawnSync(process.execPath, ['tools/dev/dev.mjs', ...args], { cwd: dir, env: baseEnv(), encoding: 'utf8', timeout: TIMEOUT });
const ps = (dir) => JSON.parse(dev(dir, 'ps', '--json').stdout);
const sb = (dir, args, extra = {}) => spawnSync(join(toolsBin, 'supabase'), [...args, '--agent', 'no'], { cwd: dir, env: { ...cliEnv(), ...extra }, encoding: 'utf8', timeout: TIMEOUT });
const rows = (dir, sql) => {
  const result = sb(dir, ['db', 'query', sql, '--output-format', 'json']);
  if (result.status !== 0) throw new Error(`db query ${sql}: ${result.stderr}${result.stdout}`);
  return JSON.parse(result.stdout);
};
const stackIdOf = (dir) => JSON.parse(sb(dir, ['status', '--output-format', 'json']).stdout).identity?.id;

const running = [];
/** A keeper in a session of its own, waiting for its ready mark or its end. */
async function start(dir, { offset, timeoutMs = 300_000 } = {}) {
  const chosen = offset ?? (await freeOffset());
  const log = join(scratch, `start-${fixtures}-${chosen}.log`);
  writeFileSync(log, '');
  const child = spawn(process.execPath, ['tools/postgres/postgres.mjs', 'start', `--port-offset=${chosen}`], { cwd: dir, env: baseEnv(), detached: true, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')] });
  const handle = { dir, child, offset: chosen, log, exit: new Promise((done) => child.on('exit', (code, signal) => done({ code, signal }))) };
  running.push(handle);
  const deadline = Date.now() + timeoutMs;
  let ended;
  handle.exit.then((end) => (ended = end));
  for (;;) {
    if (ended) return { ...handle, failed: { ...ended, said: readFileSync(log, 'utf8').slice(-600) } };
    const row = ps(dir).find((entry) => entry.offset === chosen);
    if (row?.stateDir && existsSync(join(row.stateDir, 'postgres.ready'))) return { ...handle, row, port: 5432 + chosen, api: 5435 + chosen };
    if (Date.now() > deadline) throw new Error(`no ready mark in ${timeoutMs} ms`);
    await sleep(250);
  }
}
const stop = async (stack) => {
  const result = dev(stack.dir, 'stop', stack.row?.key?.split('@')[0] ?? 'postgres', `--offset=${stack.offset}`);
  const end = await Promise.race([stack.exit, sleep(30_000).then(() => ({ hung: true }))]);
  return { result, end };
};
const listening = (port) => spawnSync('bash', ['-c', `exec 3<>/dev/tcp/127.0.0.1/${port}`]).status === 0;
/** Running, and not just in the table: a stack's daemon is PID 1's to reap, and in a job container PID 1 reaps nothing (.github/workflows/supabase-tripwire.yml). */
const isRunning = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'latin1');
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
  } catch {
    return false;
  }
};
/** What a process listens on, from the kernel. 0100007F is 127.0.0.1 in /proc's byte order; IPv6 loopback is all zeros and a one. */
const socketsOf = (pid) => {
  const inodes = new Set(readdirSync(`/proc/${pid}/fd`).map((fd) => {
    try {
      return /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`))?.[1];
    } catch {
      return undefined;
    }
  }).filter(Boolean));
  return ['tcp', 'tcp6'].flatMap((table) => readFileSync(`/proc/${pid}/net/${table}`, 'latin1').split('\n').slice(1).map((line) => line.trim().split(/\s+/)).filter((fields) => fields[3] === '0A' && inodes.has(fields[9])).map((fields) => {
    const [address, port] = fields[1].split(':');
    return { port: parseInt(port, 16), address, loopback: address === '0100007F' || address === '00000000000000000000000001000000' };
  }));
};
const ownerPid = (id) => JSON.parse(readFileSync(join(HOME_, 'stacks', id, 'owner.json'), 'utf8')).pid;

let failures = 0;
let passed = 0;
const scenarios = [];
const scenario = (name, body) => scenarios.push([name, body]);
const check = (cond, what) => {
  if (cond) passed += 1;
  else {
    failures += 1;
    console.log(`  FAIL ${what}`);
  }
};

scenario('the seeds this layer writes are what the real CLI writes', async () => {
  const dir = join(scratch, 'init');
  mkdirSync(dir);
  execFileSync('git', ['init', '-qb', 'main'], { cwd: dir });
  const made = sb(dir, ['init'], { SUPABASE_EXPERIMENTAL_STACK: '1' });
  check(made.status === 0, `init: ${made.stderr}`);
  const real = readFileSync(join(dir, 'supabase/config.toml'), 'utf8').replace(/^project_id = .*$/m, 'project_id = "{{PROJECT_ID}}"').replace(/^sql_paths = .*$/m, 'sql_paths = ["../postgres/seed/world/*.sql"]');
  check(real === readFileSync(join(GENERATORS, 'supabase/seed/config.toml.tpl'), 'utf8'), 'seed/config.toml.tpl is not what this CLI\'s init writes');
  check(/^\s*major_version = 17$/m.test(real) && /^stack = true$/m.test(real), 'the seeded config: major 17 and the stack backend');
  check(sb(dir, ['--version']).stdout.trim() === PIN, 'the installed CLI is the pin');
});

scenario('start: the real keeper under the real engine; status JSON, owner.json, ports as asked, seeds through ../', async () => {
  const dir = fixture();
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  const drifted = execFileSync('git', ['status', '--porcelain', 'supabase/config.toml', 'supabase/supabase.lock', 'supabase/.gitignore'], { cwd: dir, encoding: 'utf8' });
  check(drifted === '', `a first start rewrote what the layer seeds (generators/supabase/seed): ${drifted}`);
  const status = JSON.parse(sb(dir, ['status', '--output-format', 'json']).stdout);
  check(status.runtime === 'native' && status.owner === 'reachable' && status.lifecycle === 'running', `status: ${status.runtime} ${status.owner} ${status.lifecycle}`);
  check(status.composition?.members?.find((m) => m.service === 'database')?.health === 'healthy', 'status lists a healthy database member');
  check(new URL(status.env.DB_URL).port === String(stack.port), `DB_URL: ${status.env.DB_URL}`);
  check(new URL(status.env.API_URL).port === String(stack.api), `API_URL: ${status.env.API_URL}`);
  check(new URL(status.env.MCP_URL).pathname === '/mcp', `MCP_URL: ${status.env.MCP_URL}`);
  const owner = JSON.parse(readFileSync(join(HOME_, 'stacks', status.identity.id, 'owner.json'), 'utf8'));
  check(owner.lifetime === 'detached' && readFileSync(`/proc/${owner.pid}/cmdline`, 'latin1').includes('__supabase_stack_host__'), 'owner.json names a live owner by that process name');
  check(rows(dir, "select count(*)::int n from public.thing where v = 'seeded'")[0].n === 1, 'the migration and the ../ seed ran');
  // Observed, not said: the stack holds a well-known password and an unauthenticated Studio, and only loopback keeps them to this machine.
  // Ports it allocates itself must stay in the range it declares, or the block's ports could lose a race to them.
  const sockets = socketsOf(owner.pid);
  check(sockets.length > 3 && sockets.some((socket) => socket.port === stack.port), `the stack's owner listens, on the block's postgres among others: ${JSON.stringify(sockets)}`);
  check(sockets.every((socket) => socket.loopback), `every port of the stack binds loopback: ${JSON.stringify(sockets.filter((socket) => !socket.loopback))}`);
  const declared = new Set(Object.values(STACK_PORTS).map((port) => port + stack.offset));
  check(sockets.filter((socket) => !declared.has(socket.port)).every((socket) => socket.port >= 20000), `what it allocates for itself stays above the public range: ${JSON.stringify(sockets)}`);
  const row = ps(dir).find((entry) => entry.offset === stack.offset);
  check(row?.ports?.postgres === stack.port && row.state === 'live', `dev ps: ${JSON.stringify(row)}`);

  // Through the launcher: every verb against this stack.
  writeFileSync(join(dir, 'supabase/migrations/20260102000000_second.sql'), '-- migrate:up\ncreate table public.second(v text);\n\n-- migrate:down\n');
  const migrated = launcher(dir, 'migrate');
  check(migrated.status === 0, `migrate, the moved shape with its markers: ${migrated.stderr}`);
  check(rows(dir, "select to_regclass('public.second')::text r")[0].r === 'second', 'the migration ran');

  sb(dir, ['db', 'query', 'create table public.drift(v text);']);
  const diff = sb(dir, ['db', 'diff']);
  check(`${diff.stdout}${diff.stderr}`.includes('drift'), 'db diff names a drifted table');

  const seeded = launcher(dir, 'seed');
  check(seeded.status === 0 && rows(dir, "select count(*)::int n from public.thing where v = 'seeded'")[0].n === 2, `seed applies again: ${seeded.stderr}`);
  const sql = launcher(dir, 'psql', '--sql=select current_database()');
  check(sql.status === 0 && sql.stdout.includes('postgres'), `psql reaches it: ${sql.stderr}`);
  const made = launcher(dir, 'new-migration', '--name=third');
  check(made.status === 0 && readdirSync(join(dir, 'supabase/migrations')).some((name) => /^\d{14}_third\.sql$/.test(name)), `new-migration: ${made.stderr}`);
  rmSync(join(dir, 'supabase/migrations', readdirSync(join(dir, 'supabase/migrations')).find((name) => name.endsWith('_third.sql'))));

  const identifier = () => rows(dir, 'select system_identifier::text i from pg_control_system()')[0].i;
  const before = identifier();
  const reset = launcher(dir, 'reset');
  check(reset.status === 0, `reset: ${reset.stderr}`);
  check(identifier() !== before, 'a reset rebuilds the cluster: why identity is not system_identifier here');
  const state = rows(dir, "select to_regclass('public.drift')::text d, to_regclass('public.second')::text m, (select count(*)::int from public.thing) s")[0];
  check(state.d === null && state.m === 'second' && state.s === 1, `after a reset: ${JSON.stringify(state)}`);
  check(new URL(JSON.parse(sb(dir, ['status', '--output-format', 'json']).stdout).env.DB_URL).port === String(stack.port), 'ports survive a reset');
  check(launcher(dir, 'migrate').status === 0, 'identity holds after a reset');

  const agentDeploy = launcher(dir, 'deploy');
  if (process.env.CLAUDECODE === '1') check(agentDeploy.status !== 0 && /not an agent/.test(agentDeploy.stderr), `deploy under an agent: ${agentDeploy.stderr}`);

  // db push --remote=<url> to a database URL, password through a passfile: the road `deploy` takes. Loopback, this stack's own.
  const passfile = join(scratch, 'pgpass');
  writeFileSync(passfile, '*:*:*:*:postgres\n', { mode: 0o600 });
  writeFileSync(join(dir, 'supabase/migrations/20260103000000_pushed.sql'), 'create table public.pushed(v text);\n');
  const pushed = sb(dir, ['db', 'push', `--remote=postgresql://postgres@127.0.0.1:${stack.port}/postgres?sslmode=disable`, '--yes'], { PGPASSFILE: passfile });
  check(pushed.status === 0 && rows(dir, "select to_regclass('public.pushed')::text r")[0].r === 'pushed', `db push through a passfile: ${pushed.stderr}`);
  check(rows(dir, "select count(*)::int n from supabase_migrations.schema_migrations where version = '20260103000000'")[0].n === 1, 'into the CLI\'s ledger');

  const id = status.identity.id;
  const { end } = await stop(stack);
  check(end.code === 0, `stop: ${JSON.stringify(end)}`);
  check(!listening(stack.port) && !isRunning(owner.pid), 'stopped: the port and the owner are gone');
  check(JSON.parse(sb(dir, ['status', '--output-format', 'json']).stdout).owner !== 'reachable', 'the CLI agrees');

  // data kept; same block resumes
  const again = await start(dir, { offset: stack.offset });
  check(!again.failed, `restart: ${JSON.stringify(again.failed)}`);
  check(stackIdOf(dir) === id, 'the same stack');
  check(rows(dir, "select to_regclass('public.pushed')::text r")[0].r === 'pushed', 'data survived a stop');
  await stop(again);
});

scenario('a fresh project with no migrations has a ledger, or is not reset at every start', async () => {
  const dir = fixture({ migrations: false });
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  sb(dir, ['db', 'query', 'create table public.marker(v text);']);
  await stop(stack);
  const again = await start(dir, { offset: stack.offset });
  check(!again.failed, `restarted: ${JSON.stringify(again.failed)}`);
  check(rows(dir, "select to_regclass('public.marker')::text r")[0].r === 'marker', 'a second start kept its rows: an absent ledger must not cost a reset each time');
  await stop(again);
});

scenario('a start keeps what is someone\'s: no ledger is not proof, and a filled-in down never runs', async () => {
  const dir = fixture({ migrations: false });
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  const installed = sb(dir, ['stack', 'install', '--runtime', 'native', '--output-format', 'json']);
  check(installed.status === 0 && JSON.parse(installed.stdout).runtime === 'native' && JSON.parse(installed.stdout).lock?.written === false, `the download step, warm, leaves the lock alone: ${installed.status} ${installed.stderr.slice(-200)}`);
  sb(dir, ['db', 'query', 'create schema app']);
  sb(dir, ['db', 'query', 'create table app.keep(v text)']);
  sb(dir, ['db', 'query', "insert into app.keep values ('kept')"]);
  check(rows(dir, 'select count(*)::int n from app.keep')[0].n === 1, 'the rows are there before it stops');
  await stop(stack);
  // A first migration arrives, and the database has no ledger and nothing in `public`.
  writeFileSync(join(dir, 'supabase/migrations/20260101000000_first.sql'), 'create table public.first(v text);\n');
  const again = await start(dir, { offset: stack.offset });
  check(!again.failed, `restarted: ${JSON.stringify(again.failed)}`);
  check(rows(dir, 'select count(*)::int n from app.keep')[0].n === 1, 'the rows outside `public` are still there');
  check(rows(dir, "select to_regclass('public.first')::text r")[0].r === 'first', 'and the migration ran');
  await stop(again);

  // A conflicting migration: refused with the CLI's error and the reset, data intact, and fixing it is the whole road back.
  writeFileSync(join(dir, 'supabase/migrations/20260101500000_clash.sql'), 'create table app.keep(v text);\n');
  const clash = await start(dir, { offset: stack.offset, timeoutMs: 120_000 });
  check(clash.failed && clash.failed.code !== 0 && /already exists/.test(readFileSync(clash.log, 'utf8')) && /reset --stack=postgres@/.test(clash.failed.said), `a conflict stops the start, with its error and the reset: ${JSON.stringify(clash.failed)}`);
  check(!listening(stack.port), 'and leaves nothing up');
  rmSync(join(dir, 'supabase/migrations/20260101500000_clash.sql'));
  const fixed = await start(dir, { offset: stack.offset });
  check(!fixed.failed, `with it fixed, it starts: ${JSON.stringify(fixed.failed)}`);
  check(rows(dir, 'select count(*)::int n from app.keep')[0].n === 1, 'the data is intact');
  await stop(fixed);

  writeFileSync(join(dir, 'supabase/migrations/20260102000000_bad.sql'), '-- migrate:up\nselect 1;\n\n-- migrate:down\ndrop table public.first;\n');
  const refused = await start(dir, { offset: stack.offset, timeoutMs: 30_000 });
  check(refused.failed && refused.failed.code !== 0 && /forward-only/.test(refused.failed.said), `a filled-in down stops a start: ${JSON.stringify(refused.failed)}`);
  rmSync(join(dir, 'supabase/migrations/20260102000000_bad.sql'));

  // A migration that fails at boot: the keeper says so, and leaves nothing up.
  writeFileSync(join(dir, 'supabase/migrations/20260103000000_broken.sql'), 'this is not sql;\n');
  const broken = await start(dir, { offset: stack.offset });
  check(broken.failed && broken.failed.code !== 0 && /Migrating or seeding failed/.test(broken.failed.said), `a broken migration ends the start: ${JSON.stringify(broken.failed)}`);
  check(!listening(stack.port), 'and the stack is stopped');
  rmSync(join(dir, 'supabase/migrations/20260103000000_broken.sql'));
});

scenario('an empty stack gets its first migration and seed after a restart, seeded once; a stack seeded at its first start is not seeded again', async () => {
  const dir = fixture({ migrations: false });
  const stack = await start(dir);
  check(!stack.failed, `started empty: ${JSON.stringify(stack.failed)}`);
  await stop(stack);
  writeFileSync(join(dir, 'supabase/migrations/20260101000000_base.sql'), 'create table public.thing(v text);\n');
  writeFileSync(join(dir, 'postgres/seed/world/01.sql'), "insert into public.thing values ('seeded');\n");
  const second = await start(dir, { offset: stack.offset });
  check(!second.failed, `the restart keeps working: ${JSON.stringify(second.failed)}`);
  const count = () => rows(dir, "select count(*)::int n from public.thing where v = 'seeded'")[0].n;
  check(count() === 1, 'migrated, and seeded before it said ready');
  await stop(second);
  const third = await start(dir, { offset: stack.offset });
  check(!third.failed && count() === 1, `another restart seeds nothing again: ${JSON.stringify(third.failed)}`);
  await stop(third);

  const seededAtBirth = fixture();
  const born = await start(seededAtBirth, { offset: stack.offset });
  check(!born.failed, `started: ${JSON.stringify(born.failed)}`);
  const inBorn = () => rows(seededAtBirth, "select count(*)::int n from public.thing where v = 'seeded'")[0].n;
  check(inBorn() === 1, 'the CLI\'s first start seeded it');
  await stop(born);
  const reborn = await start(seededAtBirth, { offset: stack.offset });
  check(!reborn.failed && inBorn() === 1, `a restart does not seed what the first start did: ${JSON.stringify(reborn.failed)}`);
  await stop(reborn);
});

scenario('the range is the runtime\'s own rule: the CLI refuses a public port in it, whatever the launcher says', async () => {
  const dir = fixture();
  // Every other port on a free block: if the CLI has stopped refusing, this boots, and must not boot on a base port.
  const offset = await freeOffset();
  const pins = { SUPABASE_DB_PORT: 5432, SUPABASE_DB_SHADOW_PORT: 5433, SUPABASE_DB_POOLER_PORT: 5434, SUPABASE_STUDIO_PORT: 5436, SUPABASE_ANALYTICS_PORT: 5437, SUPABASE_LOCAL_SMTP_PORT: 5438, SUPABASE_LOCAL_SMTP_SMTP_PORT: 5439, SUPABASE_LOCAL_SMTP_POP3_PORT: 5440, SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT: 5441 };
  const env = Object.fromEntries(Object.entries(pins).map(([name, port]) => [name, String(port + offset)]));
  const refused = sb(dir, ['start', '--runtime', 'native', '--output-format', 'json'], { ...env, SUPABASE_API_PORT: '15435' });
  check(refused.status !== 0 && /15435|10000|19999/.test(`${refused.stderr}${refused.stdout}`), `the CLI itself refuses a public port in 10000-19999: ${refused.status} ${refused.stderr.slice(-300)}`);
  sb(dir, ['stop']);
});

scenario('under CI: `CI` with a lock is frozen, and the seeded lock passes', async () => {
  const dir = fixture();
  const log = join(scratch, 'ci.log');
  const offset = await freeOffset();
  const child = spawn(process.execPath, ['tools/postgres/postgres.mjs', 'start', `--port-offset=${offset}`], { cwd: dir, env: { ...baseEnv(), CI: 'true' }, detached: true, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')] });
  const handle = { dir, child, offset, log, exit: new Promise((done) => child.on('exit', (code, signal) => done({ code, signal }))) };
  running.push(handle);
  const deadline = Date.now() + 300_000;
  let row;
  while (Date.now() < deadline && child.exitCode === null) {
    row = ps(dir).find((entry) => entry.offset === offset);
    if (row?.stateDir && existsSync(join(row.stateDir, 'postgres.ready'))) break;
    await sleep(250);
  }
  check(row && existsSync(join(row.stateDir, 'postgres.ready')), `a start under CI: ${readFileSync(log, 'utf8').slice(-600)}`);
  check(rows(dir, "select count(*)::int n from public.thing where v = 'seeded'")[0].n === 1, 'migrated and seeded');
  check(execFileSync('git', ['status', '--porcelain', 'supabase/supabase.lock'], { cwd: dir, encoding: 'utf8' }) === '', 'the lock is as seeded');
  await stop({ ...handle, row });
});

scenario('keeper signals: TERM stops the stack; kill -9 of the owner ends the keeper; kill -9 of the keeper is adopted', async () => {
  const dir = fixture();
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  const id = stackIdOf(dir);

  // The owner killed: the keeper notices, and the stack ends as a failure.
  process.kill(ownerPid(id), 'SIGKILL');
  const ended = await Promise.race([stack.exit, sleep(15_000).then(() => ({ hung: true }))]);
  check(!ended.hung && ended.code !== 0, `the keeper ended when the owner died: ${JSON.stringify(ended)}`);

  // kill -9 of the keeper: gone from the engine, the stack still up, the next start adopts it.
  const second = await start(dir, { offset: stack.offset });
  check(!second.failed, `start after the owner's kill recovers: ${JSON.stringify(second.failed)}`);
  sb(dir, ['db', 'query', 'create table public.adopted(v text);']);
  const owner = ownerPid(id);
  const keeperRows = readdirSync('/proc').filter((p) => /^\d+$/.test(p)).filter((p) => {
    try {
      return readFileSync(`/proc/${p}/cmdline`, 'latin1').includes('postgres.mjs\0serve') && readFileSync(`/proc/${p}/environ`, 'latin1').includes(`PORT_OFFSET=${stack.offset}\0`);
    } catch {
      return false;
    }
  });
  check(keeperRows.length === 1, `one keeper: ${keeperRows}`);
  process.kill(Number(keeperRows[0]), 'SIGKILL');
  await Promise.race([second.exit, sleep(15_000)]);
  await sleep(500);
  check(listening(second.port) && isRunning(owner), 'the accepted gap: the stack runs on');
  check(!ps(dir).some((row) => row.offset === stack.offset && row.state === 'live'), 'and the engine no longer shows it live');

  const third = await start(dir, { offset: stack.offset });
  check(!third.failed, `the next start adopts: ${JSON.stringify(third.failed)}`);
  check(ownerPid(id) === owner, 'the same owner');
  check(rows(dir, "select to_regclass('public.adopted')::text r")[0].r === 'adopted', 'the same data');
  const { end } = await stop(third);
  check(end.code === 0 && !isRunning(owner), `and stops it: ${JSON.stringify(end)}`);

  // Adopted across blocks: a keeper killed, the next start on another block moves the stack.
  const fourth = await start(dir, { offset: stack.offset });
  const killed = readdirSync('/proc').filter((p) => /^\d+$/.test(p)).find((p) => {
    try {
      return readFileSync(`/proc/${p}/cmdline`, 'latin1').includes('postgres.mjs\0serve') && readFileSync(`/proc/${p}/environ`, 'latin1').includes(`PORT_OFFSET=${stack.offset}\0`);
    } catch {
      return false;
    }
  });
  process.kill(Number(killed), 'SIGKILL');
  await Promise.race([fourth.exit, sleep(15_000)]);
  await sleep(500);
  const offset = (await freeOffset());
  const fifth = await start(dir, { offset });
  check(!fifth.failed, `a start on another block moves it: ${JSON.stringify(fifth.failed)}`);
  check(new URL(JSON.parse(sb(dir, ['status', '--output-format', 'json']).stdout).env.DB_URL).port === String(5432 + offset), 'to the ports asked: compared, not trusted');
  await stop(fifth);
});

scenario('a reset runs to completion: a stop waits, a signal at its caller does not reach it; a half-built stack is caught', async () => {
  const dir = fixture();
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  const caller = spawn(process.execPath, ['tools/postgres/postgres.mjs', 'reset'], { cwd: dir, env: baseEnv(), detached: true, stdio: 'ignore' });
  await sleep(1000);
  try {
    process.kill(-caller.pid, 'SIGINT');
  } catch {}
  // A SIGKILL of the caller: the reset is not its child in any way that matters.
  await sleep(100);
  try {
    process.kill(caller.pid, 'SIGKILL');
  } catch {}
  const stopped = await stop(stack); // takes the lock: waits the reset out
  check(stopped.end.code === 0, `the stop waited: ${JSON.stringify(stopped.end)}`);
  const again = await start(dir, { offset: stack.offset });
  check(!again.failed, `no wedge: ${JSON.stringify(again.failed)}`);
  check(rows(dir, "select count(*)::int n from public.thing where v = 'seeded'")[0].n === 1, 'migrated and seeded: the reset finished');
  check(rows(dir, "select to_regclass('supabase_migrations.schema_migrations')::text r")[0].r !== null, 'the ledger is there');

  // The silent half-state: healthy, and no ledger. Dropped by hand here, which is what an interrupted reset leaves. A start refuses it; only the verb destroys.
  sb(dir, ['db', 'query', 'drop schema supabase_migrations cascade']);
  sb(dir, ['db', 'query', 'drop table public.thing']);
  await stop(again);
  const fourth = await start(dir, { offset: stack.offset });
  check(!fourth.failed, `a start applies forward over it: ${JSON.stringify(fourth.failed)}`);
  check(rows(dir, "select count(*)::int n from public.thing where v = 'seeded'")[0].n === 1, 'migrations and seeds are back, with no reset');
  await stop(fourth);

  // A claimer killed mid-reset: its stack is `finishing`, and `dev stop` waits for the reset instead of signalling every descendant.
  const caller2 = spawn(process.execPath, ['tools/postgres/postgres.mjs', 'reset', `--stack=postgres@${stack.offset}`], { cwd: dir, env: baseEnv(), detached: true, stdio: 'ignore' });
  let claimer;
  const until2 = Date.now() + 120_000;
  while (!claimer && Date.now() < until2) {
    const row = ps(dir).find((entry) => entry.offset === stack.offset);
    const entry = row?.stateDir && existsSync(join(row.stateDir, 'detached/reset.json')) ? JSON.parse(readFileSync(join(row.stateDir, 'detached/reset.json'), 'utf8')) : undefined;
    if (entry?.status === 'running') claimer = row.pid;
    else await sleep(50);
  }
  check(claimer, 'the reset declared itself');
  if (claimer) {
    process.kill(claimer, 'SIGKILL');
    await sleep(200);
    const waited = dev(dir, 'stop', 'postgres', `--offset=${stack.offset}`);
    check(waited.status === 0, `the stop of an orphan waited: ${waited.stdout}${waited.stderr}`);
  }
  await new Promise((done) => (caller2.exitCode === null ? caller2.once('exit', done) : done()));
  const fifth = await start(dir, { offset: stack.offset });
  check(!fifth.failed, `no wedge after it: ${JSON.stringify(fifth.failed)}`);
  check(rows(dir, "select count(*)::int n from public.thing where v = 'seeded'")[0].n === 1, 'and the reset finished');
  await stop(fifth);
});

scenario('a reset with nothing running boots, resets and stops; and it is the road back from whatever an interrupted reset left', async () => {
  const dir = fixture();
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  sb(dir, ['db', 'query', 'create table public.drift(v text);']);
  await stop(stack);
  const booted = launcher(dir, 'reset');
  check(booted.status === 0, `reset with nothing running: ${booted.stdout}${booted.stderr}`);
  check(!ps(dir).length && JSON.parse(sb(dir, ['status', '--output-format', 'json']).stdout).owner !== 'reachable', 'it stopped again');

  const again = await start(dir);
  check(!again.failed, `started: ${JSON.stringify(again.failed)}`);
  check(rows(dir, "select to_regclass('public.drift')::text r")[0].r === null, 'the drift went with it');
  // The hazard itself, by hand, past the launcher's lock: a stop landing in the middle of the CLI's own reset.
  const reset = spawn(join(toolsBin, 'supabase'), ['db', 'reset', '--agent', 'no'], { cwd: dir, env: cliEnv(), stdio: 'ignore' });
  const resetEnded = new Promise((done) => reset.on('exit', done));
  await sleep(800);
  sb(dir, ['stop']);
  await resetEnded;
  await Promise.race([again.exit, sleep(15_000)]);
  const rebuilt = launcher(dir, 'reset');
  check(rebuilt.status === 0, `whatever it left, a reset rebuilds it: ${rebuilt.stdout.slice(-300)}${rebuilt.stderr.slice(-300)}`);
  const third = await start(dir);
  check(!third.failed, `then it starts: ${JSON.stringify(third.failed)}`);
  check(rows(dir, "select count(*)::int n from public.thing where v = 'seeded'")[0].n === 1, 'migrated and seeded');
  await stop(third);
});

scenario('a git worktree has a stack of its own', async () => {
  const dir = fixture();
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  const main = stackIdOf(dir);
  await stop(stack);
  const worktree = join(scratch, `wt-${fixtures}`);
  execFileSync('git', ['worktree', 'add', '-qb', 'wt', worktree], { cwd: dir, stdio: 'ignore' });
  const other = await start(worktree);
  check(!other.failed, `started: ${JSON.stringify(other.failed)}`);
  check(stackIdOf(worktree) !== main, 'another stack');
  check(rows(worktree, "select count(*)::int n from public.thing where v = 'seeded'")[0].n === 1, 'migrated and seeded on its own');
  await stop(other);
  spawnSync(join(toolsBin, 'supabase'), ['stack', 'destroy', '--yes'], { cwd: worktree, env: cliEnv(), stdio: 'ignore', timeout: 60_000 });
});

scenario('a real serve: the keeper as a dependency, its exports reach a sibling, a stop takes both', async () => {
  const dir = fixture();
  const seen = join(scratch, 'sibling-saw');
  const { supabaseFragment } = FRAGMENT;
  const declaration = {
    apps: {
      site: {
        processes: [
          ...supabaseFragment,
          { id: 'app', cmd: ['node', '-e', `require('fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ url: process.env.DATABASE_URL, api: process.env.SUPABASE_URL })); require('http').createServer((q, r) => r.end('ok')).listen(process.env.PORT_APP, '127.0.0.1')`], ports: { app: 4200 }, primary: true, ready: { http: '/' } },
        ],
      },
    },
  };
  mkdirSync(join(dir, '.bespunky'), { recursive: true });
  writeFileSync(join(dir, '.bespunky/dev.json'), JSON.stringify(declaration, null, 2));
  const log = join(scratch, 'serve.log');
  // As an agent, whoever runs this: off a main tree, `auto` offers a human offset 0 first, and CI has no CLAUDECODE. The road through the range is the agent's.
  const serve = spawn(process.execPath, ['tools/dev/dev.mjs', 'serve', 'site', '--no-shared-browser'], { cwd: dir, env: { ...baseEnv(), CLAUDECODE: '1' }, detached: true, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')] });
  running.push({ dir, child: serve });
  const served = new Promise((done) => serve.on('exit', (code) => done({ code })));
  const deadline = Date.now() + 240_000;
  while (!existsSync(seen) && Date.now() < deadline) await sleep(250);
  check(existsSync(seen), `the app started: ${readFileSync(log, 'utf8').slice(-600)}`);
  const row = ps(dir)[0];
  const saw = JSON.parse(readFileSync(seen, 'utf8'));
  check(new URL(saw.url).port === String(row.ports.postgres) && new URL(saw.url).pathname === '/postgres', `DATABASE_URL reached the sibling: ${saw.url}`);
  check(new URL(saw.api).port === String(row.ports['supabase-api']), `SUPABASE_URL: ${saw.api}`);
  check(Object.values(row.ports).every((port) => port < 10000 || port > 32767), `auto stayed out of the runtime's range: ${JSON.stringify(row.ports)}`);
  check(row.key === `site@${row.offset}` && row.offset !== 0, `an agent's auto, off the base ports: ${row.key}`);
  const id = stackIdOf(dir);
  const owner = ownerPid(id);
  const stopped = dev(dir, 'stop', 'site', `--offset=${row.offset}`);
  const end = await Promise.race([served, sleep(30_000).then(() => ({ hung: true }))]);
  check(stopped.status === 0 && !end.hung, `the stop: ${stopped.stdout}${stopped.stderr} ${JSON.stringify(end)}`);
  check(!isRunning(owner) && !listening(row.ports.postgres) && !listening(row.ports.app), 'the stack and the app are gone');
});

// Outside the system temp dir: the Edge Runtime has a filesystem of its own under /tmp. And not under node_modules, where a function's
// npm imports fail to boot. In the home's cache.
const outsideTmp = () => {
  mkdirSync(join(process.env.HOME, '.cache'), { recursive: true });
  const dir = mkdtempSync(join(process.env.HOME, '.cache/bespunky-test-supabase-'));
  outside.push(dir);
  return dir;
};
const outside = [];
const fetchIt = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, text: await response.text() };
};
const keysOf = (dir) => JSON.parse(sb(dir, ['status', '--output-format', 'json']).stdout).env;

scenario('types and functions on the native runtime, by real calls: new, served at once, edited live, secrets at a restart', async () => {
  const dir = fixture({ root: outsideTmp() });
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  const made = launcher(dir, 'gen-types');
  const types = readFileSync(join(dir, 'supabase/types/database.ts'), 'utf8');
  check(made.status === 0 && types.includes('export type Database') && types.includes('thing') && !types.includes('Target:'), `gen-types: ${made.stderr} ${types.slice(0, 120)}`);
  const python = launcher(dir, 'gen-types', '--lang=python', '--out=db/types.py');
  check(python.status === 0 && readFileSync(join(dir, 'db/types.py'), 'utf8').includes('class '), `another language, another path: ${python.stderr}`);

  const created = launcher(dir, 'new-function', '--name=hello');
  check(created.status === 0 && existsSync(join(dir, 'supabase/functions/hello/index.ts')) && readFileSync(join(dir, 'supabase/config.toml'), 'utf8').includes('[functions.hello]'), `new-function: ${created.stderr}`);
  check(!existsSync(join(dir, '.vscode')), 'its offer to rewrite .vscode was declined');
  const env = keysOf(dir);
  const headers = { Authorization: `Bearer ${env.PUBLISHABLE_KEY}`, apikey: env.PUBLISHABLE_KEY, 'content-type': 'application/json' };
  const url = `http://127.0.0.1:${stack.api}/functions/v1`;
  const scaffolded = await fetchIt(`${url}/hello`, { method: 'POST', headers, body: JSON.stringify({ name: 'Functions' }) });
  check(scaffolded.status === 200 && scaffolded.text.includes('Hello Functions!'), `the CLI's own scaffold, with its npm import, answers with no restart and no serve: ${scaffolded.status} ${scaffolded.text}`);

  mkdirSync(join(dir, 'supabase/functions/plain'));
  const body = (word) => `Deno.serve(() => Response.json({ word: ${JSON.stringify(word)}, secret: Deno.env.get('MY_SECRET') ?? 'none' }));\n`;
  writeFileSync(join(dir, 'supabase/functions/plain/index.ts'), body('first'));
  const anon = { Authorization: `Bearer ${env.ANON_KEY}`, apikey: env.PUBLISHABLE_KEY };
  check((await fetchIt(`${url}/plain`, { headers: anon })).text.includes('first'), 'a function written by hand answers');
  writeFileSync(join(dir, 'supabase/functions/plain/index.ts'), body('second'));
  await sleep(500);
  check((await fetchIt(`${url}/plain`, { headers: anon })).text.includes('second'), 'an edit is live on the next request');
  check((await fetchIt(`${url}/plain`)).status === 401, 'verify_jwt holds: no token, 401');
  writeFileSync(join(dir, 'supabase/functions/.env'), 'MY_SECRET=local-only\n');
  await stop(stack);
  const again = await start(dir, { offset: stack.offset });
  check(!again.failed, `restarted: ${JSON.stringify(again.failed)}`);
  check((await fetchIt(`${url}/plain`, { headers: anon })).text.includes('local-only'), 'supabase/functions/.env is read at a start');
  await stop(again);
  const here = readFileSync(join(dir, 'supabase/.gitignore'), 'utf8');
  check(here.includes('.temp'), `the CLI's own lines: ${here}`);
});

scenario('the stated limit: a tree under /tmp serves no function', async () => {
  const dir = fixture();
  mkdirSync(join(dir, 'supabase/functions/plain'), { recursive: true });
  writeFileSync(join(dir, 'supabase/functions/plain/index.ts'), "Deno.serve(() => new Response('ok'));\n");
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  const env = keysOf(dir);
  const answered = await fetchIt(`http://127.0.0.1:${stack.api}/functions/v1/plain`, { headers: { Authorization: `Bearer ${env.ANON_KEY}` } });
  check(answered.status === 404 && answered.text.includes('Function not found'), `if this now answers, drop the limit from the keeper and the docs: ${answered.status} ${answered.text}`);
  check(readFileSync(stack.log, 'utf8').includes('under /tmp'), 'and a start says so');
  await stop(stack);
});

scenario('hosted flows on the real CLI against a LOCAL FAKE API, never Supabase: what it reads, what it would send', async () => {
  const dir = fixture({ root: outsideTmp() });
  mkdirSync(join(dir, 'supabase/functions/plain'), { recursive: true });
  writeFileSync(join(dir, 'supabase/functions/plain/index.ts'), "Deno.serve(() => new Response('ok'));\n");
  const seen = [];
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString('latin1') });
      response.setHeader('content-type', 'application/json');
      response.statusCode = request.method === 'GET' ? 200 : 201;
      response.end(request.url.endsWith('/functions') || request.url.endsWith('/secrets') ? '[]' : JSON.stringify({ id: 'x', slug: 'plain', name: 'plain', status: 'ACTIVE', version: 1, created_at: 0, updated_at: 0 }));
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  const profile = join(scratch, 'profile.yaml');
  writeFileSync(profile, `name: fake\napi_url: http://127.0.0.1:${port}\nproject_host: localhost\ndashboard_url: http://127.0.0.1:${port}\n`);
  const REF = 'abcdefghijklmnopqrst';
  // The launcher's own modules and its own `cli`: so what reaches the CLI is what a verb hands it, through what it hands it with.
  Object.assign(process.env, { PATH: baseEnv().PATH, XDG_DATA_HOME: xdg, SUPABASE_NO_KEYRING: '1' });
  const { secretLine } = await import(pathToFileURL(join(dir, 'tools/postgres/supabase-provider.mjs')));
  const { cli } = await import(pathToFileURL(join(dir, 'tools/postgres/supabase-cli.mjs')));
  const hosted = async (args, input) => {
    const { code, stdout, stderr } = await cli([...args, '--profile', profile], { input, env: { SUPABASE_ACCESS_TOKEN: `sbp_${'0'.repeat(40)}` } });
    return { code, said: `${stdout}${stderr}` };
  };
  const VALUES = { PLAIN: 'value', SPACES: 'a b#c', QUOTE: "it's", DOUBLE: 'say "x"', DOLLAR: 'p$HOME', BOTH: `a'b"c$d\\e`, EQUALS: 'k=v=', BACKTICK: 'a`b$c', BACK_QUOTE: `a\`b'c$d\\e` };
  const set = await hosted(['secrets', 'set', '--env-file', '/dev/stdin', `--remote=${REF}`, '--yes'], Object.entries(VALUES).map(([name, value]) => secretLine(name, value)).join(''));
  check(set.code === 0, `secrets set from a pipe: ${set.said}`);
  const posted = seen.find((request) => request.method === 'POST' && request.url === `/v1/projects/${REF}/secrets`);
  const sent = Object.fromEntries(JSON.parse(posted?.body ?? '[]').map(({ name, value }) => [name, value]));
  for (const [name, value] of Object.entries(VALUES)) check(sent[name] === value, `${name} would be sent as ${JSON.stringify(sent[name])}, typed ${JSON.stringify(value)}`);
  check(!set.said.includes('a b#c'), 'the CLI does not print a value');
  seen.length = 0;
  const deployed = await hosted(['functions', 'deploy', '--use-api', `--remote=${REF}`, '--yes']);
  const wire = seen.map((request) => `${request.method} ${request.url}`);
  check(!deployed.said.includes('Docker') && wire.some((line) => line.startsWith(`POST /v1/projects/${REF}/functions`)), `functions deploy --use-api, no Docker: ${deployed.code} ${deployed.said.slice(-300)} ${wire.join(', ')}`);
  server.close();
});

scenario('refusals: an env file, a block in the CLI\'s range, a second stack in a tree, another stack\'s port', async () => {
  const dir = fixture();
  writeFileSync(join(dir, '.env'), 'SUPABASE_DB_PORT=1\n');
  const door = await start(dir, { timeoutMs: 30_000 });
  check(door.failed && door.failed.code !== 0, `a project .env is refused: ${JSON.stringify(door.failed)}`);
  rmSync(join(dir, '.env'));
  const inside = spawnSync(process.execPath, ['tools/postgres/postgres.mjs', 'start', '--port-offset=20000'], { cwd: dir, env: baseEnv(), encoding: 'utf8', timeout: 30_000 });
  check(inside.status !== 0 && /10000-32767/.test(`${inside.stderr}${inside.stdout}`), `a block in the CLI's range: ${inside.stderr}`);
  const stack = await start(dir);
  check(!stack.failed, `started: ${JSON.stringify(stack.failed)}`);
  const second = await start(dir, { timeoutMs: 30_000 });
  check(second.failed && second.failed.code !== 0, `a second stack in one tree: ${JSON.stringify(second.failed)}`);
  await stop(stack);
});

/** Everything a scenario left, so the next one starts with one stack at most. */
async function clearStacks() {
  for (const { dir, child } of running.splice(0)) {
    if (child?.exitCode === null && child.signalCode === null) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {}
      await sleep(3000);
    }
    spawnSync(join(toolsBin, 'supabase'), ['stop'], { cwd: dir, env: cliEnv(), stdio: 'ignore', timeout: 60_000 });
    spawnSync(join(toolsBin, 'supabase'), ['stack', 'destroy', '--yes'], { cwd: dir, env: cliEnv(), stdio: 'ignore', timeout: 60_000 });
  }
}

let exit = 0;
let ran = 0;
try {
  for (const [name, body] of scenarios) {
    if (only && !name.includes(only)) continue;
    console.log(name);
    ran += 1;
    const before = failures;
    const started = Date.now();
    // A throw ends its scenario, not the run: on a pinned CLI's move, one round trip should show everything it broke.
    try {
      await body();
    } catch (error) {
      failures += 1;
      console.error(`  FAIL ${error.stack ?? error}`);
      await clearStacks();
    }
    console.log(`  ${failures === before ? 'ok' : 'FAILED'} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
  if (!ran) {
    failures += 1;
    console.error(`  FAIL --only=${only} matches no scenario, and a run of nothing is no pass`);
  }
} finally {
  await clearStacks();
  rmSync(scratch, { recursive: true, force: true });
  for (const dir of outside) rmSync(dir, { recursive: true, force: true });
  rmSync(join(xdg, 'bespunky'), { recursive: true, force: true });
  if (!hadSupabaseDir) rmSync(join(process.env.HOME, '.supabase'), { recursive: true, force: true });
  exit = failures ? 1 : 0;
}
console.log(failures ? `FAILED: ${failures} failed, ${passed} passed; supabase@${PIN}` : `all ok: ${passed} checks; supabase@${PIN}`);
process.exit(exit);
