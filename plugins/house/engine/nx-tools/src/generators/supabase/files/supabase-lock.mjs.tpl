// The per-stack lock around `start`, `stop` and `db reset`. GENERATOR-OWNED.
//
// THE HOLDERS ARE THE WHOLE OF WHAT IS WORKING. The CLI runs in a session of its own and outlives the process that asked for it, so a
// lock naming only that process would come free in the middle of a `db reset`: the one thing it exists to prevent. So `cli` adds each
// child it runs under the lock, and the lock is held while any of them lives. One line per holder, pid and kernel start time, because
// a holder must be able to die without leaving it held.
import { appendFileSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { treeHome } from './layout.mjs';

const POLL_MS = 100;
const SAID_MS = 10_000;

/** A running process's kernel start time. A zombie has none: where PID 1 reaps nothing (a container with no init), a dead holder stays in the table for good. */
const processStart = (pid) => {
  if (!/^\d+$/.test(pid)) return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'latin1');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[0] === 'Z' ? undefined : fields[19];
  } catch {
    return undefined;
  }
};

const holderLine = (pid) => `${pid} ${processStart(String(pid))}\n`;

const lockFile = () => join(treeHome(), 'supabase.lock');

function tryLock(file) {
  // Whole from its first instant: a link is atomic with its content, and a lock read half-written would read as nobody's.
  const mine = `${file}.${process.pid}.new`;
  writeFileSync(mine, holderLine(process.pid));
  try {
    linkSync(mine, file);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    rmSync(mine, { force: true });
  }
  let held;
  try {
    held = readFileSync(file, 'utf8');
  } catch {
    return false; // let go between the two: the next try may have it
  }
  const lives = held.split('\n').filter(Boolean).some((line) => {
    const [pid, started] = line.split(' ');
    return started !== undefined && processStart(pid) === started;
  });
  if (lives) return false;
  // Its holders are gone. Taken over by a rename, which only one of several can win; if what moved is not what was read, put it back.
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

let ours;

/** A child doing this holder's work: the lock stays held while it lives, whatever happens to this process. Outside the lock, nothing. */
export function holdFor(pid) {
  if (ours) appendFileSync(ours, holderLine(pid));
}

/** Run `body` holding the lock. `giveUp` says to stop waiting: `body` does not run. `say` hears about a long wait. */
export async function withStackLock(body, { giveUp = () => false, say = () => {} } = {}) {
  const file = lockFile();
  mkdirSync(treeHome(), { recursive: true });
  let said = Date.now();
  while (!tryLock(file)) {
    if (giveUp()) return undefined;
    if (Date.now() - said > SAID_MS) {
      say('waiting for this stack\'s start, stop or reset to finish…');
      said = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  ours = file;
  try {
    return await body();
  } finally {
    ours = undefined;
    rmSync(file, { force: true });
  }
}
