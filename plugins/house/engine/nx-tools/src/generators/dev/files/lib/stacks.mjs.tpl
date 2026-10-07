// Running stacks — each one's IDENTITY: the RUN RECORD, claimed once, that is its handle. GENERATOR-OWNED
// (@bespunky/nx-tools:dev); rewritten every sync.
//
// A stack is whatever binds a block of this project's ports: a serve of one app from one worktree on one offset
// (`<app>@<offset>`), and equally an emulator suite run on its own (`firebase@<offset>`) or a seed build's private
// suite (`seed-build@<offset>`). ONE identity for all of them, so they see each other: every one CLAIMS its record
// through claimStack() below, under one lock, before it spawns anything — and the claim is refused (or, for `auto`,
// moved to the next block) when any other stack already holds one of its ports. The ports are the resource; the
// record is who holds them, from the moment of the claim (a port probe sees a server only once it has bound —
// seconds later — which is how five concurrent serves used to land on one block and lose each other's handles).
//
//   <tree>/.bespunky/run/<key>.json        the run record — what the stack is, where, on which ports (for `ps`)
//   <tree>/.bespunky/run/locks/<id>.lock   the stack's LOCK — whether it is alive (below)
//   <tree>/.bespunky/run/<key>/            the stack's state dir (DEV_STACK_DIR, ${STACK_DIR})
//   <state dir>/detached/<id>.json         DETACHED WORK a process registered (see detachedWork below)
//   /tmp/bespunky-<hash>/                  the stack's TMPDIR (DEV_STACK_TMP) — SHORT on purpose (see stackTmp)
//
// LIVENESS IS THE KERNEL'S, AND NOTHING ELSE. A stack is alive exactly while its lock file is flock(2)ed: its claimer
// takes a SHARED lock on a fresh file before it claims and holds the descriptor for its whole life, and so does
// everything of the stack that must outlive it (the processes the engine spawns get the descriptor; an emulator
// suite's detached keeper holds it while it saves). The kernel drops the lock the instant the last of them exits —
// however it exits: SIGKILL, OOM, a container stop. So there is no takeover, no staleness rule, no heartbeat and no
// PID-table bookkeeping to get wrong: whoever asks "is it alive?" tries an EXCLUSIVE lock without waiting, and the
// kernel answers. (flock(1) of util-linux makes the call — Node has no flock of its own, and every house image is
// Debian, where util-linux is essential.)
//
// A record whose lock is free is DEAD and is pruned — record, lock, state dir and TMPDIR — but only under the claim
// lock (withClaimLock), so a prune can never race a claim of the same key. A live record of ANOTHER container (a
// workspace bind-mounted into two of them: flock is the kernel's, so its lock is seen held from here) is not
// modelled: every claim is refused, naming it.
//
// The record is what lets anyone — the developer, Claude, a subagent's parent — find a stack and stop it BY
// HANDLE (`tools/dev/dev ps`, `tools/dev/dev stop`) instead of guessing at process names.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';

import { allFree, isPortFree, noFreeBlock, offsetCandidates, portBlock } from './ports.mjs';

export const RUN_DIR = '.bespunky/run';

export const stackKey = (app, offset) => `${app}@${offset}`;
export const stackDir = (tree, key) => join(tree, RUN_DIR, key);
export const recordFile = (tree, key) => join(tree, RUN_DIR, `${key}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A claim the caller can act on (a held block, a shared workspace) — reported plainly, never as a stack. */
export class ClaimError extends Error {}

// ── KERNEL LOCKS ────────────────────────────────────────────────────────────────────────────────────────────

const CONFLICT = 75;

/**
 * flock(2) the open file description behind `fd` — through flock(1), handed the descriptor as its fd 3: the lock
 * belongs to the description, which this process keeps open, so it outlives the short flock(1) process. `wait`:
 * seconds to wait (0: not at all). Returns whether the lock was taken.
 */
function flockFd(fd, mode, wait) {
  const r = spawnSync('flock', [mode === 'x' ? '-x' : '-s', ...(wait ? ['-w', String(wait)] : ['-n']), '-E', String(CONFLICT), '3'], { stdio: ['ignore', 'ignore', 'pipe', fd] });
  if (r.error?.code === 'ENOENT') throw new ClaimError('flock(1) is missing — the dev engine needs util-linux (every house image has it): sudo apt-get install util-linux');
  if (r.status === 0) return true;
  if (r.status === CONFLICT) return false;
  throw new Error(`flock failed (${r.status ?? r.signal}): ${String(r.stderr).trim()}`);
}

/**
 * A NEW stack lock in `tree`, held SHARED by this process for as long as it lives (or until release()). The file is
 * fresh, so nobody else can know it before the claim records it. Pass `fd` to whatever must keep the stack alive
 * after this process (the engine hands it to every process it spawns).
 */
export function holdStackLock(tree) {
  const dir = join(ensureRunDir(tree), 'locks');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${process.pid}-${randomBytes(6).toString('hex')}.lock`);
  const fd = openSync(path, 'wx');
  flockFd(fd, 's', 0);
  return { path, fd, release: () => closeSync(fd) };
}

/** Is the stack lock at `path` held by anyone — is that stack alive? The kernel's answer, never a guess. */
export function isHeld(path) {
  if (typeof path !== 'string' || !path) return false;
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return false; // no lock file: nothing can hold it
  }
  try {
    return !flockFd(fd, 'x', 0);
  } finally {
    closeSync(fd);
  }
}

/** The processes of THIS process table that hold the lock file at `path` open — the kernel's list of the stack's members. */
export function lockHolders(path) {
  let target;
  try {
    target = realpathSync(path);
  } catch {
    return [];
  }
  const out = [];
  let entries = [];
  try {
    entries = readdirSync('/proc').filter((e) => /^\d+$/.test(e));
  } catch {
    return [];
  }
  for (const e of entries) {
    let fds;
    try {
      fds = readdirSync(`/proc/${e}/fd`);
    } catch {
      continue; // gone, or not ours to read
    }
    for (const f of fds) {
      try {
        if (readlinkSync(`/proc/${e}/fd/${f}`) === target) {
          out.push(Number(e));
          break;
        }
      } catch {
        /* closed meanwhile */
      }
    }
  }
  return out;
}

/**
 * ONE claim at a time, across every worktree of this repository: an exclusive flock on the MAIN tree's
 * `.bespunky/run/claim.lock`, which every worktree can reach. Held for the moments a claim takes (read the records,
 * probe the ports, write one file); the kernel drops it if the holder dies. Pruning happens only under it too.
 */
export async function withClaimLock(lockRoot, fn) {
  const fd = takeClaimLock(lockRoot);
  try {
    return await fn();
  } finally {
    closeSync(fd);
  }
}
/** The same, for a synchronous body (an exit handler). */
export function withClaimLockSync(lockRoot, fn) {
  const fd = takeClaimLock(lockRoot);
  try {
    return fn();
  } finally {
    closeSync(fd);
  }
}
function takeClaimLock(lockRoot) {
  const fd = openSync(join(ensureRunDir(lockRoot), 'claim.lock'), 'a');
  if (!flockFd(fd, 'x', 60)) {
    closeSync(fd);
    throw new ClaimError(`another claim has held ${join(lockRoot, RUN_DIR, 'claim.lock')} for 60 s — a claim takes milliseconds; find its holder with: fuser -v ${join(lockRoot, RUN_DIR, 'claim.lock')}`);
  }
  return fd;
}

// ── THE STACK'S TMPDIR ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The stack's TMPDIR — `/tmp/bespunky-<12 hex>`, keyed by tree and stack. It must be PRIVATE (firebase-tools finds
 * a running suite through `os.tmpdir()/hub-<projectId>.json`, keyed by project id alone, so two stacks sharing one
 * would export each other's data) and it must be SHORT: every Cloud Functions worker listens on a Unix socket
 * `os.tmpdir()/fire_emu_<16 hex>.sock`, and a socket path is cut at 107 bytes — silently. Under a deep worktree
 * (`<tree>/.bespunky/run/web@24000/tmp`, ~95 characters) the random part was cut away, every worker bound the
 * same name, and a call to one function was answered by another's worker. Here the socket path is ~57 bytes,
 * whatever the tree. `/tmp` itself, not the caller's TMPDIR: that may be just as deep.
 */
export function stackTmp(tree, key) {
  let real = tree;
  try {
    real = realpathSync(tree);
  } catch {
    /* not there yet — the spelling is the identity then */
  }
  return `/tmp/bespunky-${createHash('sha256').update(`${real}\0${key}`).digest('hex').slice(0, 12)}`;
}
const TMP_ROOT = '/tmp';
const OUR_TMP = /^bespunky-[0-9a-f]{12}$/;
const TMP_MARK = '.bespunky-stack';

/**
 * Make `dir` this user's PRIVATE directory, empty — /tmp is shared, and the name is predictable. Created 0700 without
 * `recursive` (which would silently accept a directory someone else made first), then checked: a directory, this
 * user's, mode 0700, not a link. One of ours left by a dead stack of the same key is emptied; anyone else's is refused.
 * It is marked with the stack's lock, so an orphan (its record removed some other way) is swept by pruneDead.
 */
function makePrivateTmp(dir, lock) {
  const uid = process.getuid?.();
  const check = () => {
    const st = lstatSync(dir);
    if (!st.isDirectory() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o777) !== 0o700) {
      throw new ClaimError(
        `${dir} is not this user's private directory (${st.isSymbolicLink() ? 'a symlink' : st.isDirectory() ? 'a directory' : 'not a directory'}, owner uid ${st.uid}, mode ${(st.mode & 0o777).toString(8)}) — refusing to run a stack's TMPDIR there. Remove it (it is not the house's), then serve again.`,
      );
    }
  };
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
    check(); // ours (refused otherwise) — a dead stack's of this key, whose prune never ran: start it empty
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { mode: 0o700 });
  }
  check();
  writeFileSync(join(dir, TMP_MARK), `${JSON.stringify({ lock })}\n`);
}

/** Remove a stack TMPDIR — only one of ours, by its exact shape. */
function dropTmp(dir) {
  if (typeof dir === 'string' && dir.startsWith(`${TMP_ROOT}/`) && OUR_TMP.test(dir.slice(TMP_ROOT.length + 1))) rmSync(dir, { recursive: true, force: true });
}

const sameDir = (a, b) => {
  try {
    return typeof a === 'string' && realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};

// ── RECORDS ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Create `.bespunky/run/` (self-ignoring). */
export function ensureRunDir(tree) {
  const run = join(tree, RUN_DIR);
  mkdirSync(run, { recursive: true });
  const ignore = join(run, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '# Running dev stacks (tools/dev) — machine-local, never committed.\n*\n');
  return run;
}

/**
 * Who a stack belongs to — what `dev stop` checks before it signals anything, so nobody stops a stack they did
 * not start without saying so (`--any-owner`). An explicit label wins (`--owner=<x>`, or DEV_OWNER in the
 * environment — what a subagent passes to keep its stacks apart from its siblings'); a Claude Code session is
 * itself; anyone else is their OS user.
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

/**
 * Is this owner SHARED by parties that do not know each other's stacks? A Claude Code session id is: the session
 * and every subagent it spawns carry the same one, so "mine" would reach a sibling's stack in the middle of its
 * test. Such an owner may stop a stack it NAMES, never one it would merely select (see `dev stop`).
 */
export const ownerIsShared = (env, explicit) => !explicit && !env.DEV_OWNER && Boolean(env.CLAUDE_CODE_SESSION_ID);

/**
 * Is an AI AGENT running this (Claude Code sets CLAUDECODE=1 in every shell it spawns)? An agent never takes the
 * project's base ports: they are forwarded to the developer's browser, and whatever the developer serves by hand
 * belongs there (the house's local-server rule — enforced here, not merely asked for).
 */
export const isAgent = (env) => env.CLAUDECODE === '1';

/**
 * THIS PROCESS TABLE — the kernel boot plus the PID namespace: which container claimed a record. Liveness never
 * depends on it (the lock answers that); it only tells a live stack of ANOTHER container sharing this workspace —
 * whose PIDs mean nothing here — so the claim can refuse instead of guessing.
 */
export function machineId() {
  try {
    return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}/${readlinkSync('/proc/self/ns/pid')}`;
  } catch {
    return `host:${hostname()}`;
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

export function commandLine(pid) {
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

/** A process that has exited but not been reaped yet — a zombie answers `kill -0`, and is nobody's stack any more. */
function isZombie(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2)[0] === 'Z';
  } catch {
    return false;
  }
}

/** Is `pid` still the very process that was recorded (alive, and started at the recorded kernel time)? */
export const isSameProcess = (pid, start) =>
  Number.isInteger(pid) && pid > 0 && isAlive(pid) && !isZombie(pid) && (!start || processStart(pid) === start);

/** The live members of process group `pgid` (Linux; elsewhere none). */
export function groupMembers(pgid) {
  let entries;
  try {
    entries = readdirSync('/proc').filter((e) => /^\d+$/.test(e));
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    try {
      const stat = readFileSync(`/proc/${e}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) === pgid && fields[0] !== 'Z') out.push(Number(e));
    } catch {
      /* exited meanwhile */
    }
  }
  return out;
}

/** Write (rewrite) a stack's record — atomically, so a reader never sees half of one. Only its claimer does. */
export function writeRecord(record) {
  const file = recordFile(record.tree, record.key);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, file);
}

function readRecord(tree, key) {
  try {
    return JSON.parse(readFileSync(recordFile(tree, key), 'utf8'));
  } catch {
    return null;
  }
}

/** The record, its lock, its state dir and its TMPDIR — gone. Only under the claim lock, only for a dead stack. */
function dropStack(tree, key, record) {
  rmSync(recordFile(tree, key), { force: true });
  rmSync(stackDir(tree, key), { recursive: true, force: true });
  dropTmp(record?.tmp);
  if (typeof record?.lock === 'string' && record.lock.startsWith(join(tree, RUN_DIR, 'locks') + '/')) rmSync(record.lock, { force: true });
}

/**
 * Let a stack go — what each of its holders does as it leaves, AFTER closing its own descriptor of the lock: under
 * the claim lock, the record `key` is removed if it is still the claim made with `lock` (a newer stack may hold the
 * key by now) and the kernel says nobody holds that lock any more. While anything of the stack still runs (an
 * emulator suite saving) it stays — the last one out removes it. Returns whether it did.
 */
export function removeRecord(lockRoot, tree, key, lock) {
  return withClaimLockSync(lockRoot, () => {
    const record = readRecord(tree, key);
    if (!record || record.lock !== lock || isHeld(lock)) return false;
    dropStack(tree, key, record);
    return true;
  });
}

/**
 * DETACHED WORK — what a stack's process deliberately runs OUTSIDE the process tree, because it must outlive
 * whatever stops it. The case it exists for: an emulator suite's export. Every supervisor (Nx's tree kill, a
 * terminal's Ctrl+C) signals the leaves of a tree first and force-kills the rest within seconds; an export
 * takes half a minute and dies with the first signal that reaches its JVMs. So tools/emulators.sh runs the suite
 * under a detached keeper and registers it here: `<state dir>/detached/<id>.json` =
 *   { id, what, pid, procStart, status: running | stopping | exited, doing, log, code, result, deadline }
 * `pid` leads its own process group: everything the work started is in that group. It holds the stack's lock, so
 * the stack lives while it does. The engine never signals it to stop — its owner does — and WAITS for it: a stack
 * is not stopped until its detached work has finished. The work owns a deadline too (`deadline`, epoch seconds,
 * once stopping): past it, it ends its own group and says so — nothing waits on it forever. The one signal anyone
 * else sends it is SIGUSR1, ABANDON NOW (`dev stop --abandon`), for when even the deadline is too long to wait.
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

/**
 * The detached work of a stack that is still running. An entry that says `exited` is done, though its process may be
 * a moment from gone.
 */
export const unfinished = (tree, key) => detachedWork(stackDir(tree, key)).filter((w) => w.alive && w.status !== 'exited');

/**
 * What still runs of a stack whose claimer is gone — what `dev stop` stops on an ORPHANED one: every process holding
 * the stack's lock (the kernel's own list of its members: the processes the engine spawned, a script's children), and
 * the members of a detached work's process group whose leader died (a keeper killed outright leaves its suite's JVMs
 * in its group — they never held the lock: Node closes inherited descriptors for what it spawns).
 */
export function survivors(record) {
  const out = lockHolders(record.lock).filter((pid) => pid !== process.pid && pid !== record.pid).map((pid) => ({ id: 'holds the stack', pid }));
  for (const w of detachedWork(stackDir(record.tree, record.key))) {
    if (w.alive) continue;
    for (const pid of groupMembers(w.pid)) if (!out.some((p) => p.pid === pid)) out.push({ id: `${w.id} (left by its keeper)`, pid });
  }
  return out;
}

/**
 * The state of a record. ALIVE OR DEAD IS THE LOCK'S ANSWER, and nothing else; the rest only says what is alive:
 *   dead      nobody holds its lock — nothing of it runs. Pruned (under the claim lock).
 *   foreign   alive, claimed in ANOTHER container sharing this workspace — not modelled: claims are refused
 *   live      alive, its claimer (a serve, a direct emulator run, a seed build) is running
 *   finishing alive, the claimer is gone but DETACHED work still runs (an emulator suite saving its data) —
 *             nothing to stop, only to wait for (or `--abandon`)
 *   orphaned  alive, the claimer is gone (killed too hard to clean up — SIGKILL, OOM) but processes of it still run;
 *             `dev stop` stops exactly those
 */
export function recordState(record) {
  if (!isHeld(record.lock)) return 'dead';
  if (record.machine !== machineId()) return 'foreign';
  if (isSameProcess(record.pid, record.procStart)) return 'live';
  return unfinished(record.tree, record.key).length ? 'finishing' : 'orphaned';
}

/** Every record in `trees` that is alive, with its state. Reads only — pruneDead() removes the dead, under the lock. */
export function readStacks(trees) {
  return records(trees).map((r) => ({ ...r, state: recordState(r) })).filter((r) => r.state !== 'dead');
}

function records(trees) {
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
      // A record speaks for the tree it sits in, and only that one: a copied or moved run dir names another tree, and
      // acting on it (a prune) would reach into that tree.
      if (!record || typeof record.key !== 'string' || `${record.key}.json` !== f || !sameDir(record.tree, tree)) continue;
      out.push(record);
    }
  }
  return out;
}

/**
 * Remove every DEAD stack of `trees` (record, lock, state dir, TMPDIR), and every orphan TMPDIR of this user whose
 * stack's lock is free (its record went some other way: a removed worktree, a `git clean`). CALL ONLY UNDER THE
 * CLAIM LOCK — that is what makes "dead" stay true until the files are gone: no claim can interleave.
 */
export function pruneDead(trees) {
  for (const r of records(trees)) if (!isHeld(r.lock)) dropStack(r.tree, r.key, r);
  let names = [];
  try {
    names = readdirSync(TMP_ROOT).filter((n) => OUR_TMP.test(n));
  } catch {
    return;
  }
  const uid = process.getuid?.();
  for (const n of names) {
    const dir = join(TMP_ROOT, n);
    try {
      if (lstatSync(dir).uid !== uid) continue;
      const { lock } = JSON.parse(readFileSync(join(dir, TMP_MARK), 'utf8'));
      if (!isHeld(lock)) dropTmp(dir);
    } catch {
      /* unmarked (being made right now) or unreadable — not ours to judge */
    }
  }
}

// ── THE CLAIM ───────────────────────────────────────────────────────────────────────────────────────────────

/** How a holder is named to whoever ran into it. */
export const describe = (s) => `${s.key} (${s.state}, pid ${s.pid}, owner ${s.owner}${s.label ? `, ${s.label}` : ''})`;

/** The exact command that stops a record's stack. */
export const stopCommandFor = (s, { abandon = false } = {}) => `tools/dev/dev stop ${s.app} --offset=${s.offset} --worktree=${s.tree}${abandon ? ' --abandon' : ''}`;

/** A live stack of another container: this workspace is shared, which nothing here models. */
const sharedWorkspace = (foreign) =>
  new ClaimError(
    `this workspace is also running stacks from ANOTHER container — ${foreign.map((s) => `${s.key} (host ${s.host ?? '?'}, pid ${s.pid} there)`).join('; ')}.\n` +
      '  One checkout served from two containers is not supported: their processes cannot see or stop each other here.\n' +
      '  Stop those stacks in the container that runs them (tools/dev/dev ps there), or give each container its own clone.',
  );

/**
 * CLAIM A STACK: pick its offset and write its record, atomically against every other claim in this repository.
 *
 *   lockRoot   the main tree (where the claim lock lives)    trees     every worktree (whose records are read)
 *   tree, app  the stack's tree and name (key `<app>@<offset>`)
 *   spec       `--port-offset` ('auto' or an offset)          treeKey, isMain   the tree's identity (lib/ports.mjs)
 *   basePorts  { name: base port } — every port the stack will bind; the record holds them shifted
 *   lock       the stack's lock (holdStackLock), already held by the claimer — the record names it; it is the stack's life
 *   agent      an AI agent is claiming (isAgent): never the base ports — `auto` skips them, an explicit 0 is refused
 *   fields     the rest of the record (owner, url, label, …)  say       progress lines
 *   claimer    the PID the record names (default: this process) — a script claiming for itself passes its own
 *   dryRun     decide, but write nothing (what `serve --dry-run` prints)
 *   probe      is a port free of anything bound (injected for tests)
 *
 * A block held by any live stack is never taken: `auto` moves on to the next candidate, an explicit offset is refused
 * naming the holder and how to stop it. The PREFERRED block held only by THIS stack's own previous run while it
 * finishes (an emulator suite saving after a Ctrl+C) is waited for, then taken — so the next `nx serve` lands back on
 * the same ports instead of beside a save. `auto` also needs every port actually free (something no stack claims may
 * be bound there); an explicit offset is taken as asked.
 *
 * Returns `{ record, passed }`: `passed` the stacks holding the preferred block when `auto` had to move off it.
 */
export async function claimStack({ lockRoot, trees, tree, app, spec, treeKey, isMain, basePorts, lock, agent = false, claimer = process.pid, dryRun = false, fields = {}, say = () => {}, probe = isPortFree, waitMs = 180_000 }) {
  const base = Object.values(basePorts);
  const { pinned, offsets } = offsetCandidates(spec, { key: treeKey, isMain: isMain && !agent, block: portBlock(base) });
  if (agent && pinned && offsets[0] === 0) {
    throw new ClaimError(
      "--port-offset=0 is refused: an AI agent never takes the project's base ports — they are forwarded to the developer's browser, " +
        'and the server the developer runs by hand belongs there. Serve with --port-offset=auto (the default): an isolated block, its URL printed.',
    );
  }
  if (!dryRun && !isHeld(lock)) throw new ClaimError(`the stack's lock ${lock ?? '(none)'} is not held — a claimer holds its lock (holdStackLock) before it claims`);
  const started = Date.now();
  for (;;) {
    let waitFor = null;
    const claimed = await withClaimLock(lockRoot, async () => {
      pruneDead(trees);
      const stacks = readStacks(trees);
      const foreign = stacks.filter((s) => s.state === 'foreign');
      if (foreign.length) throw sharedWorkspace(foreign);
      const passed = [];
      let chosen;
      for (const [i, offset] of offsets.entries()) {
        const ports = new Set(base.map((p) => p + offset));
        const held = stacks.filter((s) => Object.values(s.ports ?? {}).some((p) => ports.has(p)));
        const ownPrevious = held.length > 0 && held.every((s) => s.state === 'finishing' && s.key === stackKey(app, offset) && s.tree === tree);
        if (ownPrevious && (pinned || i === 0) && !dryRun) {
          waitFor = held[0];
          return null;
        }
        if (held.length) {
          if (pinned) {
            throw new ClaimError(
              `offset ${offset} is held — ${held.map(describe).join('; ')}.\n` +
                held.map((s) => `  ${s.state === 'finishing' ? 'Wait for it, or end it' : 'Use it, or stop it'}: ${stopCommandFor(s, { abandon: s.state === 'finishing' })}`).join('\n') +
                '\n  Or serve another stack beside it: --port-offset=auto',
            );
          }
          if (i === 0) passed.push(...held);
          continue;
        }
        if (!pinned && !(await allFree(base, offset, probe))) continue;
        chosen = offset;
        break;
      }
      if (chosen === undefined) {
        const err = noFreeBlock(portBlock(base), isMain && !agent);
        const holders = stacks.filter((s) => Object.values(s.ports ?? {}).length);
        throw new ClaimError(`${err.message}${holders.length ? `\n  Claimed blocks:\n${holders.map((s) => `    ${describe(s)}`).join('\n')}` : ''}`);
      }
      const key = stackKey(app, chosen);
      const record = {
        version: 3,
        key,
        app,
        tree,
        offset: chosen,
        pid: claimer,
        procStart: processStart(claimer),
        lock,
        machine: machineId(),
        host: hostname(),
        startedAt: new Date().toISOString(),
        ports: Object.fromEntries(Object.entries(basePorts).map(([name, port]) => [name, port + chosen])),
        tmp: stackTmp(tree, key),
        processes: [],
        ...fields,
      };
      if (dryRun) return { record, passed };
      ensureRunDir(tree);
      // The key's previous record, if any, was dead and pruned above; under the lock nothing can have written one since.
      const fd = openSync(recordFile(tree, key), 'wx');
      writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
      closeSync(fd);
      mkdirSync(stackDir(tree, key), { recursive: true });
      makePrivateTmp(record.tmp, lock);
      return { record, passed };
    });
    if (claimed) return claimed;
    // Outside the lock: nobody else's claim waits on ours.
    const doing = () => unfinished(waitFor.tree, waitFor.key).map((w) => w.doing ?? w.status).join('; ') || 'detached work';
    if (Date.now() - started > waitMs) {
      throw new ClaimError(`${waitFor.key} is still finishing after ${Math.round(waitMs / 1000)}s (${doing()}). Wait for it (tools/dev/dev ps), or end it: ${stopCommandFor(waitFor, { abandon: true })}`);
    }
    say(`${waitFor.key} — this stack's previous run — is still finishing (${doing()}); waiting for it, so nothing is lost…`);
    while (isHeld(waitFor.lock) && recordState(waitFor) === 'finishing' && Date.now() - started <= waitMs) await sleep(500);
  }
}
