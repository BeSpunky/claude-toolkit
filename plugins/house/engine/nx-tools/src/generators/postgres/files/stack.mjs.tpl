// Which running server a local verb means. GENERATOR-OWNED.
//
// A verb never takes a URL: it computes the address from this tree's running stack. The engine's public `dev ps --json` is the
// one place that says what runs, and `runningStacks` below is the ONE place that reads it: its shape is the engine's contract.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DEV_ENGINE, NX, PORT_NAME, READY_MARKER, ROOT, Refusal, clusterHome, declaredMajor, identityFile } from './layout.mjs';
import { query, scrubbedEnv } from './tools.mjs';

const sameTree = (path) => {
  try {
    return realpathSync(path) === realpathSync(ROOT);
  } catch {
    return false;
  }
};

/**
 * This tree's stacks that hold a Postgres port: `{ key, offset, port, state, starting }`. Starting until the launcher has
 * migrated and seeded, which only it knows: a server that answers may still be doing either, and a verb would collide with it.
 */
export function runningStacks() {
  const ps = spawnSync(process.execPath, [DEV_ENGINE, 'ps', '--json'], { cwd: ROOT, env: scrubbedEnv(), encoding: 'utf8' });
  if (ps.status !== 0) throw new Refusal(`tools/dev/dev ps failed: ${(ps.stderr || ps.stdout || ps.error?.message || '').trim()}`);
  let rows;
  try {
    rows = JSON.parse(ps.stdout);
  } catch (error) {
    throw new Refusal(`tools/dev/dev ps --json did not print JSON (${error.message}).`);
  }
  return rows
    .filter((row) => sameTree(row.tree) && row.ports?.[PORT_NAME])
    .map((row) => ({ key: row.key, offset: row.offset, port: row.ports[PORT_NAME], state: row.state, starting: row.state === 'live' && !existsSync(join(row.stateDir, READY_MARKER)) }));
}

const line = ({ key, port, state, starting }) => `  ${key}: port ${port}, ${starting ? 'starting' : state}`;

/** The stack this verb means: the only one, or the one `--offset` names. */
export function addressedStack(offset) {
  const stacks = runningStacks();
  const live = stacks.filter((stack) => stack.state === 'live');
  if (offset !== undefined) {
    const named = live.find((stack) => stack.offset === Number(offset));
    if (named) return usable(named);
    throw new Refusal(`No Postgres stack of this tree is on offset ${offset}.${stacks.length ? `\nRunning here:\n${stacks.map(line).join('\n')}` : ''}`);
  }
  if (live.length > 1) {
    throw new Refusal(`Several Postgres stacks run in this tree. Say which, with --offset=<n>:\n${live.map(line).join('\n')}`);
  }
  if (live.length === 1) return usable(live[0]);
  if (stacks.length) {
    throw new Refusal(`No usable Postgres stack in this tree:\n${stacks.map(line).join('\n')}\nSee tools/dev/dev ps, which names the command that clears each one.`);
  }
  // Under an agent, the launcher itself: Nx would show nothing of it, neither the port nor how to stop it.
  throw new Refusal(`No Postgres is running in this tree. Start one: ${process.env.CLAUDECODE === '1' ? 'node tools/postgres/postgres.mjs start' : `${NX} run postgres:start`} (serving an app starts its own, when it declares one).`);
}

function usable(stack) {
  if (stack.starting) throw new Refusal(`${stack.key} is still starting. Try again when tools/dev/dev ps says it is up.`);
  return stack;
}

/**
 * Is the server on this port the one this stack created? Compared over a connection, against the value recorded when the
 * cluster was created, because a tunnel, a stale port or another server on that port all pass any check of a host string.
 * Fails closed: no record, or no answer, is a refusal.
 */
export async function assertIdentity(stack, { signal } = {}) {
  const major = declaredMajor();
  const recordFile = identityFile(clusterHome(stack.key, major));
  if (!existsSync(recordFile)) {
    throw new Refusal(`${stack.key} has no recorded identity for Postgres ${major} (${recordFile}), so nothing can say whose server is on port ${stack.port}. Refusing. If the major just changed, restart the stack.`);
  }
  const recorded = readFileSync(recordFile, 'utf8').trim();
  let found;
  try {
    found = await query(stack.port, 'SELECT system_identifier FROM pg_control_system()', { database: 'postgres', signal });
  } catch (error) {
    throw new Refusal(`Could not read the identity of the server on port ${stack.port}, so refusing: ${error.message}`);
  }
  if (found !== recorded) {
    throw new Refusal(`The server on port ${stack.port} is not the one ${stack.key} created (system_identifier ${found}, recorded ${recorded}). Refusing: something else holds this port. See tools/dev/dev ps.`);
  }
}
