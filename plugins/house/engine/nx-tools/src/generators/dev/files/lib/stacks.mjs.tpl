// Running stacks — each one's IDENTITY: the RUN RECORD, claimed once, that is its handle. GENERATOR-OWNED
// (@bespunky/nx-tools:dev); rewritten every sync.
//
// A stack is whatever binds a block of this project's ports: a serve of one app from one worktree on one offset
// (`<app>@<offset>`), and equally an emulator suite run on its own (`firebase@<offset>`) or a seed build's private
// suite (`seed-build@<offset>`). ONE identity for all of them, so they see each other: every one CLAIMS its record
// through claimStack() below, under one lock, before it spawns anything — and the claim is refused (or, for `auto`,
// moved to the next block) when any other record already holds one of its ports. The ports are the resource; the
// record is who holds them, from the moment of the claim (a port probe sees a server only once it has bound —
// seconds later — which is how five concurrent serves used to land on one block and lose each other's handles).
//
//   <tree>/.bespunky/run/<key>.json   the run record — who holds which ports, as which process
//   <tree>/.bespunky/run/<key>/       the stack's state dir (DEV_STACK_DIR, ${STACK_DIR})
//   <state dir>/detached/<id>.json    DETACHED WORK a process registered (see detachedWork below)
//   /tmp/bespunky-<hash>/             the stack's TMPDIR (DEV_STACK_TMP) — SHORT on purpose (see stackTmp)
//
// All three go with the record: removed by the claimer on a clean end, or by whoever next finds the record dead.
// `.bespunky/run/` ignores itself (a `.gitignore` of `*`), so it is never committed.
//
// The record is what lets anyone — the developer, Claude, a subagent's parent — find a stack and stop it BY
// HANDLE (`tools/dev/dev ps`, `tools/dev/dev stop`) instead of guessing at process names. A record is never
// trusted blindly: a PID is the stack's only while the process behind it is the very one that claimed (same
// process table, same kernel start time, same command line). Anything else is stale and is pruned.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';

import { allFree, isPortFree, noFreeBlock, offsetCandidates, portBlock } from './ports.mjs';

export const RUN_DIR = '.bespunky/run';

export const stackKey = (app, offset) => `${app}@${offset}`;
export const stackDir = (tree, key) => join(tree, RUN_DIR, key);
export const recordFile = (tree, key) => join(tree, RUN_DIR, `${key}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const OUR_TMP = /^\/tmp\/bespunky-[0-9a-f]{12}$/;

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
 * THIS PROCESS TABLE — the kernel boot plus the PID namespace. A PID (with its start time) means something only in
 * the table that issued it: a record from before a container was rebuilt names PIDs of a table that no longer
 * exists, and a sibling container sharing the tree names PIDs this one cannot see. The boot id alone is the
 * kernel's (every container on a host shares it, and keeps it across a rebuild); the namespace is the container's.
 * Elsewhere than Linux: the host name.
 */
export function machineId() {
  try {
    return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}/${readlinkSync('/proc/self/ns/pid')}`;
  } catch {
    return `host:${hostname()}`;
  }
}
const bootOf = (machine) => String(machine ?? '').split('/')[0];

/**
 * A record of ANOTHER table on this kernel (a sibling container sharing the tree) cannot be checked by PID; it is
 * live while its claimer keeps it fresh (heartbeat()). A rebuilt container's records stop being touched, and are
 * pruned once stale.
 */
const HEARTBEAT_MS = 15_000;
const STALE_MS = 4 * HEARTBEAT_MS;

/** Keep `tree`'s record `key` fresh for the other tables that read it — what a claimer runs for as long as it lives. */
export function heartbeat(tree, key) {
  const file = recordFile(tree, key);
  const timer = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(file, now, now);
    } catch {
      /* removed meanwhile */
    }
  }, HEARTBEAT_MS);
  timer.unref();
  return timer;
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

/** The record, its state dir and its TMPDIR — gone. */
function dropStack(tree, key, record) {
  rmSync(recordFile(tree, key), { force: true });
  rmSync(stackDir(tree, key), { recursive: true, force: true });
  if (record?.tmp && OUR_TMP.test(record.tmp)) rmSync(record.tmp, { recursive: true, force: true });
}

/**
 * Remove a stack's record, state dir and TMPDIR — only if still claimed by `pid` (a newer stack may hold the key
 * by now), and never while its detached work runs or what that work left behind still does: the record is then their
 * only handle (`ps` shows it FINISHING or ORPHANED), and the state dir holds their files. Returns whether it removed them.
 */
export function removeRecord(tree, key, pid = process.pid) {
  let record;
  try {
    record = JSON.parse(readFileSync(recordFile(tree, key), 'utf8'));
  } catch {
    return false; // already gone, or unreadable — nothing of ours to remove
  }
  if (record.pid !== pid || record.machine !== machineId()) return false;
  // Detached work still running, or what it left running when it was killed outright: the record is their handle.
  if (unfinished(tree, key).length || survivors(record).length) return false;
  dropStack(tree, key, record);
  return true;
}

/**
 * DETACHED WORK — what a stack's process deliberately runs OUTSIDE the process tree, because it must outlive
 * whatever stops it. The case it exists for: an emulator suite's export. Every supervisor (Nx's tree kill, a
 * terminal's Ctrl+C) signals the leaves of a tree first and force-kills the rest within seconds; an export
 * takes half a minute and dies with the first signal that reaches its JVMs. So tools/emulators.sh runs the suite
 * under a detached keeper and registers it here: `<state dir>/detached/<id>.json` =
 *   { id, what, pid, procStart, status: running | stopping | exited, doing, log, code, result, deadline }
 * `pid` leads its own process group: everything the work started is in that group. The engine never signals it
 * to stop — its owner does — and WAITS for it: a stack is not stopped until its detached work has finished, and its
 * state dir is not removed before then. The work owns a deadline too (`deadline`, epoch seconds, once stopping):
 * past it, it ends its own group and says so — nothing waits on it forever. The one signal anyone else sends it is
 * SIGUSR1, ABANDON NOW (`dev stop --abandon`), for when even the deadline is too long to wait.
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
 * a moment from gone: it is how the work's owner, as its last act, lets the stack's state dir go.
 */
export const unfinished = (tree, key) => detachedWork(stackDir(tree, key)).filter((w) => w.alive && w.status !== 'exited');

/**
 * What a stack STARTED that still runs, though whatever started it is gone: its recorded processes that are still the
 * very processes it spawned, and the members of a detached work's process group whose leader died (a keeper killed
 * outright leaves its suite running in its group). The record is their only handle — `dev stop` stops exactly these.
 */
export function survivors(record) {
  const out = (record.processes ?? []).filter((p) => isSameProcess(p.pid, p.procStart)).map((p) => ({ id: p.id, pid: p.pid }));
  for (const w of detachedWork(stackDir(record.tree, record.key))) {
    if (w.alive) continue;
    for (const pid of groupMembers(w.pid)) out.push({ id: `${w.id} (left by its keeper)`, pid });
  }
  return out;
}

/** Is the record's claimer still the very process that claimed it? */
const claimerAlive = (record) =>
  isSameProcess(record.pid, record.procStart) && (!record.command || commandLine(record.pid) === record.command);

/**
 * The state of a record:
 *   live      the claimer (a serve, a direct emulator run, a seed build) is running
 *   orphaned  the claimer is gone (killed too hard to clean up — SIGKILL, OOM) but processes it started still run;
 *             the record is their only handle, so it is KEPT — `dev stop` stops exactly those
 *   finishing the claimer and its processes are gone, but DETACHED work of theirs still runs (an emulator suite
 *             saving its data) — nothing to stop, only to wait for (or `--abandon`); kept until it is done
 *   foreign   claimed in another process table on this machine (a sibling container sharing the tree) and still
 *             kept fresh by it — cannot be checked from here, but its ports are held all the same
 *   dead      nothing of it runs — or it was claimed before this kernel booted, or its other table went quiet
 */
export function recordState(record, mtimeMs = Date.now()) {
  const here = machineId();
  if (record.machine !== here) {
    if (!record.machine || bootOf(record.machine) !== bootOf(here)) return 'dead';
    return Date.now() - mtimeMs < STALE_MS ? 'foreign' : 'dead';
  }
  if (claimerAlive(record)) return 'live';
  if (survivors(record).length) return 'orphaned';
  return unfinished(record.tree, record.key).length ? 'finishing' : 'dead';
}

/** Every record in `trees`, with its state. Dead ones are PRUNED (record, state dir, TMPDIR) unless `prune` is false. */
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
      let record, mtimeMs;
      try {
        record = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        mtimeMs = statSync(join(dir, f)).mtimeMs;
      } catch {
        continue; // mid-write, or not ours
      }
      if (!record || typeof record.pid !== 'number' || typeof record.key !== 'string' || `${record.key}.json` !== f) continue;
      const state = recordState(record, mtimeMs);
      if (state === 'dead' && prune) {
        dropStack(tree, record.key, record);
        continue;
      }
      out.push({ ...record, state });
    }
  }
  return out;
}

// ── THE CLAIM ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ONE claim at a time, across every worktree of this repository — the lock lives in the MAIN tree's run dir,
 * which every worktree can reach. A directory, because mkdir is atomic everywhere and needs no native module; held
 * for the few milliseconds a claim takes (read the records, probe the ports, write one file). A holder that died
 * holding it is recognised by the owner it wrote and its lock is taken over — atomically, by rename, so two
 * claimers can never both take it over.
 */
async function withClaimLock(lockRoot, fn) {
  ensureRunDir(lockRoot);
  const lock = join(lockRoot, RUN_DIR, 'claim.lock');
  const me = { pid: process.pid, procStart: processStart(process.pid), machine: machineId() };
  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner.json'), JSON.stringify(me));
      break;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
    let owner = null;
    let age = 0;
    try {
      age = Date.now() - statSync(lock).mtimeMs;
      owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
    } catch {
      /* being created or removed right now */
    }
    const stale = owner
      ? owner.machine === me.machine
        ? !isSameProcess(owner.pid, owner.procStart)
        : age > STALE_MS
      : age > 5000;
    if (stale) {
      try {
        const aside = `${lock}.stale-${process.pid}`;
        renameSync(lock, aside);
        rmSync(aside, { recursive: true, force: true });
      } catch {
        /* another claimer took it over first */
      }
      continue;
    }
    await sleep(wait);
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** A claim the caller can act on (a held block) — reported plainly, never as a stack. */
export class ClaimError extends Error {}

/** How a holder is named to whoever ran into it. */
export const describe = (s) => `${s.key} (${s.state}, pid ${s.pid}, owner ${s.owner}${s.label ? `, ${s.label}` : ''})`;

/** The exact command that stops a record's stack. */
export const stopCommandFor = (s, { abandon = false } = {}) => `tools/dev/dev stop ${s.app} --offset=${s.offset} --worktree=${s.tree}${abandon ? ' --abandon' : ''}`;

/**
 * CLAIM A STACK: pick its offset and write its record, atomically against every other claim in this repository.
 *
 *   lockRoot   the main tree (where the lock lives)          trees     every worktree (whose records are read)
 *   tree, app  the stack's tree and name (key `<app>@<offset>`)
 *   spec       `--port-offset` ('auto' or an offset)          treeKey, isMain   the tree's identity (lib/ports.mjs)
 *   basePorts  { name: base port } — every port the stack will bind; the record holds them shifted
 *   fields     the rest of the record (owner, url, label, …)  say       progress lines
 *   claimer    the PID the record names (default: this process) — a script claiming for itself passes its own
 *   dryRun     decide, but write nothing (what `serve --dry-run` prints)
 *   probe      is a port free of anything bound (injected for tests)
 *
 * A block held by any live, orphaned or foreign record is never taken: `auto` moves on to the next candidate, an
 * explicit offset is refused naming the holder and how to stop it. The PREFERRED block held only by THIS stack's own
 * previous run while it finishes (an emulator suite saving after a Ctrl+C) is waited for, then taken — so the next
 * `nx serve` lands back on the same ports instead of beside a save. `auto` also needs every port actually free
 * (something no stack claims may be bound there); an explicit offset is taken as asked.
 *
 * Returns `{ record, passed }`: `passed` the stacks holding the preferred block when `auto` had to move off it.
 */
export async function claimStack({ lockRoot, trees, tree, app, spec, treeKey, isMain, basePorts, claimer = process.pid, dryRun = false, fields = {}, say = () => {}, probe = isPortFree, waitMs = 180_000 }) {
  const base = Object.values(basePorts);
  const { pinned, offsets } = offsetCandidates(spec, { key: treeKey, isMain, block: portBlock(base) });
  const started = Date.now();
  for (;;) {
    let waitFor = null;
    const claimed = await withClaimLock(lockRoot, async () => {
      const stacks = readStacks(trees).filter((s) => s.state !== 'dead');
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
        const err = noFreeBlock(portBlock(base), isMain);
        const holders = stacks.filter((s) => Object.values(s.ports ?? {}).length);
        throw new ClaimError(`${err.message}${holders.length ? `\n  Claimed blocks:\n${holders.map((s) => `    ${describe(s)}`).join('\n')}` : ''}`);
      }
      const key = stackKey(app, chosen);
      const record = {
        version: 2,
        key,
        app,
        tree,
        offset: chosen,
        pid: claimer,
        procStart: processStart(claimer),
        command: commandLine(claimer),
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
      let fd;
      try {
        fd = openSync(recordFile(tree, key), 'wx');
      } catch (err) {
        if (err?.code === 'EEXIST') return null; // a record unreadable a moment ago (mid-write) — look again
        throw err;
      }
      writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
      closeSync(fd);
      mkdirSync(stackDir(tree, key), { recursive: true });
      rmSync(record.tmp, { recursive: true, force: true });
      mkdirSync(record.tmp, { recursive: true, mode: 0o700 });
      return { record, passed };
    });
    if (claimed) return claimed;
    if (!waitFor) continue;
    // Outside the lock: nobody else's claim waits on ours.
    const doing = () => unfinished(waitFor.tree, waitFor.key).map((w) => w.doing ?? w.status).join('; ') || 'detached work';
    if (Date.now() - started > waitMs) {
      throw new ClaimError(`${waitFor.key} is still finishing after ${Math.round(waitMs / 1000)}s (${doing()}). Wait for it (tools/dev/dev ps), or end it: ${stopCommandFor(waitFor, { abandon: true })}`);
    }
    say(`${waitFor.key} — this stack's previous run — is still finishing (${doing()}); waiting for it, so nothing is lost…`);
    while (unfinished(waitFor.tree, waitFor.key).length && Date.now() - started <= waitMs) await sleep(500);
  }
}
