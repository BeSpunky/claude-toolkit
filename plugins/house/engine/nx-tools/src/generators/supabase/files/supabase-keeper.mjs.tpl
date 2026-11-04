// The keeper: the foreground process that stands for a Supabase stack under the dev engine. GENERATOR-OWNED.
//
// THE STACK DAEMONISES, with no foreground mode and nothing that inherits a descriptor, so it cannot hold the engine's lock itself.
// The keeper does (fd 3), for as long as the stack runs: it starts the stack, watches its owner, and stops it on a signal.
//
// THE ACCEPTED GAP. `kill -9` of the keeper leaves the stack running, with its ports held, and invisible to `tools/dev/dev ps`: the lock
// died with the only process holding it. The next start in this tree adopts it, data and all. A tree nobody starts again stays up until
// `supabase stop --all`. Nothing short of the CLI exposing its session lifetime closes this.
//
// ONE STACK PER TREE. That is the CLI's model: the stack belongs to the worktree. Two dev stacks in one tree (a serve and a `postgres:start`)
// would be one database under two claims, so the second is refused.
import { spawn } from 'node:child_process';
import { existsSync, fstatSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { ROOT, READY_MARKER, Refusal, treeHome, verbCommand } from './layout.mjs';
import { assertNotHeldElsewhere, holdOwnership } from './server.mjs';
import { runningStacks } from './stack.mjs';
import { ALLOCATES_FROM, MIGRATIONS, allStacks, assertNoEnvFileOverride, assertPinnedVersion, cli, dbQuery, destroyStack, ownerRunning, portGap, requestedPorts, startStack, stackStatus, stopStack, supabaseHome } from './supabase-cli.mjs';

const OWNER_POLL_MS = 250;
const LOCK_POLL_MS = 100;
const LOCK_SAID_MS = 10_000;
const log = (line) => console.log(`[postgres] ${line}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a failed `start` says after a reset was interrupted: nothing but a rebuild recovers these. */
const WEDGED = /\.supabase-postgres-init-pending|postmaster\.opts|partial lifecycle state|no recorded identity/;

const processStart = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'latin1');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch {
    return undefined;
  }
};

const lockFile = () => join(treeHome(), 'supabase.lock');

function tryLock(file) {
  const mine = `${process.pid} ${processStart(process.pid)}\n`;
  try {
    writeFileSync(file, mine, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  let held;
  try {
    held = readFileSync(file, 'utf8');
  } catch {
    return false; // let go between the two: the next try may have it
  }
  const [pid, started] = held.trim().split(' ');
  if (processStart(pid) === started) return false;
  // Its holder is gone. Taken over by a rename, which only one of several can win; if what moved is not what was read, put it back.
  const moved = `${file}.${process.pid}`;
  try {
    renameSync(file, moved);
  } catch {
    return false;
  }
  if (readFileSync(moved, 'utf8') !== held) {
    try {
      linkSync(moved, file);
    } catch {
      // someone holds it anew: the file moved aside was theirs before that, and they are waiting on a process that is gone
    }
  }
  rmSync(moved, { force: true });
  return false;
}

/**
 * The per-stack lock around `start`, `stop` and `db reset`: run `body` holding it. An exclusive file naming its holder by pid and kernel
 * start time, because the holder must be able to die without leaving it held. `giveUp` says to stop waiting: `body` does not run.
 */
export async function withStackLock(body, { giveUp = () => false } = {}) {
  const file = lockFile();
  mkdirSync(treeHome(), { recursive: true });
  let said = Date.now();
  while (!tryLock(file)) {
    if (giveUp()) return undefined;
    if (Date.now() - said > LOCK_SAID_MS) {
      log('waiting for this stack\'s start, stop or reset to finish…');
      said = Date.now();
    }
    await sleep(LOCK_POLL_MS);
  }
  try {
    return await body();
  } finally {
    rmSync(file, { force: true });
  }
}

/** A reset in a session of its own (supabase-reset.mjs), which outlives this process. Resolves to its status. */
export function resetToCompletion() {
  const child = spawn(process.execPath, [join(ROOT, 'tools/postgres/supabase-reset.mjs')], { cwd: ROOT, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
  return new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/** Is the server this CLI addresses in this tree's stack directory? A cluster's identifier changes at every reset, a hand's too, so that cannot say. */
export async function assertStackIdentity(stack) {
  const status = await stackStatus();
  if (!status.id) throw new Refusal(`This tree has no Supabase stack, so nothing can say whose server is on port ${stack.port}. Refusing.`);
  if (status.dbPort !== stack.port) throw new Refusal(`${stack.key} holds port ${stack.port}, and this tree's Supabase stack answers on ${status.dbPort ?? 'none'}. Refusing: a verb here would reach another server than the one named. See tools/dev/dev ps.`);
  const [{ dir } = {}] = await dbQuery("select current_setting('data_directory') dir");
  const home = join(realpathSync(supabaseHome()), 'stacks', status.id) + sep;
  if (!dir?.startsWith(home)) throw new Refusal(`The server on port ${stack.port} keeps its data in ${dir}, not in this stack's ${home}. Refusing: something else holds this port. See tools/dev/dev ps.`);
}

async function startOnBlock(requested, { rebuildIfWedged }) {
  let started = await startStack(requested);
  if (started.code !== undefined && WEDGED.test(started.text) && rebuildIfWedged) {
    log('this stack was left half-built by an interrupted reset. Rebuilding it, as asked.');
    await destroyStack();
    started = await startStack(requested);
  }
  if (started.code !== undefined) {
    if (WEDGED.test(started.text)) throw new Refusal(`This stack was left half-built, by a reset that was interrupted: the CLI cannot start it. Its data went with that reset. Rebuild it from its migrations: ${verbCommand('reset')}`);
    throw new Refusal(`supabase start failed (exit ${started.code}), above.`);
  }
  let gap = portGap(requested, started.ports);
  if (gap.length) {
    // A stack on other ports with no live claim on them (checked before this) was left by a keeper killed outright, or stopped there. Pins
    // only apply to a stopped stack, and a running one keeps its ports and exits 0, so compare, move it, and compare again.
    log(`adopting this tree's stack, which runs on other ports: ${gap.join(', ')}. Moving it to this block; its data stays.`);
    await stopStack();
    started = await startStack(requested);
    if (started.code !== undefined) throw new Refusal(`supabase start failed (exit ${started.code}), above.`);
    gap = portGap(requested, started.ports);
    if (gap.length) {
      await stopStack();
      throw new Refusal(`The stack did not take the ports it was given: ${gap.join(', ')}. It is stopped.`);
    }
  }
  if (started.runtime !== 'native') {
    await stopStack();
    throw new Refusal(`This tree's stack runs on ${started.runtime}, and a stack cannot change runtime: supabase stack destroy --yes, then start again.`);
  }
  return started;
}

/** Data left by trees that are gone. A stack is the CLI's to destroy, and absence alone does not prove a tree is gone: named, never removed. */
async function reportLeftovers() {
  try {
    for (const { id, root } of await allStacks()) {
      if (root && !existsSync(root)) log(`a stack of ${root}, which is not here, keeps its data under ${join(supabaseHome(), 'stacks', id)}. If that tree is gone: supabase stack destroy --stack-id ${id} --yes`);
    }
  } catch (error) {
    log(`could not list the machine's stacks: ${error.message}`);
  }
}

/**
 * Throw unless the database is really there, on a new connection. An interrupted reset leaves a stack that says it is healthy, with no
 * ledger and nothing in `public`: rebuilt, once. No ledger is not that by itself. The CLI makes one only when it first has a migration
 * to record, so a project with none has none, and one that has just written its first has rows to keep.
 */
async function assertLedger() {
  if (!existsSync(MIGRATIONS) || !readdirSync(MIGRATIONS).some((name) => name.endsWith('.sql'))) return;
  const [{ ledger, tables } = {}] = await dbQuery("select to_regclass('supabase_migrations.schema_migrations')::text ledger, (select count(*)::int from pg_tables where schemaname = 'public') tables");
  if (ledger || tables) return;
  log('this stack answers and says it is healthy, and it has no migration ledger and no tables: a reset was interrupted here. Rebuilding it from its migrations.');
  if ((await resetToCompletion()) !== 0) throw new Refusal(`The reset that should have rebuilt it failed, above. ${verbCommand('reset')} tries again.`);
  const [{ ledger: rebuilt } = {}] = await dbQuery("select to_regclass('supabase_migrations.schema_migrations')::text ledger");
  if (!rebuilt) throw new Refusal('After a reset this stack still has no migration ledger.');
}

export async function serve({ resetThenStop = false } = {}) {
  const stackDir = process.env.DEV_STACK_DIR;
  if (!stackDir) throw new Refusal(`This verb runs inside a dev stack. Start one: ${verbCommand('start')}`);
  try {
    fstatSync(3);
  } catch {
    throw new Refusal('This verb runs inside a dev stack, which hands it the stack lock on fd 3, and fd 3 is closed.');
  }
  const key = basename(stackDir);
  const [low, high] = ALLOCATES_FROM.split('-').map(Number);
  assertPinnedVersion();
  assertNoEnvFileOverride();
  const requested = requestedPorts();
  const inRange = Object.entries(requested).find(([, port]) => port >= low && port <= high);
  if (inRange) throw new Refusal(`${inRange[0]} landed on ${inRange[1]}, inside ${ALLOCATES_FROM}, which the native runtime keeps for itself. Start on another offset.`);
  const others = runningStacks().filter((stack) => stack.key !== key);
  if (others.length) throw new Refusal(`This tree already runs ${others.map((stack) => stack.key).join(', ')}, and a tree has one Supabase stack. Use that one, or stop it: tools/dev/dev stop ${others[0].key.split('@')[0]} --offset=${others[0].offset}`);

  const ownership = join(treeHome(), 'supabase');
  mkdirSync(ownership, { recursive: true });
  assertNotHeldElsewhere(ownership);

  // Signals never interrupt what is underway: the CLI is in its own session, and they only say what to do next.
  let stopAsked = false;
  let wake = () => {};
  for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(name, () => {
      stopAsked = true;
      wake();
    });
  }
  let lostTo;
  const letGo = holdOwnership(ownership, (host) => {
    lostTo = host;
    wake();
  });

  const stop = async () => {
    await withStackLock(stopStack);
    letGo();
  };
  const startedStack = await withStackLock(() => startOnBlock(requested, { rebuildIfWedged: resetThenStop }), { giveUp: () => stopAsked });
  if (!startedStack) {
    letGo();
    return 0;
  }
  try {
    await reportLeftovers();
    await assertStackIdentity({ key, port: requested.postgres });
    if (resetThenStop) {
      if ((await resetToCompletion()) !== 0) throw new Refusal('The reset failed, above.');
      await stop();
      log(`${key} is reset: migrated and seeded from nothing. Its stack was started for this, and stopped.`);
      return 0;
    }
    await assertLedger();
    const pending = await cli(['migration', 'up'], { echo: true });
    if (pending.code !== 0) throw new Refusal(`Migrating failed. If the database itself is what is wrong, rebuild it from its migrations (this drops its data): ${verbCommand('reset')}`);
  } catch (error) {
    await stop();
    if (error instanceof Refusal) error.message += '\nThe stack stopped with it.';
    throw error;
  }
  if (!stopAsked) {
    writeFileSync(join(stackDir, READY_MARKER), `${new Date().toISOString()}\n`);
    log(`ready on 127.0.0.1:${requested.postgres}; API ${startedStack.apiUrl}. Keys: supabase status -o env.`);
    if (startedStack.mcpUrl) log(`this stack's own MCP, local only: claude mcp add --transport http --scope local supabase-local ${startedStack.mcpUrl}`);
    log(`stop it with: tools/dev/dev stop ${key.split('@')[0]} --offset=${key.split('@')[1]}`);
  }

  const { id } = startedStack;
  while (!stopAsked && !lostTo && ownerRunning(id)) {
    await Promise.race([sleep(OWNER_POLL_MS), new Promise((resolve) => (wake = resolve))]);
  }
  if (lostTo) {
    console.error(`[postgres] container ${lostTo} took this stack's data over while it ran, so this keeper is leaving it alone and stopping.`);
    letGo();
    return 1;
  }
  if (stopAsked) {
    await stop();
    return 0;
  }
  letGo();
  console.error(`[postgres] the stack's owner went away on its own, by a supabase stop or a kill. Start again when you want it back.`);
  return 1;
}
