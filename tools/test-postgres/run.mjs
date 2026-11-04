#!/usr/bin/env node
// THE TRIPWIRE: the Postgres launcher against the real pinned binaries, under the real dev engine, in fixture git repos.
//
//   node tools/test-postgres/run.mjs [--only=<substring>]
//
// Needs the network once, for the pinned closure and dbmate (installed by the GENERATED installer, unprivileged, into a cache:
// POSTGRES_TOOLS_CACHE, default under the system temp dir). ~1 min from nothing, ~30 s after that. What a fake cannot show is
// what this is for: the stop roads, the orphan, recovery, dbmate's real reading of the environment, and whether a server on
// the right port is the right server. Every server runs on a random free block, never a base port, and is stopped by its handle.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NoClosureHere, ensureTools } from './tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const GENERATORS = join(REPO, 'plugins/house/engine/nx-tools/src/generators');
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
const OWNER = process.env.DEV_OWNER || 'test-postgres';
const scratch = mkdtempSync(join(tmpdir(), 'bespunky-test-postgres-'));
const xdg = join(scratch, 'xdg');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const toolEnv = await ensureTools().catch((error) => {
  if (!(error instanceof NoClosureHere)) throw error;
  console.error(error.message);
  process.exit(2);
});
const baseEnv = () => {
  const env = { ...process.env, ...toolEnv, DEV_OWNER: OWNER, XDG_DATA_HOME: xdg, NO_COLOR: '1' };
  delete env.CLAUDECODE; // a human's run: the offset below is explicit either way
  delete env.CI;
  return env;
};

const freeOffset = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port - 5432));
    });
  });

const renderDir = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) renderDir(join(from, entry.name), join(to, entry.name));
    else cpSync(join(from, entry.name), join(to, entry.name.replace(/\.tpl$/, '')));
  }
};

let fixtures = 0;
function fixture({ major = '18' } = {}) {
  const dir = join(scratch, `repo-${++fixtures}`);
  mkdirSync(join(dir, '.bespunky'), { recursive: true });
  mkdirSync(join(dir, 'postgres/migrations'), { recursive: true });
  mkdirSync(join(dir, 'postgres/seed/world'), { recursive: true });
  renderDir(join(GENERATORS, 'dev/files'), join(dir, 'tools/dev'));
  chmodSync(join(dir, 'tools/dev/dev'), 0o755);
  renderDir(join(GENERATORS, 'postgres/files'), join(dir, 'tools/postgres'));
  writeFileSync(join(dir, '.bespunky/postgres.json'), `{ "major": ${major} }\n`);
  writeFileSync(join(dir, '.gitignore'), '.bespunky/run\n');
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-qb', 'work');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture');
  return dir;
}

const MIGRATION = '-- migrate:up\nCREATE TABLE thing (id int PRIMARY KEY, name text);\n\n-- migrate:down\n';
const addMigration = (dir, name = '20260101000000_thing.sql', body = MIGRATION) => writeFileSync(join(dir, 'postgres/migrations', name), body);
const addSeed = (dir, name = '01_things.sql', body = "INSERT INTO thing VALUES (1, 'seeded');\n") => writeFileSync(join(dir, 'postgres/seed/world', name), body);

const launcher = (dir, ...args) => spawnSync(process.execPath, ['tools/postgres/postgres.mjs', ...args], { cwd: dir, env: baseEnv(), encoding: 'utf8' });
const dev = (dir, ...args) => spawnSync(process.execPath, ['tools/dev/dev.mjs', ...args], { cwd: dir, env: baseEnv(), encoding: 'utf8' });
const ps = (dir) => JSON.parse(dev(dir, 'ps', '--json').stdout);

const started = [];
/** Start a stack in its own session, and wait for its ready marker or its end. */
async function start(dir, { offset, env = {}, expectFailure = false, timeoutMs = 60_000 } = {}) {
  const chosen = offset ?? (await freeOffset());
  const logFile = join(dir, `.start-${chosen}.log`);
  writeFileSync(logFile, '');
  const child = spawn('sh', ['-c', `exec "${process.execPath}" tools/postgres/postgres.mjs start --port-offset=${chosen} >> '${logFile}' 2>&1`], { cwd: dir, env: { ...baseEnv(), ...env }, detached: true, stdio: 'ignore' });
  const handle = { dir, offset: chosen, port: 5432 + chosen, key: `postgres@${chosen}`, child, log: () => readFileSync(logFile, 'utf8'), ended: false, code: undefined };
  child.on('exit', (code, signal) => Object.assign(handle, { ended: true, code: code ?? signal }));
  started.push(handle);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle.ended) {
      if (!expectFailure) throw new Error(`the stack ended early (${handle.code}):\n${handle.log()}`);
      return handle;
    }
    // A stack expected to fail is only ever waited out: an orphan on this block still has its own marker.
    if (!expectFailure && existsSync(join(dir, '.bespunky/run', handle.key, 'postgres.ready'))) return handle;
    await sleep(25);
  }
  throw new Error(`the stack did not become ready:\n${handle.log()}`);
}

const stop = (handle) => dev(handle.dir, 'stop', 'postgres', `--offset=${handle.offset}`);
const untilEnded = async (handle, ms = 15_000) => {
  const deadline = Date.now() + ms;
  while (!handle.ended && Date.now() < deadline) await sleep(20);
  return handle.ended;
};

const sql = (port, text, database = 'app') => {
  const result = spawnSync('psql', ['-X', '-At', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-c', text], { env: { ...baseEnv(), PGCONNECT_TIMEOUT: '3' }, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : `ERROR: ${result.stderr.trim()}`;
};

let failures = 0;
const scenarios = [];
const scenario = (name, body) => scenarios.push({ name, body });
const ok = (value, what) => {
  if (!value) failures++;
  console.log(`  ${value ? 'ok  ' : 'FAIL'} ${what}`);
};

scenario('cold boot: created, migrated, seeded before ready, and the settings the design asks for', async () => {
  const dir = fixture();
  addMigration(dir);
  addSeed(dir);
  const began = Date.now();
  const stack = await start(dir);
  console.log(`       cold to ready: ${Date.now() - began} ms`);
  ok(sql(stack.port, 'SELECT name FROM thing') === 'seeded', 'the seed row is there the moment the marker is');
  ok(sql(stack.port, 'SHOW wal_level') === 'logical', 'wal_level=logical');
  ok(sql(stack.port, 'SHOW max_slot_wal_keep_size') === '1GB', 'a finite max_slot_wal_keep_size');
  ok(sql(stack.port, 'SHOW dynamic_shared_memory_type') === 'mmap', 'mmap, not /dev/shm');
  ok(sql(stack.port, 'SHOW listen_addresses') === '127.0.0.1', 'loopback only');
  ok(sql(stack.port, 'SHOW unix_socket_directories').startsWith('/tmp/bespunky-'), 'the socket is in the stack\'s short temp dir');
  ok(/^18\./.test(sql(stack.port, 'SHOW server_version')), 'the declared major');
  const row = ps(dir).find((s) => s.key === stack.key);
  ok(row?.state === 'live' && row.ports.postgres === stack.port, '`dev ps --json` shows the stack on its port');
  const home = join(xdg, 'bespunky/postgres');
  const treeDirs = readdirSync(home).filter((d) => existsSync(join(home, d, 'tree')) && readFileSync(join(home, d, 'tree'), 'utf8').trim() === dir);
  ok(treeDirs.length === 1 && existsSync(join(home, treeDirs[0], stack.key, '18/data/PG_VERSION')), 'data under the data home, keyed by tree, stack and major');
  ok(!existsSync(join(dir, 'postgres/data')), 'nothing in the tree');
  ok(readFileSync(join(home, treeDirs[0], stack.key, '18/identity'), 'utf8').trim() === sql(stack.port, 'SELECT system_identifier FROM pg_control_system()'), 'the identity record holds the server\'s system_identifier');
  ok(!readdirSync(join(home, treeDirs[0], stack.key)).some((n) => n.startsWith('.init-')), 'no initdb sibling left');
  const out = stop(stack);
  ok(out.status === 0 && (await untilEnded(stack)) && stack.code === 0, `a clean dev stop, status 0 (${stack.code})`);
  ok(ps(dir).length === 0, 'nothing left in dev ps');
});

scenario('warm restart: the same data on the same block, no second seed; a new migration arrives', async () => {
  const dir = fixture();
  addMigration(dir);
  addSeed(dir);
  const offset = await freeOffset();
  const first = await start(dir, { offset });
  sql(first.port, "INSERT INTO thing VALUES (2, 'mine')");
  stop(first);
  await untilEnded(first);
  addMigration(dir, '20260102000000_more.sql', '-- migrate:up\nALTER TABLE thing ADD COLUMN extra text;\n-- migrate:down\n');
  const began = Date.now();
  const second = await start(dir, { offset });
  console.log(`       warm to ready: ${Date.now() - began} ms`);
  ok(sql(second.port, 'SELECT count(*) FROM thing') === '2', 'the row survived, and the seed did not run twice (it would have collided)');
  ok(sql(second.port, "SELECT count(*) FROM information_schema.columns WHERE table_name='thing' AND column_name='extra'") === '1', 'the new migration applied at start');
  stop(second);
  await untilEnded(second);
});

scenario('migrate, seed, psql and reset through the verbs, against the addressed stack', async () => {
  const dir = fixture();
  const stack = await start(dir);
  ok(sql(stack.port, "SELECT to_regclass('thing')") === '', 'nothing there before there is a migration');
  addMigration(dir);
  addSeed(dir);
  const migrated = launcher(dir, 'migrate');
  ok(migrated.status === 0 && sql(stack.port, "SELECT to_regclass('thing')") === 'thing', `migrate applied it (${migrated.stderr.trim()})`);
  const seeded = launcher(dir, 'seed');
  ok(seeded.status === 0 && sql(stack.port, 'SELECT count(*) FROM thing') === '1', 'seed applied it');
  const again = launcher(dir, 'seed');
  ok(again.status !== 0 && sql(stack.port, 'SELECT count(*) FROM thing') === '1' && /nothing of it was kept/.test(again.stderr), 'a seed that fails keeps nothing, and says so');
  const psql = launcher(dir, 'psql', '--sql=SELECT 41 + 1');
  ok(psql.status === 0 && psql.stdout.includes('42'), '`psql --sql` runs on the stack');
  sql(stack.port, "INSERT INTO thing VALUES (9, 'junk')");
  const client = spawn('psql', ['-X', '-h', '127.0.0.1', '-p', String(stack.port), '-U', 'postgres', '-d', 'app'], { env: baseEnv(), stdio: ['pipe', 'ignore', 'ignore'] });
  await sleep(150);
  const reset = launcher(dir, 'reset');
  ok(reset.status === 0, `reset succeeds with a client open (${reset.stderr.trim()})`);
  ok(sql(stack.port, 'SELECT count(*) FROM thing') === '1' && sql(stack.port, 'SELECT name FROM thing') === 'seeded', 'reset: migrated and seeded from nothing');
  client.stdin.end();
  const name = launcher(dir, 'new-migration', '--name=add_users');
  const created = readdirSync(join(dir, 'postgres/migrations')).find((f) => f.endsWith('_add_users.sql'));
  ok(name.status === 0 && /^\d{14}_add_users\.sql$/.test(created ?? '') && readFileSync(join(dir, 'postgres/migrations', created), 'utf8') === '-- migrate:up\n\n\n-- migrate:down\n', `new-migration: ${created}`);
  rmSync(join(dir, 'postgres/migrations', created));
  stop(stack);
  await untilEnded(stack);
  const none = launcher(dir, 'migrate');
  ok(none.status !== 0 && /postgres:start/.test(none.stderr), 'with nothing running, a verb names the target that starts it');
});

scenario('two stacks in one tree: separate data; a verb requires --offset and lists them', async () => {
  const dir = fixture();
  addMigration(dir);
  const a = await start(dir);
  const b = await start(dir);
  sql(a.port, "INSERT INTO thing VALUES (1, 'a')");
  ok(sql(b.port, 'SELECT count(*) FROM thing') === '0', 'the second stack has its own data');
  const ambiguous = launcher(dir, 'reset');
  ok(ambiguous.status !== 0 && ambiguous.stderr.includes(a.key) && ambiguous.stderr.includes(b.key) && ambiguous.stderr.includes('--offset'), 'several: refused, listing them');
  ok(sql(a.port, 'SELECT count(*) FROM thing') === '1', 'and nothing was reset');
  const aimed = launcher(dir, 'reset', `--offset=${a.offset}`);
  ok(aimed.status === 0 && sql(a.port, 'SELECT count(*) FROM thing') === '0' && sql(b.port, 'SELECT 1') === '1', '--offset reaches that one');
  stop(a);
  stop(b);
  await untilEnded(a);
  await untilEnded(b);
});

scenario('refusing a foreign identifier: every local verb, against the recorded value', async () => {
  const dir = fixture();
  addMigration(dir);
  addSeed(dir);
  const stack = await start(dir);
  const home = join(xdg, 'bespunky/postgres');
  const treeDir = readdirSync(home).find((d) => existsSync(join(home, d, 'tree')) && readFileSync(join(home, d, 'tree'), 'utf8').trim() === dir);
  const record = join(home, treeDir, stack.key, '18/identity');
  const real = readFileSync(record, 'utf8');
  writeFileSync(record, '1234567890\n');
  for (const verb of ['reset', 'migrate', 'seed', 'psql']) {
    const refused = launcher(dir, verb, ...(verb === 'psql' ? ['--sql=SELECT 1'] : []));
    ok(refused.status !== 0 && /not the one/.test(refused.stderr), `${verb} refuses a server whose identifier differs`);
  }
  ok(sql(stack.port, 'SELECT count(*) FROM thing') === '1', 'and the database was not touched');
  rmSync(record);
  const unrecorded = launcher(dir, 'reset');
  ok(unrecorded.status !== 0 && /no recorded identity/.test(unrecorded.stderr), 'no record at all fails closed');
  writeFileSync(record, real);
  ok(launcher(dir, 'migrate').status === 0, 'the real value passes');
  const flag = launcher(dir, 'reset', '--url=postgresql://elsewhere/db');
  ok(flag.status !== 0 && /takes no URL/.test(flag.stderr), 'a local verb refuses a URL');
  stop(stack);
  await untilEnded(stack);
});

scenario('stop roads with a client open: dev stop, SIGTERM to the launcher, Ctrl+C to the group; rows intact', async () => {
  const dir = fixture();
  addMigration(dir);
  const offset = await freeOffset();
  const road = async (name, doStop) => {
    const stack = await start(dir, { offset });
    const value = name.replace(/\W/g, '');
    sql(stack.port, `INSERT INTO thing VALUES (${Date.now() % 1000000}, '${value}')`);
    const client = spawn('psql', ['-X', '-h', '127.0.0.1', '-p', String(stack.port), '-U', 'postgres', '-d', 'app'], { env: baseEnv(), stdio: ['pipe', 'ignore', 'ignore'] });
    client.on('error', () => {});
    await sleep(150);
    const began = Date.now();
    doStop(stack);
    const ended = await untilEnded(stack, 20_000);
    ok(ended, `${name}: ended in ${Date.now() - began} ms (status ${stack.code})`);
    ok(Date.now() - began < 8000, `${name}: within the smart bound and a fast shutdown, not a hang`);
    client.stdin.end();
    const again = await start(dir, { offset });
    ok(sql(again.port, `SELECT count(*) FROM thing WHERE name = '${value}'`) === '1', `${name}: the committed row is there after a restart`);
    stop(again);
    await untilEnded(again);
  };
  await road('dev stop', (stack) => stop(stack));
  await road('SIGTERM to the launcher', (stack) => stack.child.kill('SIGTERM'));
  await road('SIGINT to the group', (stack) => process.kill(-stack.child.pid, 'SIGINT'));
  await road('SIGHUP to the group', (stack) => process.kill(-stack.child.pid, 'SIGHUP'));
});

scenario('a dependent still writing during a stop can finish: smart first, fast after the bound', async () => {
  const dir = fixture();
  addMigration(dir);
  const stack = await start(dir);
  const writer = spawn('psql', ['-X', '-h', '127.0.0.1', '-p', String(stack.port), '-U', 'postgres', '-d', 'app', '-c', "BEGIN; SELECT pg_sleep(1); INSERT INTO thing VALUES (77, 'late'); COMMIT;"], { env: baseEnv(), stdio: 'ignore' });
  const writerDone = new Promise((done) => writer.on('exit', done));
  await sleep(200);
  stop(stack);
  await untilEnded(stack);
  await writerDone;
  const again = await start(dir, { offset: stack.offset });
  ok(sql(again.port, "SELECT count(*) FROM thing WHERE id = 77") === '1', 'the write in flight when the stop came was committed');
  stop(again);
  await untilEnded(again);
});

scenario('kill -9 of the launcher: an orphan dev ps sees, dev stop clears, the next start recovers', async () => {
  const dir = fixture();
  addMigration(dir);
  const offset = await freeOffset();
  const stack = await start(dir, { offset });
  sql(stack.port, "INSERT INTO thing VALUES (5, 'kept')");
  const record = ps(dir).find((s) => s.key === stack.key);
  const serve = record.processes?.find((p) => p.id)?.pid ?? record.pid;
  // Everything in the session but the server: the wrapper, the engine and the launcher.
  const before = sql(stack.port, 'SELECT 1');
  const killed = [];
  for (const line of execFileSync('ps', ['-o', 'pid=,args=', '-s', String(stack.child.pid)], { encoding: 'utf8' }).trim().split('\n')) {
    const [, pid] = /^\s*(\d+)\s/.exec(line) ?? [];
    if (pid) {
      process.kill(Number(pid), 'SIGKILL');
      killed.push(pid);
    }
  }
  await untilEnded(stack);
  await sleep(200);
  ok(before === '1' && sql(stack.port, 'SELECT 1') === '1', `the server outlives them (killed ${killed.length}, the stack's pid was ${serve})`);
  const orphan = ps(dir).find((s) => s.key === stack.key);
  ok(orphan?.state === 'orphaned', `dev ps says it is orphaned (${orphan?.state})`);
  const refused = launcher(dir, 'migrate');
  ok(refused.status !== 0 && /tools\/dev\/dev ps/.test(refused.stderr), 'a verb refuses an orphan and points at dev ps');
  const blocked = await start(dir, { offset, expectFailure: true, timeoutMs: 15_000 });
  ok(blocked.ended && blocked.code !== 0, 'a new start on that block is refused while the orphan holds it');
  const cleared = stop(stack);
  ok(cleared.status === 0, `dev stop clears it (${cleared.stderr.trim()})`);
  ok(sql(stack.port, 'SELECT 1').startsWith('ERROR'), 'the port is free');
  ok(ps(dir).length === 0, 'dev ps is empty');
  const again = await start(dir, { offset });
  ok(sql(again.port, "SELECT name FROM thing WHERE id = 5") === 'kept', 'the next start recovers, with the row');
  stop(again);
  await untilEnded(again);
});

scenario('kill -9 of the postmaster: the stack fails, and the next start recovers', async () => {
  const dir = fixture();
  addMigration(dir);
  const stack = await start(dir);
  sql(stack.port, "INSERT INTO thing VALUES (6, 'kept')");
  const pid = Number(sql(stack.port, 'SELECT pg_postmaster_start_time() IS NOT NULL') && execFileSync('sh', ['-c', `head -1 "$(find '${xdg}' -path '*/${stack.key}/18/data/postmaster.pid')"`], { encoding: 'utf8' }).trim());
  process.kill(pid, 'SIGKILL');
  ok(await untilEnded(stack, 20_000), 'the stack ends');
  ok(stack.code !== 0, `not as a success (${stack.code})`);
  const again = await start(dir, { offset: stack.offset });
  ok(sql(again.port, 'SELECT name FROM thing WHERE id = 6') === 'kept', 'crash recovery: the row is there');
  stop(again);
  await untilEnded(again);
});

scenario('a failed bring-up: a bad migration stops the server and fails the stack, and no marker appears', async () => {
  const dir = fixture();
  addMigration(dir, '20260101000000_bad.sql', '-- migrate:up\nCREATE TABLE nope (;\n-- migrate:down\n');
  const stack = await start(dir, { expectFailure: true });
  ok(stack.ended && stack.code !== 0, `the stack failed (${stack.code})`);
  ok(/Migrating failed/.test(stack.log()), 'and said why');
  ok(!existsSync(join(dir, '.bespunky/run', stack.key, 'postgres.ready')), 'no ready marker');
  ok(sql(stack.port, 'SELECT 1', 'postgres').startsWith('ERROR'), 'no server left');
  rmSync(join(dir, 'postgres/migrations/20260101000000_bad.sql'));
  addMigration(dir, '20260101000000_down.sql', '-- migrate:up\nCREATE TABLE a (id int);\n-- migrate:down\nDROP TABLE a;\n');
  const down = await start(dir, { expectFailure: true, offset: stack.offset });
  ok(down.ended && /forward-only/.test(down.log()), 'a non-empty down refuses the start, before dbmate');
});

scenario('an interrupted initdb never becomes a cluster; a leftover sibling is swept', async () => {
  const dir = fixture();
  const offset = await freeOffset();
  const log = join(dir, '.interrupted.log');
  const child = spawn('sh', ['-c', `exec "${process.execPath}" tools/postgres/postgres.mjs start --port-offset=${offset} >> '${log}' 2>&1`], { cwd: dir, env: baseEnv(), detached: true, stdio: 'ignore' });
  const home = join(xdg, 'bespunky/postgres');
  let sibling;
  for (let i = 0; i < 400 && !sibling; i++) {
    await sleep(10);
    const found = spawnSync('find', [home, '-maxdepth', '3', '-name', '.init-*', '-path', `*postgres@${offset}*`], { encoding: 'utf8' }).stdout.trim();
    if (found) sibling = found.split('\n')[0];
  }
  ok(Boolean(sibling), 'initdb runs in a sibling');
  // Everything of that start at once, as a crash would.
  for (const line of execFileSync('ps', ['-o', 'pid=', '-s', String(child.pid)], { encoding: 'utf8' }).trim().split('\n')) {
    try {
      process.kill(Number(line), 'SIGKILL');
    } catch {
      // gone
    }
  }
  await sleep(200);
  ok(!existsSync(join(dirname(sibling), '18')), 'the cluster directory does not exist');
  const again = await start(dir, { offset });
  ok(sql(again.port, 'SELECT 1') === '1' && !readdirSync(dirname(sibling)).some((n) => n.startsWith('.init-')), 'the next start creates it whole and sweeps the sibling');
  stop(again);
  await untilEnded(again);
});

scenario('the sweep: data of a removed worktree is dropped and reported, a live tree\'s is kept', async () => {
  const dir = fixture();
  const gone = fixture();
  const a = await start(gone);
  stop(a);
  await untilEnded(a);
  const home = join(xdg, 'bespunky/postgres');
  const dirOf = (tree) => readdirSync(home).find((d) => existsSync(join(home, d, 'tree')) && readFileSync(join(home, d, 'tree'), 'utf8').trim() === tree);
  const hash = dirOf(gone);
  ok(Boolean(hash), 'it had data');
  rmSync(gone, { recursive: true, force: true });
  const stack = await start(dir);
  ok(!existsSync(join(home, hash)), 'dropped');
  ok(stack.log().includes('dropped the Postgres data of') && stack.log().includes(gone), 'and reported, naming the tree');
  stop(stack);
  await untilEnded(stack);
  ok(Boolean(dirOf(dir)), 'this tree keeps its own');
});

scenario('the sweep: a tree invisible from here keeps its data, which still works when it comes back', async () => {
  // Two containers on one `~/.local`: the tree, under a mount this one does not have, is staged by moving its parent away.
  const mount = join(scratch, `mount-${++fixtures}`);
  const dir = join(mount, 'project');
  mkdirSync(mount);
  cpSync(fixture(), dir, { recursive: true });
  addMigration(dir);
  addSeed(dir);
  const first = await start(dir);
  ok(sql(first.port, 'SELECT name FROM thing') === 'seeded', 'it has data');
  stop(first);
  await untilEnded(first);
  const home = join(xdg, 'bespunky/postgres');
  const hash = readdirSync(home).find((d) => existsSync(join(home, d, 'tree')) && readFileSync(join(home, d, 'tree'), 'utf8').trim() === dir);
  const elsewhere = `${mount}-elsewhere`;
  renameSync(mount, elsewhere);
  const other = await start(fixture());
  ok(existsSync(join(home, hash, first.key, '18/data/PG_VERSION')), 'another tree\'s start keeps the cluster');
  ok(other.log().includes(`kept the Postgres data of ${dir}`) && other.log().includes(join(home, hash)), 'and says so, naming the tree and the directory');
  ok(!other.log().includes(`dropped the Postgres data of ${dir}`), 'and does not say it dropped it');
  stop(other);
  await untilEnded(other);
  renameSync(elsewhere, mount);
  const back = await start(dir, { offset: first.offset });
  ok(sql(back.port, 'SELECT name FROM thing') === 'seeded', 'the tree comes back to its own rows');
  stop(back);
  await untilEnded(back);
});

scenario('a hostile environment and .env: local verbs and the bring-up reach only this stack', async () => {
  const dir = fixture();
  addMigration(dir);
  const decoyDir = fixture();
  const decoy = await start(decoyDir);
  const hostile = `DATABASE_URL=postgresql://postgres@127.0.0.1:${decoy.port}/app?sslmode=disable\nPGHOST=127.0.0.1\nPGPORT=${decoy.port}\nDBMATE_MIGRATIONS_DIR=/nonexistent\nDBMATE_NO_DUMP_SCHEMA=false\n`;
  writeFileSync(join(dir, '.env'), hostile);
  const env = { DATABASE_URL: `postgresql://postgres@127.0.0.1:${decoy.port}/app?sslmode=disable`, PGHOST: '127.0.0.1', PGPORT: String(decoy.port), PGDATABASE: 'postgres', DBMATE_MIGRATIONS_DIR: '/nonexistent' };
  const stack = await start(dir, { env });
  ok(sql(stack.port, "SELECT to_regclass('thing')") === 'thing', 'the bring-up migrated its own server');
  ok(sql(decoy.port, "SELECT to_regclass('thing')") === '', 'and never the decoy');
  const verb = spawnSync(process.execPath, ['tools/postgres/postgres.mjs', 'reset'], { cwd: dir, env: { ...baseEnv(), ...env }, encoding: 'utf8' });
  ok(verb.status === 0 && sql(decoy.port, "SELECT to_regclass('thing')") === '', `reset under that environment stays home (${verb.stderr.trim()})`);
  ok(!existsSync(join(dir, 'db')), 'and no schema file');
  stop(stack);
  stop(decoy);
  await untilEnded(stack);
  await untilEnded(decoy);
});

scenario('deploy: only what is named, from the environment, never from a file', async () => {
  const dir = fixture();
  addMigration(dir);
  addSeed(dir);
  const remoteDir = fixture();
  const remote = await start(remoteDir);
  const url = `postgresql://postgres:s3cret-pw@127.0.0.1:${remote.port}/app?sslmode=disable`;
  const deploy = (extra) => spawnSync(process.execPath, ['tools/postgres/postgres.mjs', 'deploy'], { cwd: dir, env: { ...baseEnv(), ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  ok(/POSTGRES_DEPLOY_URL is not set/.test(deploy({ CI: 'true' }).stderr), 'no URL: refused, with what to set');
  const noTerminal = deploy({ POSTGRES_DEPLOY_URL: url });
  ok(noTerminal.status !== 0 && /asks a human/.test(noTerminal.stderr) && sql(remote.port, "SELECT to_regclass('thing')") === '', 'outside CI with no terminal: refused, nothing ran');
  for (const bad of [`postgresql://u@127.0.0.1:/app`, `postgresql:///app`, `postgresql://a:1,b:2/app`, `postgresql://127.0.0.1:${remote.port}/app?host=elsewhere`, `postgresql://127.0.0.1:${remote.port}/`, `mysql://127.0.0.1/app`]) {
    const refused = deploy({ CI: 'true', POSTGRES_DEPLOY_URL: bad });
    ok(refused.status !== 0 && /is refused/.test(refused.stderr), `refused: ${bad}`);
  }
  ok(deploy({ CI: 'true', POSTGRES_DEPLOY_URL: 'postgresql://u:p@db-pooler.example.com/app' }).status !== 0, 'a transaction pooler: refused');
  writeFileSync(join(dir, '.env'), `POSTGRES_DEPLOY_URL=${url}\n`);
  const fromFile = deploy({ CI: 'true', POSTGRES_DEPLOY_URL: url });
  ok(fromFile.status !== 0 && /never from a file/.test(fromFile.stderr) && sql(remote.port, "SELECT to_regclass('thing')") === '', 'a URL in a .env file: refused, even with the variable set');
  rmSync(join(dir, '.env'));
  writeFileSync(join(dir, '.env'), `DATABASE_URL=postgresql://postgres@127.0.0.1:1/nope\n`);
  const done = deploy({ CI: 'true', POSTGRES_DEPLOY_URL: url, DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/nope' });
  ok(done.status === 0 && sql(remote.port, "SELECT to_regclass('thing')") === 'thing', `the named database is migrated, past a hostile DATABASE_URL (${done.stderr.trim()})`);
  ok(sql(remote.port, 'SELECT count(*) FROM thing') === '0', 'a deploy never seeds');
  ok(!(done.stdout + done.stderr).includes('s3cret-pw'), 'the password is in no output');
  const second = deploy({ CI: 'true', POSTGRES_DEPLOY_URL: url });
  ok(second.status === 0, 'nothing to do is success');
  stop(remote);
  await untilEnded(remote);
});

scenario('as a dependency under `dev serve`: starts first, its exports reach the app, a failed one starts nothing', async () => {
  const dir = fixture();
  addMigration(dir);
  addSeed(dir);
  writeFileSync(join(dir, 'app.mjs'), `
    import { execFileSync } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    import { createServer } from 'node:http';
    const rows = execFileSync('psql', ['-X', '-At', process.env.DIRECT_DATABASE_URL, '-c', 'SELECT name FROM thing'], { encoding: 'utf8' }).trim();
    writeFileSync('.app-saw', JSON.stringify({ url: process.env.DATABASE_URL, direct: process.env.DIRECT_DATABASE_URL, rows }));
    createServer((_, res) => res.end('ok')).listen(Number(process.env.PORT_APP), '127.0.0.1');
    process.on('SIGTERM', () => process.exit(0));
  `);
  const url = 'postgresql://postgres:postgres@127.0.0.1:${PORT:postgres}/app?sslmode=disable';
  writeFileSync(join(dir, '.bespunky/dev.json'), JSON.stringify({ apps: { web: { processes: [
    { id: 'postgres', cmd: ['node', 'tools/postgres/postgres.mjs', 'serve'], ports: { postgres: 5432 }, dependency: true, ready: { cmd: 'test -f "${STACK_DIR}/postgres.ready"', timeout: 120 }, exports: { DATABASE_URL: url, DIRECT_DATABASE_URL: url } },
    { id: 'app', cmd: ['node', 'app.mjs'], ports: { app: 4600 }, primary: true, ready: { http: '/' } },
  ] } } }, null, 2));
  const offset = await freeOffset();
  const log = join(dir, '.serve.log');
  const serve = spawn('sh', ['-c', `exec "${process.execPath}" tools/dev/dev.mjs serve web --port-offset=${offset} --no-shared-browser >> '${log}' 2>&1`], { cwd: dir, env: baseEnv(), detached: true, stdio: 'ignore' });
  let code;
  serve.on('exit', (c, s) => (code = c ?? s));
  for (let i = 0; i < 600 && !existsSync(join(dir, '.app-saw')) && code === undefined; i++) await sleep(50);
  ok(existsSync(join(dir, '.app-saw')), 'the app started');
  if (existsSync(join(dir, '.app-saw'))) {
    const saw = JSON.parse(readFileSync(join(dir, '.app-saw'), 'utf8'));
    ok(saw.rows === 'seeded', 'and found the seed: migrate and seed had finished before it ran');
    ok(saw.url === saw.direct && saw.url?.includes(`:${5432 + offset}/`), `both URLs at the stack's port: ${saw.url}`);
  }
  const verb = launcher(dir, 'psql', '--sql=SELECT count(*) FROM thing');
  ok(verb.status === 0 && verb.stdout.includes('1'), 'a verb finds the served stack by its tree');
  // Not spawnSync: the serve is this process's child, and it could not be reaped while this process blocked, so the stop
  // would wait out its whole timeout on a zombie.
  const stopped = await new Promise((done) => spawn(process.execPath, ['tools/dev/dev.mjs', 'stop', 'web', `--offset=${offset}`], { cwd: dir, env: baseEnv(), stdio: 'ignore' }).on('exit', done));
  for (let i = 0; i < 400 && code === undefined; i++) await sleep(25);
  ok(stopped === 0 && code === 0, `stopped cleanly (stop ${stopped}, serve ${code})`);
  rmSync(join(dir, '.app-saw'));
  addMigration(dir, '20260109000000_bad.sql', '-- migrate:up\nCREATE TABLE nope (;\n-- migrate:down\n');
  const failed = spawnSync(process.execPath, ['tools/dev/dev.mjs', 'serve', 'web', `--port-offset=${offset}`, '--no-shared-browser'], { cwd: dir, env: baseEnv(), encoding: 'utf8', timeout: 60_000 });
  ok(failed.status !== 0 && !existsSync(join(dir, '.app-saw')), 'a failed migration fails the stack, and the app never starts');
});

const cleanup = () => {
  for (const handle of started) {
    if (existsSync(handle.dir)) dev(handle.dir, 'stop', 'postgres', `--offset=${handle.offset}`);
    try {
      process.kill(-handle.child.pid, 'SIGKILL');
    } catch {
      // gone
    }
  }
  // Whatever a failed case left: servers under this run's data home, by the pid each records. Never by name.
  const pids = spawnSync('find', [xdg, '-name', 'postmaster.pid'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  for (const file of pids) {
    try {
      process.kill(Number(readFileSync(file, 'utf8').split('\n')[0]), 'SIGTERM');
    } catch {
      // gone
    }
  }
};

try {
  for (const { name, body } of scenarios) {
    if (only && !name.includes(only)) continue;
    console.log(name);
    try {
      await body();
    } catch (error) {
      failures++;
      console.log(`  FAIL ${error.stack ?? error.message}`);
    }
  }
} finally {
  cleanup();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(failures ? `FAILED: ${failures}` : 'all ok');
process.exit(failures ? 1 : 0);
