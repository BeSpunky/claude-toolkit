// The keeper: the foreground process that stands for a Supabase stack under the dev engine. GENERATOR-OWNED.
//
// THE STACK DAEMONISES, with no foreground mode and nothing that inherits a descriptor, so it cannot hold the engine's lock itself.
// The keeper does (fd 3), for as long as the stack runs: it starts the stack, watches its owner, and stops it on a signal.
//
// THE ACCEPTED GAP. `kill -9` of the keeper leaves the stack running, with its ports held, and invisible to `tools/dev/dev ps`: the lock
// died with the only process holding it. The next start in this tree adopts it, data and all. A tree nobody starts again stays up until
// `supabase stop` from that tree. Nothing short of the CLI exposing its session lifetime closes this.
//
// ONE STACK PER TREE. That is the CLI's model: the stack belongs to the worktree. Two dev stacks in one tree (a serve and a `postgres:start`)
// would be one database under two claims, so the second is refused.
import { spawn } from 'node:child_process';
import { existsSync, fstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { ROOT, READY_MARKER, Refusal, treeHome, verbCommand } from './layout.mjs';
import { assertNotHeldElsewhere, holdOwnership } from './server.mjs';
import { runningStacks } from './stack.mjs';
import { ALLOCATES_FROM, allStacks, assertNoEnvFileOverride, assertPinnedVersion, checkMigrations, cli, dbQuery, destroyStack, hasMigrations, migrationsEnabled, ownerRunning, portGap, requestedPorts, startStack, stackStatus, stopStack, supabaseHome } from './supabase-cli.mjs';
import { withStackLock as lockedBy } from './supabase-lock.mjs';

const OWNER_POLL_MS = 250;
const log = (line) => console.log(`[postgres] ${line}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The per-stack lock (supabase-lock.mjs), saying so when it has to wait. */
export const withStackLock = (body, options = {}) => lockedBy(body, { say: log, ...options });

/** What a failed `start` says after a reset was interrupted: nothing but a rebuild recovers these. */
const WEDGED = /\.supabase-postgres-init-pending|postmaster\.opts|partial lifecycle state|no recorded identity/;

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
  // First: the check itself goes through the CLI, and so through the door this shuts.
  assertNoEnvFileOverride();
  const status = await stackStatus();
  if (!status.id) throw new Refusal(`This tree has no Supabase stack, so nothing can say whose server is on port ${stack.port}. Refusing.`);
  if (status.dbPort !== stack.port) throw new Refusal(`${stack.key} holds port ${stack.port}, and this tree's Supabase stack answers on ${status.dbPort ?? 'none'}. Refusing: a verb here would reach another server than the one named. See tools/dev/dev ps.`);
  const [{ dir } = {}] = await dbQuery("select current_setting('data_directory') dir");
  const home = join(realpathSync(supabaseHome()), 'stacks', status.id) + sep;
  if (!dir?.startsWith(home)) throw new Refusal(`The server on port ${stack.port} keeps its data in ${dir}, not in this stack's ${home}. Refusing: something else holds this port. See tools/dev/dev ps.`);
}

/** A start that exited 0 and cannot be read has a stack running, with no keeper yet to stop it: stopped here, or nothing ever would. */
async function startOrStop(requested) {
  try {
    return await startStack(requested);
  } catch (error) {
    await stopStack().catch((failure) => log(`and it could not be stopped: ${failure.message}`));
    throw error;
  }
}

async function startOnBlock(requested, { rebuildIfWedged }) {
  let started = await startOrStop(requested);
  if (started.code !== undefined && WEDGED.test(started.text) && rebuildIfWedged) {
    log('this stack was left half-built by an interrupted reset. Rebuilding it, as asked.');
    await destroyStack();
    started = await startOrStop(requested);
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
    started = await startOrStop(requested);
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

/** Rows that are someone's, where a stack keeps them: read by name, since a half-built stack may not have the table. */
const rowsIn = (table) => `case when to_regclass('${table}') is null then 0 else (xpath('/row/c/text()', query_to_xml('select count(*) c from ${table}', false, true, '')))[1]::text::int end`;
/** The schemas a stack makes for itself. One missing here only means a rebuild does not happen: that is the safe way to be wrong. */
const STACK_SCHEMAS = ['pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', '_realtime', 'extensions', 'graphql', 'graphql_public', 'pgbouncer', 'vault', 'net', 'supabase_functions', 'supabase_migrations', '_analytics', '_supavisor', 'pgsodium', 'pgsodium_masks'];
const LEDGER_QUERY = `select to_regclass('supabase_migrations.schema_migrations')::text ledger, (select count(*)::int from pg_tables where schemaname not in (${STACK_SCHEMAS.map((name) => `'${name}'`).join(', ')})) tables, ${rowsIn('auth.users')} + ${rowsIn('storage.objects')} kept`;

/**
 * Throw unless the database is really there, on a new connection. An interrupted reset leaves a stack that says it is healthy, with no
 * ledger and nothing of anyone's: rebuilt, once. A reset destroys, so it asks for proof that nothing is lost: an answer of the expected
 * shape, no table in any schema but the stack's own, no user, no stored object. No ledger is not proof by itself. The CLI makes one only
 * when it first has a migration to record, so a project with none has none, and one that has just written its first has rows to keep.
 */
async function assertLedger() {
  if (!hasMigrations() || !migrationsEnabled()) return;
  const [row] = await dbQuery(LEDGER_QUERY);
  if (typeof row?.tables !== 'number' || typeof row?.kept !== 'number' || !('ledger' in row)) throw new Refusal(`The check for this stack's ledger came back as ${JSON.stringify(row)}, not as this CLI's rows are. Refusing to guess: ${verbCommand('reset')} rebuilds it, and drops its data.`);
  if (row.ledger || row.tables || row.kept) return;
  log('this stack answers and says it is healthy, and it has no migration ledger, no tables of anyone\'s, no users and no stored objects: nothing here to keep, which is what an interrupted reset leaves. Rebuilding it from its migrations.');
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
  // Before a start, which applies migrations itself on a first boot: the same guards as every other road that runs one.
  checkMigrations();
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
    try {
      await withStackLock(stopStack);
    } finally {
      letGo();
    }
  };
  let startedStack;
  try {
    startedStack = await withStackLock(() => startOnBlock(requested, { rebuildIfWedged: resetThenStop }), { giveUp: () => stopAsked });
  } catch (error) {
    letGo();
    throw error;
  }
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
    if (!stopAsked) writeFileSync(join(stackDir, READY_MARKER), `${new Date().toISOString()}\n`);
  } catch (error) {
    // The first error is the cause: a stop failing after it is an addition, never a replacement.
    const notStopped = await stop().then(() => undefined, (failure) => failure);
    const coda = notStopped ? `\nAnd the stack could not be stopped: ${notStopped.message}` : '\nThe stack stopped with it.';
    if (error instanceof Refusal) error.message += coda;
    else console.error(`[postgres]${coda}`);
    throw error;
  }
  if (!stopAsked) {
    log(`ready on 127.0.0.1:${requested.postgres}; API ${startedStack.apiUrl}. Keys: supabase status -o env.`);
    if (startedStack.mcpUrl) log(`this stack's own MCP, local only: claude mcp add --transport http --scope local supabase-local ${startedStack.mcpUrl}`);
    if (realpathSync(ROOT).startsWith('/tmp/')) log(`this tree is under /tmp, where the Edge Runtime sees a filesystem of its own: every function here answers 404 "Function not found". Move the tree to serve them.`);
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
