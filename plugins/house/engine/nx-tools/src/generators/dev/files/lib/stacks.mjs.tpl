// Running stacks — each one's IDENTITY and the RUN RECORD that is its handle. GENERATOR-OWNED
// (@bespunky/nx-tools:dev); rewritten every sync.
//
// A stack is (tree, app, offset): one serve of one app from one worktree on one port block. Two stacks of the
// same tree are as separate as two trees, so anything a stack's processes keep as discovery state (the Firebase
// hub locator, a tool's tmp files) lives in the stack's OWN directory, never in a place every stack shares:
//
//   <tree>/.bespunky/run/<app>@<offset>.json   the run record — who is serving, on which ports, as which PID
//   <tree>/.bespunky/run/<app>@<offset>/       the stack's state dir, handed to every process as DEV_STACK_DIR
//   <state dir>/detached/<id>.json             DETACHED WORK a process registered (see detachedWork below)
//
// `.bespunky/run/` ignores itself (a `.gitignore` of `*`), so it is never committed and needs no line in the
// project's own .gitignore — in a worktree branched before this existed, too.
//
// The record is what lets anyone — the developer, Claude, a subagent's parent — find a stack and stop it BY
// HANDLE (`tools/dev/dev ps`, `tools/dev/dev stop`) instead of guessing at process names. A record is never
// trusted blindly: a PID is the stack's only while the process behind it is the very one that wrote the record
// (same host, same kernel start time, still the dev engine). Anything else is stale and is pruned.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';

export const RUN_DIR = '.bespunky/run';

export const stackKey = (app, offset) => `${app}@${offset}`;
export const stackDir = (tree, app, offset) => join(tree, RUN_DIR, stackKey(app, offset));
const recordFile = (tree, key) => join(tree, RUN_DIR, `${key}.json`);

/** Create `.bespunky/run/` (self-ignoring) and the stack's state dir. */
export function ensureStackDir(tree, app, offset) {
  const run = join(tree, RUN_DIR);
  mkdirSync(run, { recursive: true });
  const ignore = join(run, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '# Running dev stacks (tools/dev) — machine-local, never committed.\n*\n');
  const dir = stackDir(tree, app, offset);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Who a stack belongs to — what `dev stop` checks before it signals anything, so nobody stops a stack they did
 * not start without saying so (`--any-owner`). An explicit label wins (`--owner=<x>`, or DEV_OWNER in the
 * environment — what a subagent passes to keep its stacks apart from its siblings'); a Claude Code session is
 * itself (its subagents share it); anyone else is their OS user.
 */
export function ownerOf(env, explicit) {
  if (explicit) return explicit;
  if (env.DEV_OWNER) return env.DEV_OWNER;
  if (env.CLAUDE_CODE_SESSION_ID) return `claude:${env.CLAUDE_CODE_SESSION_ID}`;
  try {
    return `user:${userInfo().username}`;
  } catch {
    return 'user';
  }
}

/** A process's kernel start time — with the PID, a process's identity (a PID alone is reused). null if unknown. */
export function processStart(pid) {
  try {
    // /proc/<pid>/stat: "pid (comm) state …" — comm may hold spaces, so count fields after the last ')'.
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch {
    /* not Linux, or gone */
  }
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function commandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
  } catch {
    /* not Linux, or gone */
  }
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/** Write a stack's record — atomically, so a reader never sees half of one. */
export function writeRecord(record) {
  const file = recordFile(record.tree, record.key);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, file);
}

/**
 * Remove a stack's record and state dir — only if still THIS process's (a newer stack may have taken the key), and
 * never while its detached work runs: the record is then that work's only handle (`ps` shows it as finishing), and
 * the state dir holds its files. Returns whether it removed them.
 */
export function removeRecord(tree, key, pid = process.pid) {
  const file = recordFile(tree, key);
  try {
    if (JSON.parse(readFileSync(file, 'utf8')).pid !== pid) return false;
  } catch {
    return false; // already gone, or unreadable — nothing of ours to remove
  }
  if (unfinished(tree, key).length) return false;
  rmSync(file, { force: true });
  rmSync(join(tree, RUN_DIR, key), { recursive: true, force: true });
  return true;
}

/** Is `pid` still the very process that was recorded (alive, and started at the recorded kernel time)? */
const isSameProcess = (pid, start) => isAlive(pid) && (!start || processStart(pid) === start);

/**
 * DETACHED WORK — what a stack's process deliberately runs OUTSIDE the process tree, because it must outlive
 * whatever stops it. The case it exists for: an emulator suite's export. Every supervisor (Nx's tree kill, a
 * terminal's Ctrl+C) signals the leaves of a tree first and force-kills the rest within seconds; an export
 * takes half a minute and dies with the first signal that reaches its JVMs. So tools/emulators.sh runs the suite
 * under a detached keeper and registers it here: `<state dir>/detached/<id>.json` =
 *   { id, what, pid, procStart, status: running | stopping | exited, doing, log, code, result }
 * The engine never signals it — its owner does. The engine WAITS for it: a stack is not stopped until its
 * detached work has finished, and its state dir (where that work keeps its files) is not removed before then.
 */
export function detachedWork(dir) {
  const at = join(dir, 'detached');
  let files;
  try {
    files = readdirSync(at).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const entry = JSON.parse(readFileSync(join(at, f), 'utf8'));
      if (entry && typeof entry.pid === 'number') out.push({ ...entry, file: join(at, f), alive: isSameProcess(entry.pid, entry.procStart) });
    } catch {
      /* mid-write — the next read sees it */
    }
  }
  return out;
}

/** The detached work of a stack that is still running. */
export const unfinished = (tree, key) => detachedWork(join(tree, RUN_DIR, key)).filter((w) => w.alive);

/** The stack's recorded processes that are still the very processes it spawned. */
export function survivors(record) {
  return (record.processes ?? []).filter((p) => isSameProcess(p.pid, p.procStart));
}

/**
 * The state of a record:
 *   live      the serve that wrote it is running
 *   orphaned  the serve is gone (killed too hard to clean up — SIGKILL, OOM) but processes it spawned still run;
 *             the record is their only handle, so it is KEPT — `dev stop` stops exactly those
 *   finishing the serve and its processes are gone, but DETACHED work of theirs still runs (an emulator suite
 *             saving its data) — nothing to stop, only to wait for; the record is kept until it is done
 *   foreign   written on another host (another container sharing the tree) — cannot be verified from here
 *   dead      the serve and everything it spawned are gone
 */
export function recordState(record) {
  if (record.host !== hostname()) return 'foreign';
  // A PID is the serve's only while the process behind it is the one that wrote the record: the kernel reuses PIDs.
  const serving = isSameProcess(record.pid, record.procStart) && /\bdev\.mjs\b/.test(commandLine(record.pid));
  if (serving) return 'live';
  if (survivors(record).length) return 'orphaned';
  return unfinished(record.tree, record.key).length ? 'finishing' : 'dead';
}

/** Every record in `trees`, with its state. Dead ones are PRUNED (record and state dir deleted) unless `prune` is false. */
export function readStacks(trees, { prune = true } = {}) {
  const out = [];
  for (const tree of trees) {
    const dir = join(tree, RUN_DIR);
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const f of files) {
      let record;
      try {
        record = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        continue; // mid-write, or not ours
      }
      if (!record || typeof record.pid !== 'number' || typeof record.key !== 'string') continue;
      const state = recordState(record);
      if (state === 'dead' && prune) {
        rmSync(join(dir, f), { force: true });
        rmSync(join(dir, record.key), { recursive: true, force: true });
        continue;
      }
      out.push({ ...record, state });
    }
  }
  return out;
}
