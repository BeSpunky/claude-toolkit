#!/usr/bin/env node
// Candidate tripwire for the `supabase` layer: the contract the layer relies on from the ALPHA native runtime of a
// pinned Supabase CLI. Spike artifact (see spike-native-concurrency.md), node built-ins only, no driver.
//
//   node spike-native-tripwire.mjs                       # installs supabase@<PIN> into a temp dir, ~2 min on a cold cache
//   SUPABASE_TRIPWIRE_HOME=<dir> node ...                # reuse a SUPABASE_HOME, and so its artifact cache (~20 s)
//   SUPABASE_TRIPWIRE_CLI=<path to bin/supabase> node ...# reuse an installed CLI
//
// Proves, by exit code and by value, never by absence of an error:
//   start native · status JSON shape · owner.json · migration up · db diff finds drift · db reset clears drift, reapplies, seeds ·
//   ports survive a reset · SUPABASE_DB_PORT is honoured · a second stack in a git worktree stays isolated through the first's reset ·
//   stop keeps data · start resumes it on the same ports · destroy removes the stack and every process of it.
//
// NOTE `~/.supabase/ports.sqlite`: it follows the passwd home, not SUPABASE_HOME, so this script cannot redirect it.
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

const PIN = process.env.SUPABASE_TRIPWIRE_PIN ?? '3.0.0';
const started = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'supabase-tripwire-'));
const home = process.env.SUPABASE_TRIPWIRE_HOME ?? join(scratch, 'home');
mkdirSync(home, { recursive: true });
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('SUPABASE_') || k.startsWith('SUPABASE_TRIPWIRE'))),
  SUPABASE_HOME: home,
  SUPABASE_NO_KEYRING: '1',
  SUPABASE_EXPERIMENTAL_STACK: '1',
  DO_NOT_TRACK: '1',
};

const steps = [];
const fail = (msg) => { throw new Error(msg); };
const check = (cond, msg) => { if (!cond) fail(msg); };
const step = (name, fn) => {
  const t = Date.now();
  const value = fn();
  steps.push(`ok   ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  console.log(steps.at(-1));
  return value;
};

let cli = process.env.SUPABASE_TRIPWIRE_CLI;
const sb = (cwd, args, { ok = true, timeout = 240_000, extraEnv = {} } = {}) => {
  const r = spawnSync(cli, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  if (ok && r.status !== 0) fail(`supabase ${args.join(' ')} exited ${r.status} ${r.signal ?? ''}\n${r.stderr}\n${r.stdout}`);
  return r;
};
const json = (cwd, args, opts) => {
  const r = sb(cwd, [...args, '--output-format', 'json'], opts);
  try { return JSON.parse(r.stdout); } catch { return fail(`not JSON from supabase ${args.join(' ')}:\n${r.stdout.slice(0, 400)}`); }
};
// The port-validating read of a stack URL: an empty port silently means 5432 elsewhere in the CLI.
const requirePort = (url, what) => {
  const u = new URL(url);
  check(u.hostname === '127.0.0.1' && /^\d+$/.test(u.port) && u.port !== '5432', `${what}: not a loopback URL with an explicit stack port: ${url}`);
  return +u.port;
};
// --agent no: under an AI agent (AI_AGENT, CLAUDECODE) the CLI wraps rows in { advisory, boundary, rows, warning }, so the
// shape depends on who is running it. Pinned here, and asserted.
const query = (cwd, sql) => {
  const r = json(cwd, ['db', 'query', sql, '--agent', 'no']);
  check(Array.isArray(r), `db query --agent no is not a bare row array: ${JSON.stringify(r).slice(0, 200)}`);
  return r;
};
const owned = (id) => readdirSync('/proc').filter((p) => /^\d+$/.test(p)).filter((p) => {
  try { return readFileSync(`/proc/${p}/cmdline`, 'latin1').includes(id); } catch { return false; }
});
const projects = [];

let exit = 1;
try {
  check(process.platform === 'linux', 'native runtime contract is only checked on linux');
  check(userInfo().uid !== 0, 'native refuses root without SUPABASE_NATIVE_POSTGRES_USER');
  if (!cli) step(`install supabase@${PIN} (exact)`, () => {
    const dir = join(scratch, 'cli');
    mkdirSync(dir);
    execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' });
    execFileSync('npm', ['install', '--save-exact', '--ignore-scripts=false', `supabase@${PIN}`], { cwd: dir, stdio: 'ignore', env });
    cli = join(dir, 'node_modules/.bin/supabase');
  });
  const version = sb(scratch, ['--version']).stdout.trim();
  check(version === PIN, `pin not honoured: ${version}`);

  const a = join(scratch, 'a');
  const b = join(scratch, 'a-wt');
  projects.push(a, b);
  step('fixture: git repo + worktree, config without port keys', () => {
    mkdirSync(a);
    const git = (...args) => execFileSync('git', args, { cwd: a, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    sb(a, ['init']);
    const config = readFileSync(join(a, 'supabase/config.toml'), 'utf8');
    check(/^\s*\[experimental\][^[]*^stack = true/m.test(config), 'init did not write [experimental] stack = true');
    const active = config.split('\n').filter((l) => /^\s*[a-z_]*port\s*=/.test(l));
    check(active.length === 0, `init wrote active port keys under the stack backend: ${active}`);
    mkdirSync(join(a, 'supabase/migrations'));
    writeFileSync(join(a, 'supabase/migrations/20260101000000_init.sql'), 'create table public.tripwire_base(v text);\n');
    writeFileSync(join(a, 'supabase/seed.sql'), "insert into public.tripwire_base(v) values ('seeded');\n");
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    git('worktree', 'add', '-q', '-b', 'wt', b);
  });

  const started1 = step('start --runtime native (database only, on-demand artifacts)', () => json(a, ['start', '--runtime', 'native', '--preparation', 'on-demand', '-x', 'rest,auth,realtime,storage,functions,studio,mail,analytics,pooler']));
  check(started1.runtime === 'native', `start JSON runtime: ${started1.runtime}`);
  check(typeof started1.id === 'string' && started1.id.length > 0, 'start JSON lacks id');
  check(started1.endpoints?.['database.sql']?.port > 0, 'start JSON lacks endpoints["database.sql"].port');
  const dbPort = requirePort(started1.env?.DB_URL ?? '', 'start JSON env.DB_URL');
  check(started1.endpoints['database.sql'].port === dbPort, 'endpoint and DB_URL disagree on the port');

  step('status JSON shape', () => {
    const s = json(a, ['status']);
    check(s.identity?.id === started1.id, 'status identity.id');
    check(s.runtime === 'native', 'status runtime');
    check(s.owner === 'reachable', `status owner: ${s.owner}`);
    check(s.lifecycle === 'running', `status lifecycle: ${s.lifecycle}`);
    const database = s.composition?.members?.find((m) => m.service === 'database');
    check(database?.state === 'running' && database?.health === 'healthy', `status database member: ${JSON.stringify(database)}`);
    check(s.env?.DB_URL === started1.env.DB_URL, 'status env.DB_URL');
    const l = json(a, ['stack', 'list']);
    check(l.stacks?.some((x) => x.id === started1.id && x.runtime === 'native' && x.owner === 'reachable'), 'stack list entry');
  });

  step('migration up', () => {
    writeFileSync(join(a, 'supabase/migrations/20260102000000_second.sql'), 'create table public.tripwire_second(v text);\n');
    sb(a, ['migration', 'up']);
    check(JSON.stringify(query(a, "select to_regclass('public.tripwire_second')::text r")).includes('tripwire_second'), 'migration did not create its table');
  });

  step('db diff reports drift', () => {
    sb(a, ['db', 'query', 'create table public.tripwire_drift(v text);']);
    const r = sb(a, ['db', 'diff']);
    check((r.stdout + r.stderr).includes('tripwire_drift'), `db diff did not name the drifted table:\n${r.stdout}\n${r.stderr}`);
  });

  // The keeper's liveness read (internal file: this is the check that tells us when it moves).
  step('owner.json names a live detached owner', () => {
    const o = JSON.parse(readFileSync(join(home, 'stacks', started1.id, 'owner.json'), 'utf8'));
    check(o.lifetime === 'detached' && Number.isInteger(o.pid) && existsSync(`/proc/${o.pid}`), `owner.json: pid ${o.pid}, lifetime ${o.lifetime}`);
  });

  const pinned = 40000 + Math.floor(Math.random() * 9000);
  const started2 = step('second stack in a git worktree, port pinned by SUPABASE_DB_PORT', () => json(b, ['start', '--runtime', 'native', '--preparation', 'on-demand', '-x', 'rest,auth,realtime,storage,functions,studio,mail,analytics,pooler'], { extraEnv: { SUPABASE_DB_PORT: String(pinned) } }));
  const db2 = requirePort(started2.env?.DB_URL ?? '', 'worktree start env.DB_URL');
  check(db2 === pinned, `SUPABASE_DB_PORT not honoured: asked ${pinned}, got ${db2}`);
  check(started2.id !== started1.id, 'worktree shares the stack id');
  check(db2 !== dbPort, 'worktree shares the database port');

  step('isolation through a reset', () => {
    sb(b, ['db', 'query', "insert into public.tripwire_base(v) values ('only-in-b');"]);
    const before = JSON.stringify(query(a, "select count(*) n from public.tripwire_base where v = 'only-in-b'"));
    check(/"n":\s*"?0/.test(before), `b's row is visible in a: ${before}`);
    sb(a, ['db', 'reset']);
    const after = JSON.stringify(query(b, "select count(*) n from public.tripwire_base where v = 'only-in-b'"));
    check(/"n":\s*"?1/.test(after), `a's reset touched b: ${after}`);
  });

  step('db reset dropped drift, reapplied, seeded, kept ports', () => {
    const r = JSON.stringify(query(a, "select to_regclass('public.tripwire_drift')::text d, to_regclass('public.tripwire_second')::text m, (select count(*) from public.tripwire_base where v = 'seeded') s"));
    check(/"d":\s*null/.test(r) && r.includes('tripwire_second') && /"s":\s*"?1/.test(r), `state after reset: ${r}`);
    const s = json(a, ['status']);
    check(requirePort(s.env.DB_URL, 'status after reset') === dbPort, 'db port moved across reset');
  });

  step('stop keeps data; start resumes on the same port', () => {
    sb(a, ['db', 'query', "insert into public.tripwire_base(v) values ('survives-stop');"]);
    const stopped = json(a, ['stop']);
    check(stopped.stopped?.includes(started1.id), `stop JSON: ${JSON.stringify(stopped)}`);
    const s = json(a, ['status'], { ok: false });
    check(s.owner !== 'reachable', 'owner still reachable after stop');
    const again = json(a, ['start', '--runtime', 'native', '--preparation', 'on-demand', '-x', 'rest,auth,realtime,storage,functions,studio,mail,analytics,pooler']);
    check(requirePort(again.env.DB_URL, 'resume') === dbPort, 'db port moved across stop/start');
    const r = JSON.stringify(query(a, "select count(*) n from public.tripwire_base where v = 'survives-stop'"));
    check(/"n":\s*"?1/.test(r), `data did not survive stop: ${r}`);
  });

  step('destroy removes the stacks and every process of them', () => {
    for (const [dir, id] of [[a, started1.id], [b, started2.id]]) {
      sb(dir, ['stop']);
      sb(dir, ['stack', 'destroy', '--yes']);
      check(!existsSync(join(home, 'stacks', id, 'state.json')), `state.json left for ${id}`);
      check(owned(id).length === 0, `processes left for ${id}: ${owned(id)}`);
    }
  });
  exit = 0;
} catch (e) {
  console.error(`FAIL ${e.message}`);
} finally {
  for (const p of projects) {
    if (!existsSync(p) || !cli) continue;
    spawnSync(cli, ['stop'], { cwd: p, env, stdio: 'ignore', timeout: 60_000 });
    spawnSync(cli, ['stack', 'destroy', '--yes'], { cwd: p, env, stdio: 'ignore', timeout: 60_000 });
  }
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`${exit === 0 ? 'PASS' : 'FAIL'} in ${((Date.now() - started) / 1000).toFixed(0)}s; supabase@${PIN}`);
process.exit(exit);
