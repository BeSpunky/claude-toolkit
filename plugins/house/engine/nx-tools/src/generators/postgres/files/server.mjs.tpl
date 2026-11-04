// The server of one stack: create it, run it, stop it. GENERATOR-OWNED.
//
// THE LAUNCHER STAYS THE PARENT, it never replaces itself with `postgres`. It has work to do after the server is up, and a
// stop needs translating: SIGTERM is Postgres's SMART shutdown, which waits for every client, so one open psql would hang a
// `dev stop` for its whole timeout.
//
// A STOP IS SIGTERM, THEN SIGINT AFTER A BOUND. The engine signals a dependency and its dependents together, so a backend
// still shutting down must be able to finish writing: smart mode lets it, and takes no new connections. The bound (below Nx's
// five-second grace, past which it kills) then turns it into a fast shutdown, which ends whatever clients remain. The server
// is in its own session, so a Ctrl+C or a closed terminal reaches it through this policy, never around it.
//
// A HEARTBEAT, BECAUSE ANOTHER CONTAINER CAN HOLD THIS DATA. The `~/.local` volume is named after the folder, so two checkouts
// with one name share it, and hash to one tree. Nothing else can see that: `postmaster.pid` names a pid in another container's
// process table, which reads here as a dead server, and removing it to recover would put two postmasters on one data directory.
// So the launcher keeps `owner` beside the data: its hostname, touched every interval. Fresh from another host is a refusal. Stale
// means that container is gone, which is what a rebuild looks like, and is taken over.
//
// THE SERVER HOLDS THE STACK'S LOCK (fd 3). So a launcher killed outright leaves a server that `dev ps` still shows as an
// orphan, and that `dev stop` can clear. Without it, that server would hold the port and be invisible to both.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, fstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { NX, PORT_NAME, READY_MARKER, ROLE, ROOT, Refusal, clusterHome, dataDir, dataHome, declaredMajor, identityFile, ownerFile, stackHome, treeHome } from './layout.mjs';
import { assertIdentity } from './stack.mjs';
import { ensureDatabase, localMigrate, localUrl, seedOnce } from './schema.mjs';
import { run, scrubbedEnv, tool } from './tools.mjs';

const SMART_STOP_MS = 2000;
const ACCEPTING_TIMEOUT_MS = 60_000;
const HEARTBEAT_MS = 10_000;
const HEARTBEAT_FRESH_MS = 3 * HEARTBEAT_MS;

const log = (line) => console.log(`[postgres] ${line}`);

/** A live server's data directory is its cwd, a real path. Any other meaning of a pid (reused, or another stack's) is not this one. */
function serverOf(data) {
  let pid;
  try {
    pid = Number(readFileSync(join(data, 'postmaster.pid'), 'utf8').split('\n')[0]);
  } catch {
    return undefined;
  }
  try {
    return readlinkSync(`/proc/${pid}/cwd`) === realpathSync(data) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Another host's fresh heartbeat on this cluster home, as `{ host, ageSeconds }`, or undefined: no file, stale, or ours. */
function heldElsewhere(home) {
  try {
    const age = Date.now() - statSync(ownerFile(home)).mtimeMs;
    const host = readFileSync(ownerFile(home), 'utf8').trim();
    return age < HEARTBEAT_FRESH_MS && host !== hostname() ? { host, ageSeconds: Math.max(0, Math.round(age / 1000)) } : undefined;
  } catch {
    return undefined;
  }
}

/** Refuse before anything of this cluster is touched, `postmaster.pid` above all. */
function assertNotHeldElsewhere(home) {
  const held = heldElsewhere(home);
  if (!held) return;
  throw new Refusal(
    `Container ${held.host} is running this data directory's server (heartbeat ${held.ageSeconds}s ago): ${home}. Two servers on one data directory corrupt it.\n` +
      `The two containers share a ~/.local volume, which is named after the project's folder, so same-named checkouts share one. Stop the stack there, or give one checkout a folder of its own name. If that container is already gone, this clears within ${HEARTBEAT_FRESH_MS / 1000}s.`,
  );
}

/** Take the owner file and keep it fresh. `onLost` runs if another host takes it, as one will after this container was paused for too long. Returns how to let go. */
function holdOwnership(home, onLost) {
  const file = ownerFile(home);
  writeFileSync(file, `${hostname()}\n`);
  const mine = () => {
    try {
      return readFileSync(file, 'utf8').trim() === hostname();
    } catch {
      return false;
    }
  };
  const beat = setInterval(() => {
    try {
      if (!existsSync(file)) writeFileSync(file, `${hostname()}\n`);
      else if (mine()) utimesSync(file, new Date(), new Date());
      else onLost(readFileSync(file, 'utf8').trim());
    } catch (error) {
      log(`could not touch ${file}: ${error.message}. Another container could take this data over.`);
    }
  }, HEARTBEAT_MS);
  beat.unref();
  return () => {
    clearInterval(beat);
    if (mine()) rmSync(file, { force: true });
  };
}

/**
 * Was this tree removed? Absence alone does not say: `~/.local` is a volume, and a tree another container mounts is invisible
 * from this one. So a deletion must be proven: the parent directory answers, and in it the tree does not. Everything short of
 * that (no such parent, a parent that cannot be read, a record that is no absolute path) is `unknown`.
 */
function treeState(tree) {
  const look = (path) => {
    try {
      return statSync(path).isDirectory() ? 'directory' : 'file';
    } catch (error) {
      return error.code === 'ENOENT' ? 'absent' : 'unknown';
    }
  };
  if (!isAbsolute(tree)) return 'unknown';
  const here = look(tree);
  if (here !== 'absent') return here === 'unknown' ? 'unknown' : 'here';
  return look(dirname(tree)) === 'directory' ? 'gone' : 'unknown';
}

/**
 * Drop the data of every tree proven gone (data lives outside the tree, so removing a worktree cannot take it), and say what
 * went. A tree that cannot be proven gone keeps its data and is named, every start, so a real leftover is not silent. A tree
 * still has its data while a server runs on it: that is left, and named.
 */
export function sweepDeadTrees() {
  const home = dataHome();
  if (!existsSync(home)) return;
  for (const entry of readdirSync(home, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(home, entry.name);
    // Housekeeping for another tree never stops this one's start, and another start may be sweeping the same entry.
    try {
      sweepTree(dir);
    } catch (error) {
      log(`kept what is left of ${dir}: ${error.message}`);
    }
  }
}

function sweepTree(dir) {
  let tree;
  try {
    tree = readFileSync(join(dir, 'tree'), 'utf8').trim();
  } catch {
    return; // being created, or not ours
  }
  const state = treeState(tree);
  if (state === 'here') return;
  if (state === 'unknown') {
    log(`kept the Postgres data of ${tree || 'an unnamed tree'}: it is not visible from here, and nothing proves it was removed. If it was, remove ${dir}.`);
    return;
  }
  const clusters = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((stack) =>
    readdirSync(join(dir, stack.name)).map((major) => ({ stack: stack.name, major, data: dataDir(join(dir, stack.name, major)) })),
  );
  const held = clusters.map(({ stack, major }) => heldElsewhere(join(dir, stack, major))).find(Boolean);
  if (held) {
    log(`kept the Postgres data of ${tree}: container ${held.host} is running a server on it (heartbeat ${held.ageSeconds}s ago).`);
    return;
  }
  const running = clusters.filter(({ data }) => serverOf(data));
  if (running.length) {
    log(`${tree} is gone, but a server still runs on its data (${running.map((c) => c.stack).join(', ')}): left alone. tools/dev/dev cannot reach it from here; stop it by its pid in ${running[0].data}/postmaster.pid.`);
    return;
  }
  // The record goes last: a removal that fails partway must still be recognised as this layer's on the next start.
  for (const name of readdirSync(dir)) {
    if (name !== 'tree') rmSync(join(dir, name), { recursive: true, force: true });
  }
  rmSync(dir, { recursive: true, force: true });
  log(`dropped the Postgres data of ${tree}, which no longer exists (${clusters.map((c) => `${c.stack} on ${c.major}`).join(', ') || 'no clusters'}).`);
}

/**
 * The server on PATH is the major this project declares. The declaration decides what an upgrade writes into the image, so the
 * two part whenever one step of a move has happened and the other has not; without this, a cluster of the other major would be
 * filed under the declared one, and a migration would be tested on a server the project does not run.
 */
async function assertDeclaredMajor(major, { signal }) {
  const version = await run('postgres', ['--version'], { signal });
  if (version.aborted) return;
  const found = /\b(\d+)(?:\.\d+)?/.exec(version.stdout)?.[1];
  if (found !== major) {
    throw new Refusal(`.bespunky/postgres.json declares Postgres ${major}, and the server on PATH is ${found ?? `unreadable (${version.stdout.trim()})`}. The image installs what the declaration said at the last upgrade: run the house upgrade, then rebuild the devcontainer.`);
  }
}

/** A cluster that either exists whole or not at all: initdb into a sibling, record its identity, then rename. */
async function ensureCluster(key, major, { signal }) {
  const home = clusterHome(key, major);
  mkdirSync(treeHome(), { recursive: true });
  writeFileSync(join(treeHome(), 'tree'), `${ROOT}\n`);
  mkdirSync(stackHome(key), { recursive: true });
  for (const leftover of readdirSync(stackHome(key))) {
    if (leftover.startsWith('.init-')) rmSync(join(stackHome(key), leftover), { recursive: true, force: true });
  }
  if (existsSync(home)) {
    if (!existsSync(identityFile(home))) throw new Refusal(`${home} has no recorded identity, so it cannot be trusted. Remove that directory to start from nothing.`);
    return home;
  }
  const others = readdirSync(treeHome(), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== key).map((d) => d.name);
  const otherMajors = readdirSync(stackHome(key)).filter((name) => !name.startsWith('.'));
  log(`creating a new database for ${key} (Postgres ${major})${others.length ? `. This tree has separate data on ${others.join(', ')}` : ''}${otherMajors.length ? `. Data of Postgres ${otherMajors.join(', ')} stays beside it, unused` : ''}.`);
  const sibling = join(stackHome(key), `.init-${randomBytes(4).toString('hex')}`);
  mkdirSync(sibling);
  const init = await run('initdb', ['-D', dataDir(sibling), '-U', ROLE, '-A', 'trust', '-E', 'UTF8', '--locale=C.UTF-8', '--no-instructions'], { signal });
  if (init.aborted) return undefined;
  if (init.code !== 0) throw new Refusal(`initdb failed: ${init.stderr.trim() || init.stdout.trim()}`);
  const control = await run('pg_controldata', [dataDir(sibling)], { env: scrubbedEnv({ LC_ALL: 'C' }), signal });
  if (control.aborted) return undefined;
  const identifier = /^Database system identifier:\s+(\d+)$/m.exec(control.stdout)?.[1];
  if (!identifier) throw new Refusal(`Could not read the new cluster's identity from pg_controldata: ${control.stderr.trim() || control.stdout.trim()}`);
  writeFileSync(identityFile(sibling), `${identifier}\n`);
  renameSync(sibling, home);
  return home;
}

function serverArgs(data, port, socketDir, key) {
  const settings = {
    listen_addresses: '127.0.0.1',
    port,
    unix_socket_directories: socketDir, // short and private; a path inside a worktree would pass the socket length limit
    dynamic_shared_memory_type: 'mmap', // /dev/shm leaks on a kill, and a parallel hash join fills Docker's 64 MB of it
    wal_level: 'logical', // so a logical slot works first try
    max_slot_wal_keep_size: '1GB', // and an abandoned one cannot fill the disk
    cluster_name: key,
  };
  return ['-D', data, ...Object.entries(settings).flatMap(([name, value]) => ['-c', `${name}=${value}`])];
}

/** The launcher's own verb under the engine: everything it needs comes from the stack it runs in. */
export async function serve() {
  const { DEV_STACK_DIR: stackDir, DEV_STACK_TMP: socketDir, [`PORT_${PORT_NAME.toUpperCase()}`]: port } = process.env;
  if (!stackDir || !socketDir || !port) throw new Refusal(`This verb runs inside a dev stack. Start one: ${NX} run postgres:start`);
  try {
    fstatSync(3);
  } catch {
    throw new Refusal('This verb runs inside a dev stack, which hands it the stack lock on fd 3, and fd 3 is closed.');
  }
  const key = basename(stackDir);
  const major = declaredMajor();
  const stopping = new AbortController();
  const { signal } = stopping;
  let server;
  let smartBound;
  const stop = () => {
    if (signal.aborted) return;
    stopping.abort();
    if (!server) return;
    server.kill('SIGTERM');
    smartBound = setTimeout(() => server.kill('SIGINT'), SMART_STOP_MS);
  };
  // Another postmaster now owns these files. Every other stop flushes and checkpoints, which here would write over its cluster,
  // so this one is SIGQUIT alone: an immediate shutdown writes nothing. What is lost was already not this server's to keep.
  const stopWritingNothing = () => {
    stopping.abort();
    clearTimeout(smartBound);
    server?.kill('SIGQUIT');
  };
  for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(name, stop);
  const stopped = () => signal.aborted;

  await assertDeclaredMajor(major, { signal });
  if (stopped()) return 0;
  sweepDeadTrees();
  assertNotHeldElsewhere(clusterHome(key, major));
  const home = await ensureCluster(key, major, { signal });
  if (stopped() || !home) return 0;
  const data = dataDir(home);
  chmodSync(data, 0o700);
  const holder = serverOf(data);
  if (holder) throw new Refusal(`A server of this data directory is already running (pid ${holder}). See tools/dev/dev ps, which names the command that stops it.`);
  let lostTo;
  const letGo = holdOwnership(home, (host) => {
    if (lostTo) return;
    lostTo = host;
    console.error(`[postgres] container ${host} took this data over while this server ran, so it is stopping: two servers on one data directory corrupt it.`);
    stopWritingNothing();
  });
  rmSync(join(data, 'postmaster.pid'), { force: true });

  server = spawn(tool('postgres'), serverArgs(data, port, socketDir, key), { env: scrubbedEnv(), detached: true, stdio: ['ignore', 'inherit', 'inherit', 3] });
  const exited = new Promise((resolve) => {
    server.on('error', (error) => resolve({ error }));
    server.on('exit', (code, sig) => resolve({ code, signal: sig }));
  });

  const stack = { key, port: Number(port) };
  const bringUp = async () => {
    await untilAccepting(port, exited, signal);
    if (stopped()) return false;
    await assertIdentity(stack, { signal });
    await ensureDatabase(port, { signal });
    await localMigrate(port, { signal });
    if (stopped()) return false;
    const seeded = await seedOnce(port, { signal });
    if (seeded) log(`seeded from ${seeded} file(s) in postgres/seed/world.`);
    return !stopped();
  };

  let failure;
  try {
    if (await bringUp()) {
      writeFileSync(join(stackDir, READY_MARKER), `${new Date().toISOString()}\n`);
      log(`ready on 127.0.0.1:${port}: ${localUrl(port)}`);
      log(`stop it with: tools/dev/dev stop ${key.split('@')[0]} --offset=${key.split('@')[1]}`);
    }
  } catch (error) {
    if (!stopped()) failure = error;
  }
  if (failure) {
    stop();
    await exited;
    clearTimeout(smartBound);
    letGo();
    // The verbs need a running server, and this one just stopped, so this is the road that remains.
    if (failure instanceof Refusal) failure.message += `\nThe server stopped with it. To start this stack's database from nothing, remove ${home} and start again; otherwise fix the cause and start again.`;
    throw failure;
  }
  const end = await exited;
  clearTimeout(smartBound);
  letGo();
  if (lostTo) return 1;
  if (stopped()) return end.code === 0 ? 0 : 1;
  // An exit nobody asked for is a failure, even with status 0: Postgres shuts itself down when its data directory vanishes.
  console.error(`[postgres] the server exited on its own (${end.error?.message ?? end.signal ?? `status ${end.code}`}). If its log above speaks of a lock file or a pre-existing shared memory block, an orphan holds the data: tools/dev/dev ps names the command that clears it.`);
  return 1;
}

async function untilAccepting(port, exited, signal) {
  let gone;
  exited.then((end) => (gone = end));
  let deadline = Date.now() + ACCEPTING_TIMEOUT_MS;
  while (!signal.aborted) {
    if (gone) {
      throw new Refusal(`The server exited before accepting connections (${gone.error?.message ?? gone.signal ?? `status ${gone.code}`}). If its log above speaks of a lock file or a pre-existing shared memory block, an orphan holds the data: tools/dev/dev ps names the command that clears it.`);
    }
    if (Date.now() > deadline) throw new Refusal(`The server did not accept connections within ${ACCEPTING_TIMEOUT_MS / 1000}s.`);
    const probe = await run('pg_isready', ['-h', '127.0.0.1', '-p', String(port), '-U', ROLE, '-d', 'postgres', '-t', '1'], { signal });
    if (probe.code === 0) return;
    // 1 is "rejecting": a server that answers and is still recovering. A long recovery is progress, and giving up on it restarts it.
    if (probe.code === 1) deadline = Date.now() + ACCEPTING_TIMEOUT_MS;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

