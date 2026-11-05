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
import { existsSync, fstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { ROOT, READY_MARKER, Refusal, treeHome, verbCommand } from './layout.mjs';
import { assertNotHeldElsewhere, holdOwnership } from './server.mjs';
import { runningStacks } from './stack.mjs';
import { ALLOCATES_FROM, allStacks, assertNoEnvFileOverride, assertPinnedVersion, checkMigrations, cli, dbQuery, destroyStack, endCliCall, hasMigrations, installArtifacts, migrationsEnabled, ownerRunning, portGap, requestedPorts, startStack, stackStatus, stopStack, supabaseHome } from './supabase-cli.mjs';
import { withStackLock as lockedBy } from './supabase-lock.mjs';

const OWNER_POLL_MS = 250;
/** The engine's ready bound does not run while this exists (`holdWhile`, generators/supabase/dev-fragment.ts): a download has its own time. */
const INSTALLING_MARKER = 'postgres.installing';
/** How long a stop waits on a CLI call before ending it: the engine's own knob, and its `dev stop` waits a minute past this. A reset is not a CLI call of this process. */
const stopDeadlineMs = () => (Number(process.env.DEV_STOP_TIMEOUT) || 180) * 1000;
const log = (line) => console.log(`[postgres] ${line}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The per-stack lock (supabase-lock.mjs), saying so when it has to wait. */
export const withStackLock = (body, options = {}) => lockedBy(body, { say: log, ...options });

/** What a failed `start` says after a reset was interrupted: nothing but a rebuild recovers these. */
const WEDGED = /\.supabase-postgres-init-pending|postmaster\.opts|partial lifecycle state|no recorded identity/;

/** A reset in a session of its own (supabase-reset.mjs), which outlives this process and declares itself in `stackDir`. Resolves to its status. */
export function resetToCompletion(stackDir = process.env.DEV_STACK_DIR) {
  const child = spawn(process.execPath, [join(ROOT, 'tools/postgres/supabase-reset.mjs')], { cwd: ROOT, env: { ...process.env, DEV_STACK_DIR: stackDir ?? '' }, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
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

/**
 * Everything pending, forward: `db push` against this stack is the CLI's own road, and it destroys nothing whatever the database holds.
 * It applies what its ledger lacks, and runs each seed file its `seed_files` table has not seen, which a first start and a reset also
 * record, so a stack seeded once is not seeded again and one that has only just got its migrations and seeds gets them now. Vault is a
 * hosted concern: a start already handles the local one. What it cannot apply (a conflict, a half-built database) is a refusal, with the
 * error above it and the reset named: only `postgres:reset` destroys.
 */
async function applyPending(key) {
  const pending = await cli(['db', 'push', '--include-seed', '--skip-vault', '--yes'], { echo: true });
  if (pending.code !== 0) throw new Refusal(`Migrating or seeding failed, above, and nothing was dropped. If the migration is wrong, fix it and start again. If the database itself is what is wrong, rebuild it from its migrations (this drops its data): ${verbCommand('reset', `--stack=${key}`)}`);
  if (!hasMigrations() || !migrationsEnabled()) return;
  // On a new connection: `status` says healthy with a half-built database.
  const [row] = await dbQuery("select to_regclass('supabase_migrations.schema_migrations')::text ledger");
  if (!row?.ledger) throw new Refusal(`This stack has migrations, and after applying them it has no ledger (${JSON.stringify(row)}). Refusing to call it ready. Rebuild it from its migrations (this drops its data): ${verbCommand('reset', `--stack=${key}`)}`);
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
  let installing = false;
  let cut = false;
  const endCall = () => {
    if (endCliCall()) {
      cut = true;
      log('ending the CLI call underway: a stop has its deadline.');
    }
  };
  let deadline;
  for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(name, () => {
      // A download is safe to cut: the next one resumes, as `tools/test-supabase` shows. Anything else gets its time.
      if (installing) endCliCall();
      else if (!deadline) {
        deadline = setTimeout(endCall, stopDeadlineMs());
        deadline.unref();
      }
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
  // The download, as a step of its own, outside the lock (the cache is shared and the CLI takes turns) and outside the ready bound.
  const installMark = join(stackDir, INSTALLING_MARKER);
  writeFileSync(installMark, '');
  installing = true;
  let installed;
  try {
    installed = await installArtifacts();
  } finally {
    installing = false;
    rmSync(installMark, { force: true });
  }
  if (stopAsked) {
    letGo();
    return 0;
  }
  if (installed.code !== 0) {
    letGo();
    throw new Refusal(`supabase stack install failed (exit ${installed.code}), above: this stack's artifacts did not download. Nothing was started. Starting again resumes it.`);
  }
  let startedStack;
  try {
    startedStack = await withStackLock(() => startOnBlock(requested, { rebuildIfWedged: resetThenStop }), { giveUp: () => stopAsked });
  } catch (error) {
    // A start cut short may have left its stack half up, with no keeper to stop it.
    if (cut) await withStackLock(stopStack).catch((failure) => log(`and it could not be stopped: ${failure.message}`));
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
    await applyPending(key);
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
