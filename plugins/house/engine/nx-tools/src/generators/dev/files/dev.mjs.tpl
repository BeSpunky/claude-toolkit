// tools/dev/dev — the house dev loop, stack-free. GENERATOR-OWNED (@bespunky/nx-tools:dev); rewritten every
// sync — the project's own knowledge lives in .bespunky/dev.json, never here.
//
//   tools/dev/dev serve [app] [--worktree[=<branch|slug|path>]] [--port-offset=<n|auto>] [--skip=<id,…>]
//                             [--owner=<label>] [--no-shared-browser] [--no-install] [--dry-run] [-- <args for the primary>]
//   tools/dev/dev ps    [app] [--json]
//   tools/dev/dev stop  [app] [--worktree=<x>] [--offset=<n>] [--all-mine] [--owner=<label>] [--any-owner] [--abandon]
//   tools/dev/dev list
//   tools/dev/dev claim <app> --pid=<pid> --ports=<name=port,…> [--port-offset=<n|auto>] [--shifted]   (scripts)
//   tools/dev/dev release <key> --pid=<pid>                                                            (scripts)
//
// A serve: pick a tree → install it if its declaration says how and it needs it → CLAIM the stack: one port
// offset for every port it will bind (sized from the declaration) and its RUN RECORD (its handle), atomically
// against every other stack of this repository → run every declared process under one graceful Ctrl+C →
// register `<slug>.localhost` and drive the shared co-driven browser to the app.
//
// `ps` lists the running stacks of every worktree (and prunes records whose process is gone); `stop` stops
// stacks BY HANDLE — the record's PID, verified to still be that very process — and then checks that the
// stack's ports are actually free. Nobody needs to kill a dev server by name: see lib/stacks.mjs.
//
// `claim` / `release` are the same claim for a SCRIPT that runs a stack of its own — tools/emulators.sh run
// directly, a seed build's private suite: one identity for everything that binds this project's ports, so a
// direct emulator run and a serve see each other instead of colliding on a port.
//
// Node built-ins only, and no project node_modules: this must serve a Python or Go repo exactly as it serves
// an Nx one. `nx serve <app>` (the @bespunky/nx-tools:serve executor) is a thin wrapper over this file.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { attachBrowser, detachRoute, foreignOwner, sharedBrowserUrl } from './lib/browser.mjs';
import { DECLARATION_PATH, DeclarationError, declaredPorts, loadDeclaration, pickApp, planApp, primaryOf } from './lib/declaration.mjs';
import { PortError, isPortFree, portBlock } from './lib/ports.mjs';
import { descendants, runStack } from './lib/stack.mjs';
import {
  ClaimError,
  claimStack,
  describe,
  detachedWork,
  groupMembers,
  heartbeat,
  isAlive,
  isSameProcess,
  ownerIsShared,
  ownerOf,
  processStart,
  readStacks,
  removeRecord,
  stackDir as stackDirOf,
  stopCommandFor,
  survivors,
  unfinished,
  writeRecord,
} from './lib/stacks.mjs';
import { collectWorktrees, matchWorktree, servedSlug, worktreeKey, worktreeLabel } from './lib/worktrees.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One directory, however it is spelled: compared by REAL path, since a symlinked spelling is the same tree. */
function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

const log = (m) => console.log(`[serve] ${m}`);
const warn = (m) => console.error(`[serve] WARNING: ${m}`);

class UsageError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The exit status of a stack stopped by the terminal's Ctrl+C — the shell's own convention (128 + SIGINT). */
const INTERRUPTED = 130;

/**
 * How long a stop waits for a stack's DETACHED work (an emulator suite saving its data) before it says so and
 * stops waiting. The work owns its own deadline (it ends itself past it — see lib/stacks.mjs detachedWork); this
 * only bounds how long a stop sits in front of it.
 */
const DETACHED_TIMEOUT_MS = (Number(process.env.DEV_STOP_TIMEOUT) || 180) * 1000;

/** What a piece of detached work is doing right now, in words. */
const doing = (w) => `${w.id}: ${w.doing ?? w.status}`;

/**
 * ABANDON a stack's detached work — `dev stop --abandon`: SIGUSR1 to each one still running (its owner then ends its
 * own process group and records that it did), and, should it not end within a few seconds, SIGKILL to that group —
 * verified to still be led by the very process registered. Returns what it signalled.
 */
async function abandonDetached(tree, key, say) {
  const work = unfinished(tree, key);
  for (const w of work) {
    say(`abandoning ${doing(w)} (pid ${w.pid}) — what it has not saved yet is lost`);
    try {
      process.kill(w.pid, 'SIGUSR1');
    } catch {
      /* gone meanwhile */
    }
  }
  const until = Date.now() + 10_000;
  while (work.some((w) => isSameProcess(w.pid, w.procStart) && w.status !== 'exited') && Date.now() < until) await sleep(200);
  for (const w of work) {
    if (!isSameProcess(w.pid, w.procStart)) continue;
    say(`${w.id} did not end on SIGUSR1 — killing its process group (${w.pid})`);
    for (const pid of groupMembers(w.pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
  }
  return work;
}

/**
 * Wait for a stack's detached work to finish, saying what it is doing every few seconds. Resolves
 * `{ ok, finished, pending }`: `finished` the entries that ended (with their `result`), `pending` what still runs
 * when the wait ran out. `ok` is false when work is still pending or any of it ended in failure (`code` non-zero).
 */
async function awaitDetached(tree, key, { say, timeoutMs = DETACHED_TIMEOUT_MS, every = 5000 } = {}) {
  const start = Date.now();
  let next = start + every;
  for (;;) {
    const running = unfinished(tree, key);
    if (!running.length) break;
    if (Date.now() - start >= timeoutMs) {
      for (const w of running) {
        say(`${doing(w)} — still running after ${Math.round(timeoutMs / 1000)}s; not waiting any longer. It ends on its own by its deadline (pid ${w.pid}${w.log ? `, log ${w.log}` : ''}); tools/dev/dev ps shows it, and tools/dev/dev stop --abandon ends it now.`);
      }
      return { ok: false, finished: [], pending: running };
    }
    if (Date.now() >= next) {
      next += every;
      for (const w of running) say(`…${doing(w)} (${Math.round((Date.now() - start) / 1000)}s)`);
    }
    await sleep(250);
  }
  // Every entry of this stack has ended — including work that finished before we started waiting (an export that
  // beat its supervisor's grace). Each owner writes its result as its last act; that is what is reported.
  const finished = detachedWork(stackDirOf(tree, key)).filter((w) => w.status === 'exited' || !w.alive);
  return { ok: finished.every((w) => !w.code), finished, pending: [] };
}

const USAGE = `Usage:
  tools/dev/dev serve [app] [--worktree[=<branch|slug|path>]] [--port-offset=<n|auto>] [--skip=<id,...>]
                      [--owner=<label>] [--no-shared-browser] [--no-install] [--dry-run] [-- <args for the primary process>]
  tools/dev/dev ps    [app] [--json]
  tools/dev/dev stop  [app] [--worktree=<branch|slug|path>] [--offset=<n>] [--all-mine] [--owner=<label>] [--any-owner] [--abandon]
  tools/dev/dev list

serve  serves an app declared in ${DECLARATION_PATH}. --worktree with no value picks one interactively.
ps     lists the running stacks of every worktree (app@offset, owner, pid, ports and whether each is listening).
stop   stops a stack by its handle and confirms its ports are free. --offset names one (the serve printed its stop
       command); without it, your one stack in this tree. --all-mine: every stack of your owner label, in any tree.
       A Claude Code session is ONE owner for itself and all its subagents, so under it a stack must be NAMED
       (--offset), or the owner made yours alone (DEV_OWNER=<label> / --owner=<label>). Another owner's stack is
       refused unless --any-owner — never stop a server you did not start. --abandon: do not wait for detached
       work (an emulator suite saving its data) — end it now; what it has not saved is lost.`;

/** The flags each command takes — any other flag is refused, never ignored. */
const COMMAND_FLAGS = {
  serve: ['worktree', 'portOffset', 'skip', 'owner', 'sharedBrowser', 'install', 'dryRun'],
  ps: ['json'],
  stop: ['worktree', 'offset', 'allMine', 'owner', 'anyOwner', 'abandon'],
  list: [],
  claim: ['pid', 'ports', 'portOffset', 'shifted', 'owner'],
  release: ['pid'],
};

/** Is an argv item a flag's value (present, and not itself a flag or the passthrough separator)? */
const isValue = (next) => next !== undefined && !next.startsWith('-');

/** Parse argv into `{ command, app, flags, passthrough }`. Unknown flags are refused, never ignored. */
export function parseArgs(argv) {
  const out = { command: argv[0], app: undefined, passthrough: [], worktree: undefined, portOffset: 'auto', skip: [], sharedBrowser: true, install: true, dryRun: false };
  const given = new Set();
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--') {
      out.passthrough = rest.slice(i + 1);
      break;
    }
    const [flag, ...v] = arg.split('=');
    const value = v.length ? v.join('=') : undefined;
    // A value flag takes `--flag=<v>` or `--flag <v>`, the same for every one of them. A MISSING value is refused,
    // never defaulted: a bare `--port-offset` used to read as '' and silently mean "the base stack".
    const takeValue = () => {
      const got = value !== undefined ? value : isValue(rest[i + 1]) ? rest[++i] : undefined;
      if (got === undefined || got === '') throw new UsageError(`${flag} needs a value (${flag}=<value>)`);
      return got;
    };
    const name = flag.replace(/^--(no-)?/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (flag.startsWith('--') && flag !== '--' && flag !== '--help') given.add(name);
    switch (flag) {
      // The one flag whose value is OPTIONAL: bare (or followed by another flag) it means "let me pick". The space
      // form is accepted like every other value flag — `--worktree feat/x` used to leave the value empty and turn
      // `feat/x` into the app name.
      case '--worktree':
        out.worktree = value ?? (isValue(rest[i + 1]) ? rest[++i] : '');
        break;
      case '--port-offset':
        out.portOffset = takeValue();
        break;
      case '--skip':
        out.skip.push(...takeValue().split(',').map((s) => s.trim()).filter(Boolean));
        break;
      case '--offset':
      case '--pid': {
        const raw = takeValue();
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) throw new UsageError(`${flag} must be a non-negative integer (got '${raw}')`);
        out[name] = n;
        break;
      }
      case '--ports':
        out.ports = Object.fromEntries(
          takeValue().split(',').filter(Boolean).map((pair) => {
            const [n, p] = pair.split('=');
            if (!n || !Number.isInteger(Number(p))) throw new UsageError(`--ports takes name=port pairs (got '${pair}')`);
            return [n, Number(p)];
          }),
        );
        break;
      case '--owner':
        out.owner = takeValue();
        break;
      case '--all-mine':
      case '--any-owner':
      case '--abandon':
      case '--shifted':
      case '--json':
        out[name] = true;
        break;
      case '--no-shared-browser':
        out.sharedBrowser = false;
        break;
      case '--no-install':
        out.install = false;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '-h':
      case '--help':
        out.command = 'help';
        break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`unknown flag ${arg}`);
        if (out.app !== undefined) throw new UsageError(`unexpected argument ${arg} (app is already ${out.app})`);
        out.app = arg;
    }
  }
  const allowed = COMMAND_FLAGS[out.command];
  if (allowed) {
    const stray = [...given].filter((f) => !allowed.includes(f));
    if (stray.length) throw new UsageError(`unknown flag for ${out.command}: --${stray[0].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    if (out.command !== 'serve' && out.passthrough.length) throw new UsageError(`${out.command} takes no '-- <args>'`);
  }
  return out;
}


async function promptForWorktree(worktrees) {
  worktrees.forEach((w, i) => console.log(`  ${i + 1}) ${worktreeLabel(w)}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const current = Math.max(0, worktrees.findIndex((w) => w.isCurrent)) + 1;
  const answer = await new Promise((res) => rl.question(`Which worktree do you want to serve? [${current}] `, res));
  rl.close();
  const n = answer.trim() === '' ? current : Number(answer.trim());
  return worktrees[n - 1] ?? null;
}

/** Omitted → the current tree; a value → matched by branch | slug | path; empty in a TTY → a prompt. */
async function selectWorktree(worktrees, spec) {
  if (spec === undefined) {
    const current = worktrees.find((w) => w.isCurrent) ?? worktrees.find((w) => w.isMain) ?? worktrees[0];
    log(`Serving the current tree: ${worktreeLabel(current)}`);
    return current;
  }
  if (spec.trim() === '') {
    if (!process.stdin.isTTY) {
      throw new UsageError(`--worktree given empty but no interactive terminal. Pass --worktree=<branch|slug|path>. Available:\n${worktrees.map((w) => `  - ${worktreeLabel(w)}`).join('\n')}`);
    }
    const picked = await promptForWorktree(worktrees);
    if (!picked) throw new UsageError('no worktree chosen');
    return picked;
  }
  const matches = matchWorktree(worktrees, spec);
  if (matches.length === 1) return matches[0];
  const head = matches.length === 0 ? `No worktree matches "${spec}". Available:` : `"${spec}" is ambiguous — matches ${matches.length} worktrees:`;
  throw new UsageError(`${head}\n${(matches.length ? matches : worktrees).map((w) => `  - ${worktreeLabel(w)}`).join('\n')}`);
}

/** The served tree's own declaration — or, for a tree branched before it had one, this tree's (said so). */
function declarationFor(tree) {
  const own = loadDeclaration(tree.path);
  if (own) return own;
  const here = samePath(tree.path, ROOT) ? null : loadDeclaration(ROOT);
  if (here) {
    warn(`${tree.path} has no ${DECLARATION_PATH} — serving it with this tree's declaration.`);
    return here;
  }
  throw new UsageError(
    `no ${DECLARATION_PATH} in ${tree.path}. Declare what this project serves — e.g.\n` +
      `  { "apps": { "site": { "processes": [ { "id": "app", "cmd": "python3 -m http.server \${PORT:app}", "ports": { "app": 8000 } } ] } } }\n` +
      `(a house sync seeds it for the stacks it knows).`,
  );
}

/** Run the declaration's install step when the tree lacks what it `creates` (fresh worktrees start empty). */
function ensureInstalled(decl, tree, { install, dryRun }) {
  const step = decl.install;
  if (!step) return;
  if (step.creates && existsSync(join(tree, step.creates))) return;
  const shown = typeof step.cmd === 'string' ? step.cmd : step.cmd.join(' ');
  const why = step.creates ? `has no ${step.creates}` : 'declares an install step';
  if (dryRun) {
    log(`(dry run) ${tree} ${why} — would run '${shown}'.`);
    return;
  }
  if (!install) throw new UsageError(`${tree} ${why} and --no-install was given. Run '${shown}' there first.`);
  log(`Installing in ${tree} (${why})…`);
  if (typeof step.cmd === 'string') execFileSync('sh', ['-c', step.cmd], { cwd: tree, stdio: 'inherit' });
  else execFileSync(step.cmd[0], step.cmd.slice(1), { cwd: tree, stdio: 'inherit' });
}

/** Log once when the primary process answers HTTP (any status — even a 404 means the server is up). */
function announceReady(url, appUrl, until) {
  const attempt = () => {
    if (until.done) return;
    const req = get(url, (res) => {
      res.resume();
      if (!until.done) log(`Up: ${appUrl}`);
    });
    req.setTimeout(2000, () => req.destroy());
    req.on('error', () => setTimeout(attempt, 500).unref());
  };
  attempt();
}


/** The main tree (where the claim lock lives) and every tree's path. */
const scopeOf = (worktrees) => ({ lockRoot: (worktrees.find((w) => w.isMain) ?? worktrees[0]).path, trees: worktrees.map((w) => w.path) });

/** Every port the stack will bind, by name — its processes that are not skipped. */
const basePortsOf = (app, skip) => Object.fromEntries(app.processes.filter((p) => !skip.includes(p.id)).flatMap((p) => Object.entries(p.ports ?? {})));

async function serve(opts) {
  const worktrees = collectWorktrees(ROOT);
  const tree = await selectWorktree(worktrees, opts.worktree);

  const decl = declarationFor(tree);
  const appName = pickApp(decl, opts.app);
  const app = decl.apps[appName];
  ensureInstalled(decl, tree.path, opts);

  const block = portBlock(declaredPorts(app));
  const basePorts = basePortsOf(app, opts.skip);
  const owner = ownerOf(process.env, opts.owner);
  const slug = servedSlug(tree, worktrees);

  // THE CLAIM — the stack's offset and its handle, in one step no other claim of this repository can interleave
  // with. Before anything is spawned: a port probe sees a server only once it has bound, which is how concurrent
  // serves used to pick the same block and lose each other's handles. A dry run claims nothing: it says where the
  // stack WOULD land, as of now.
  const claimArgs = { ...scopeOf(worktrees), tree: tree.path, app: appName, spec: opts.portOffset, treeKey: worktreeKey(tree), isMain: tree.isMain, basePorts };
  const { record, passed } = await claimStack({
    ...claimArgs,
    dryRun: opts.dryRun,
    fields: { owner, label: `serve of ${appName} (tools/dev)` },
    say: log,
  });
  const { key, offset } = record;
  const stackDir = stackDirOf(tree.path, key);
  const plan = planApp(decl, appName, { offset, tree: tree.path, skip: opts.skip, passthrough: opts.passthrough, baseEnv: process.env, stackDir, stackTmp: record.tmp });
  for (const id of plan.ignoredSkips) warn(`--skip=${id}: app "${appName}" declares no such process — nothing to skip.`);
  const prettyUrl = `http://${slug}.localhost/${plan.query}`;
  const browserOn = opts.sharedBrowser;

  if (opts.dryRun) {
    log('DRY RUN — would serve:');
    console.log(`  app        : ${appName}`);
    console.log(`  tree       : ${worktreeLabel(tree)}`);
    console.log(`  slug       : ${slug}.localhost`);
    console.log(`  offset     : ${offset}${offset === 0 ? '  (base/forwarded stack)' : ''}`);
    console.log(`  stack      : ${key}  (state dir ${stackDir}, TMPDIR ${record.tmp})`);
    for (const s of passed) console.log(`  passed     : ${describe(s)}`);
    console.log(`  block      : step ${block.step} × ${block.blocks}  (sized from declared ports ${block.min}..${block.max})`);
    console.log(`  app port   : ${plan.primaryPort}`);
    console.log(`  cwd        : ${tree.path}`);
    for (const p of plan.processes) {
      console.log(`  process    : ${p.id}${p.primary ? ' (primary)' : ''} → ${p.skipped ? 'skipped (--skip)' : p.display}`);
      if (!p.skipped) {
        console.log(`               ports ${Object.entries(p.ports).map(([n, v]) => `${n}=${v}`).join(' ') || '(none)'}`);
        console.log(`               env   ${Object.entries(p.added).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      }
    }
    console.log(`  shared browser : ${browserOn ? 'up + register + navigate' : 'skipped (--no-shared-browser)'}`);
    if (browserOn) console.log(`  route      : ${slug} → 127.0.0.1:${plan.primaryPort}`);
    console.log(`  app URL    : ${plan.localUrl}${browserOn ? `  (pretty: ${prettyUrl})` : ''}`);
    for (const a of plan.advice) console.log(`  advice (${a.when}) : ${a.text}`);
    if (browserOn) console.log(`  viewer     : ${await sharedBrowserUrl(tree.path, process.env)}  (shared browser)`);
    return 0;
  }

  // The handle is ours from here; it goes when the stack is down (removeRecord keeps it while detached work runs).
  // A stack killed so hard it never removes it (SIGKILL, a container stop) leaves a record `ps` recognises as dead.
  record.url = plan.localUrl;
  writeRecord(record);
  const dropRecord = () => removeRecord(tree.path, key);
  process.on('exit', dropRecord);
  heartbeat(tree.path, key);

  log(`Serving ${appName} from ${worktreeLabel(tree)}`);
  log(`App:    ${plan.localUrl}`);
  log(`Stack:  ${key} · pid ${process.pid} · owner ${owner} · stop with: ${stopCommand(record, tree)}`);
  if (passed.length) log(`Not on the preferred ports — held by: ${passed.map(describe).join('; ')}`);
  if (offset > 0) log(`Isolated on port offset ${offset} (shifted ports are not forwarded — view it in the shared browser).`);
  for (const a of plan.advice) if (a.when !== 'contended') log(a.text);

  if (offset === 0) {
    foreignOwner(tree.path, process.env, plan.primaryPort).then((foreign) => {
      if (!foreign) return;
      warn(
        `host port ${plan.primaryPort} belongs to another devcontainer (${foreign}) — the server on host :${plan.primaryPort} is THEIRS, not this one.\n` +
          '  Nothing here is broken: view this tree in the shared browser instead.' +
          plan.advice.filter((a) => a.when === 'contended').map((a) => `\n  ${a.text}`).join(''),
      );
    });
  }

  const until = { done: false };
  announceReady(plan.readyUrl, plan.localUrl, until);

  let route = { registered: false };
  if (browserOn) {
    attachBrowser({ root: tree.path, env: process.env, slug, port: plan.primaryPort, prettyUrl, localUrl: plan.localUrl, log, warn })
      .then((state) => (route = state))
      .catch((err) => warn(`shared browser setup errored (ignored): ${err.message}`));
  }

  let stopSignal;
  const result = await runStack({
    children: plan.running,
    cwd: tree.path,
    log,
    onSpawn: (id, pid) => {
      record.processes.push({ id, pid, procStart: processStart(pid) });
      writeRecord(record);
    },
    onStop: (signal) => {
      stopSignal = signal;
      // A stop asked for from outside (not a process of the stack ending it) is announced, with who asked — and what
      // the stack's processes are about to print about their own stop is read as what it is, not as a failure.
      if (signal) log(`stopping the stack (asked by ${stoppedBy(stackDir, signal)}) — each process reports its own stop below ("stopped before finishing" included); that is the stop, not a failure.`);
      until.done = true;
      if (route.registered) detachRoute(tree.path, process.env, slug);
    },
  });
  // The processes are down; what they detached (an emulator suite saving its data) may not be. The stack is not
  // stopped until that is done — and its state dir, where that work keeps its files, stays until then.
  const detached = await awaitDetached(tree.path, key, { say: log });
  for (const w of detached.finished) (w.code ? warn : log)(`${w.id}: ${w.result ?? `ended (code ${w.code ?? 0})`}`);
  if (!result.success) reportFailure(result.failures, plan, detached);
  else if (detached.ok) log(`${key} stopped cleanly${stopSignal ? ` (asked by ${stoppedBy(stackDir, stopSignal)})` : ''}.`);
  dropRecord();
  if (!result.success || !detached.ok) return 1;
  return stopSignal === 'SIGINT' ? INTERRUPTED : 0;
}

/**
 * Say, unmissably, that the stack FAILED: which process died and how, the command it ran, and where its output is.
 * On stderr — the stream `nx serve` shows as the run's own output, in every Nx output mode (it is one task).
 */
function reportFailure(failures, plan, detached) {
  const err = (m) => console.error(`[serve] ${m}`);
  err('✖ the stack FAILED and was stopped:');
  for (const f of failures) {
    const proc = plan.running.find((p) => p.id === f.id);
    err(`  ${f.id} exited ${f.signal ? `on ${f.signal}` : `with code ${f.code}`}${proc ? ` — it ran: ${proc.display}` : ''}`);
  }
  err('  Its output is above.');
  // The detached work's own log is the one place the cause is sure to be (an emulator suite that cannot start says
  // why there — no Java, a port in use). Its tail goes here, where it is read.
  for (const w of detached.finished) {
    if (!w.log) continue;
    err(`  ${w.id} log: ${w.log}${w.code ? ' — its last lines:' : ''}`);
    if (!w.code) continue;
    let tail = [];
    try {
      tail = readFileSync(w.log, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim()).slice(-12);
    } catch {
      /* unreadable — the path is still named */
    }
    for (const line of tail) err(`    | ${line}`);
  }
}

/**
 * WHO STOPPED THE STACK — said as it stops. `dev stop` leaves a STOP REQUEST in the stack's state dir before it
 * signals (stopOne); otherwise the signal is all there is to go by.
 */
const STOP_REQUEST = 'stop-request.json';
function stoppedBy(stackDir, signal) {
  try {
    const req = JSON.parse(readFileSync(join(stackDir, STOP_REQUEST), 'utf8'));
    if (req?.by) return `${req.by}, with tools/dev/dev stop`;
  } catch {
    /* none */
  }
  if (signal === 'SIGINT') return 'a Ctrl+C (SIGINT)';
  if (signal) return `a ${signal} sent to its serve (pid ${process.pid})`;
  return undefined;
}

/** The exact command that stops a stack, as printed for whoever holds its handle. */
function stopCommand(record, tree) {
  const where = samePath(tree.path, ROOT) ? '' : ` --worktree=${tree.branch ?? tree.path}`;
  return `tools/dev/dev stop ${record.app ?? ''} --offset=${record.offset}${where}`.replace(/\s+/g, ' ');
}

const since = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

/** Each port of a record, and whether something is listening on it now. */
async function portStates(record) {
  const out = [];
  for (const [name, port] of Object.entries(record.ports ?? {})) out.push({ name, port, listening: !(await isPortFree(port)) });
  return out;
}

async function ps(opts) {
  const trees = collectWorktrees(ROOT);
  const stacks = readStacks(trees.map((w) => w.path)).filter((s) => !opts.app || s.app === opts.app);
  const label = (s) => {
    const w = trees.find((t) => samePath(t.path, s.tree));
    return w ? `${w.branch ?? w.path}${w.isMain ? ' [main]' : ''}` : s.tree;
  };
  const rows = [];
  for (const s of stacks) {
    rows.push({ ...s, treeLabel: label(s), portStates: s.state === 'foreign' ? [] : await portStates(s), detached: s.state === 'foreign' ? [] : unfinished(s.tree, s.key) });
  }
  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  if (!rows.length) {
    console.log(`No running stacks${opts.app ? ` of ${opts.app}` : ''}.`);
    return 0;
  }
  const me = ownerOf(process.env, undefined);
  for (const s of rows) {
    const mine = s.owner === me ? ' (you)' : '';
    const state =
      s.state === 'live'
        ? `up ${since(s.startedAt)}`
        : s.state === 'orphaned'
          ? `ORPHANED — what started it died without stopping ${survivors(s).map((p) => `${p.id} (pid ${p.pid})`).join(', ')}; stop them with: ${stopCommandFor(s)}`
          : s.state === 'finishing'
            ? `FINISHING — stopped, but still completing work it detached (below); it ends on its own (or now: ${stopCommandFor(s, { abandon: true })})`
            : `${s.state} — claimed in another container (${s.host}) that still keeps it fresh; cannot be checked from here`;
    console.log(`${s.key}  ${s.treeLabel}  pid ${s.pid}  ${state}  owner ${s.owner}${mine}${s.label ? `  — ${s.label}` : ''}`);
    if (s.url) console.log(`    ${s.url}`);
    if (s.portStates.length) console.log(`    ports ${s.portStates.map((p) => `${p.name}=${p.port}${p.listening ? '' : ' (not listening)'}`).join('  ')}`);
    for (const w of s.detached ?? []) console.log(`    ${doing(w)} (pid ${w.pid}${w.log ? `, log ${w.log}` : ''})`);
  }
  return 0;
}

/**
 * Stop ONE stack by its handle: SIGTERM to its claimer's own PID (its graceful path — it stops each process tree
 * exactly once and waits for them; signalling the processes or the process GROUP as well would be the double
 * signal that makes an emulator suite skip its export), wait for it to exit, then confirm the stack's ports are
 * free. Never escalates to a name or a port kill: what it cannot prove it owns, it reports. The one escalation is
 * asked for by name — `--abandon`, which ends detached work instead of waiting for it.
 */
async function stopOne(record, { abandon = false, timeoutMs = DETACHED_TIMEOUT_MS + 60000 } = {}) {
  const say = (m) => console.log(`[stop] ${record.key}: ${m}`);
  // Who asked — read by the serve as it ends, and said there (see stoppedBy).
  if (record.state === 'live') {
    try {
      writeFileSync(join(stackDirOf(record.tree, record.key), STOP_REQUEST), `${JSON.stringify({ by: ownerOf(process.env), pid: process.pid, at: new Date().toISOString() })}\n`);
    } catch {
      /* the stop still happens; only the name is lost */
    }
  }
  // An ORPHANED stack has no claimer left to stop it gracefully: what it started that still runs (each verified to be
  // the very process recorded) gets one SIGTERM each, with its descendants — what the claimer would have sent.
  // A FINISHING one is already stopped: nothing is signalled, its detached work is only waited for (or abandoned).
  const pids =
    record.state === 'orphaned'
      ? survivors(record).flatMap((p) => [...descendants(p.pid), p.pid])
      : record.state === 'finishing'
        ? []
        : [record.pid];
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      if (err?.code !== 'ESRCH') return { ok: false, why: `could not signal pid ${pid}: ${err.message}` };
    }
  }
  // The claimer waits for its detached work (an emulator export, ~30 s) before it exits — say what it is waiting on,
  // so a stop that takes half a minute reads as progress, not as a hang. Abandoning: end that work as soon as it shows.
  const running = () => pids.filter((pid) => isAlive(pid));
  const start = Date.now();
  let next = start + 5000;
  let abandoned = false;
  while (running().length && Date.now() - start < timeoutMs) {
    if (abandon && !abandoned && unfinished(record.tree, record.key).some((w) => w.status === 'stopping')) {
      abandoned = true;
      await abandonDetached(record.tree, record.key, say);
    }
    await sleep(200);
    if (Date.now() >= next) {
      next += 5000;
      const work = unfinished(record.tree, record.key);
      say(`…${work.length ? work.map(doing).join('; ') : 'waiting for its processes to stop'} (${Math.round((Date.now() - start) / 1000)}s)`);
    }
  }
  if (running().length) {
    return { ok: false, why: `pid ${running().join(', ')} still shutting down after ${Math.round(timeoutMs / 1000)}s — nothing was killed; check again with tools/dev/dev ps` };
  }
  if (abandon && unfinished(record.tree, record.key).length) await abandonDetached(record.tree, record.key, say);
  // The claimer reported its own detached work; one that died without waiting for it (or a finishing stack) has not.
  const detached = await awaitDetached(record.tree, record.key, { say });
  for (const w of detached.finished) say(w.result ?? `${w.id} ended (code ${w.code ?? 0})`);
  if (detached.pending.length) return { ok: false, why: `stopped, but its detached work is still finishing (above) — or end it now: ${stopCommandFor(record, { abandon: true })}` };
  if (!detached.ok) return { ok: false, why: `stopped, but ${detached.finished.filter((w) => w.code).map((w) => w.id).join(', ')} did not finish cleanly (above)` };
  if (record.state !== 'live') readStacks([record.tree]);
  // The claimer is gone; its children were waited for, but a socket can outlive its process by a moment.
  let held = [];
  for (let i = 0; i < 25; i++) {
    held = (await portStates(record)).filter((p) => p.listening);
    if (!held.length) break;
    await sleep(200);
  }
  if (held.length) {
    return { ok: false, why: `stopped, but still listening: ${held.map((p) => `${p.name}=${p.port}`).join(', ')} — not this stack's process any more; find the holder with: ss -ltnp 'sport = :${held[0].port}'` };
  }
  return { ok: true };
}

async function stop(opts) {
  const trees = collectWorktrees(ROOT);
  const me = ownerOf(process.env, opts.owner);
  // SELECTING a stack by owner ("my one stack here", "all of mine") is safe only when the owner is one party. A Claude
  // Code session id is shared by the session and every subagent it spawned: "mine" would reach a sibling's stack in
  // the middle of its test. Under it, a stack is stopped by NAME — or the owner is made one party's own.
  if (ownerIsShared(process.env, opts.owner) && (opts.allMine || opts.offset === undefined)) {
    throw new UsageError(
      `your owner (${me}) is this Claude Code session, which its subagents share — so "${opts.allMine ? 'all of mine' : 'my stack here'}" could be a sibling's.\n` +
        '  Name the stack: --offset=<n> (its serve printed the exact stop command; tools/dev/dev ps lists them),\n' +
        '  or give your stacks an owner of their own: DEV_OWNER=<label> on the serve and the stop (or --owner=<label>).',
    );
  }
  let scope;
  if (opts.allMine) {
    if (opts.worktree !== undefined || opts.offset !== undefined) throw new UsageError('--all-mine stops every stack you own, in every tree — it takes no --worktree or --offset');
    scope = trees.map((w) => w.path);
  } else {
    const tree = opts.worktree === undefined ? (trees.find((w) => w.isCurrent) ?? trees[0]) : await selectWorktree(trees, opts.worktree);
    scope = [tree.path];
  }
  const live = readStacks(scope).filter((s) => ['live', 'orphaned', 'finishing'].includes(s.state) && (!opts.app || s.app === opts.app) && (opts.offset === undefined || s.offset === opts.offset));
  const others = live.filter((s) => s.owner !== me);
  const targets = opts.anyOwner ? live : live.filter((s) => s.owner === me);

  if (!opts.anyOwner) {
    for (const s of others) console.log(`[stop] leaving ${s.key} (pid ${s.pid}) running — it is ${s.owner}'s, not yours (${me}). --any-owner stops it anyway, if that is what its owner wants.`);
  }
  if (!targets.length) {
    console.log(`[stop] nothing of yours to stop${opts.offset !== undefined ? ` at offset ${opts.offset}` : ''}${opts.allMine ? '' : ' in this tree'}.`);
    // Asked for one stack by offset and it is someone else's: that is a refusal, not a success.
    return opts.offset !== undefined && others.length ? 1 : 0;
  }
  if (targets.length > 1 && !opts.allMine && opts.offset === undefined) {
    throw new UsageError(`${targets.length} of your stacks run here — name one with --offset (or --all-mine):\n${targets.map((s) => `  ${s.key}  pid ${s.pid}  ${s.url ?? ''}`).join('\n')}`);
  }
  let ok = true;
  for (const s of targets) {
    console.log(s.state === 'finishing' ? `[stop] ${s.key} is already stopped and finishing its detached work — ${opts.abandon ? 'abandoning it' : 'waiting for it'}…` : `[stop] stopping ${s.key} (pid ${s.pid}, ${s.tree})…`);
    const res = await stopOne(s, { abandon: opts.abandon });
    console.log(res.ok ? `[stop] ${s.key} stopped — ports free: ${Object.entries(s.ports ?? {}).map(([n, p]) => `${n}=${p}`).join(' ')}` : `[stop] ${s.key}: ${res.why}`);
    ok &&= res.ok;
  }
  return ok ? 0 : 1;
}

/**
 * `claim <app> --pid=<pid> --ports=<name=port,…>` — a SCRIPT's stack (tools/emulators.sh run on its own, a seed build's
 * private suite), claimed exactly like a serve: the same lock, the same records, the same refusal when another stack
 * holds the block. The claimer is the SCRIPT (`--pid`, normally `$$`), not this short-lived process: the record lives
 * as long as it does. `--shifted` never takes the base ports (a seed build must not land on the developer's).
 * Prints shell assignments for `eval`: STACK_KEY, STACK_OFFSET, STACK_DIR, STACK_TMP, STACK_RECORD.
 */
async function claim(opts) {
  if (!opts.app || opts.pid === undefined || !opts.ports || !Object.keys(opts.ports).length) {
    throw new UsageError('claim needs <app> --pid=<pid> --ports=<name=port,…>');
  }
  const worktrees = collectWorktrees(ROOT);
  const tree = worktrees.find((w) => w.isCurrent) ?? worktrees.find((w) => w.isMain) ?? worktrees[0];
  const { record, passed } = await claimStack({
    ...scopeOf(worktrees),
    tree: tree.path,
    app: opts.app,
    spec: opts.portOffset,
    treeKey: worktreeKey(tree),
    isMain: tree.isMain && !opts.shifted,
    basePorts: opts.ports,
    claimer: opts.pid,
    fields: { owner: ownerOf(process.env, opts.owner), label: opts.app === 'firebase' ? 'emulator suite run directly' : `${opts.app} (its own suite)` },
    say: (m) => console.error(`[claim] ${m}`),
  });
  if (passed.length) console.error(`[claim] not on the preferred ports — held by: ${passed.map(describe).join('; ')}`);
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  console.log(`STACK_KEY=${q(record.key)}`);
  console.log(`STACK_OFFSET=${q(record.offset)}`);
  console.log(`STACK_DIR=${q(stackDirOf(tree.path, record.key))}`);
  console.log(`STACK_TMP=${q(record.tmp)}`);
  console.log(`STACK_RECORD=${q(join(tree.path, '.bespunky', 'run', `${record.key}.json`))}`);
  return 0;
}

/** `release <key> --pid=<pid>` — a script's claim, given up (only while still that script's, and its detached work done). */
function release(opts) {
  if (!opts.app || opts.pid === undefined) throw new UsageError('release needs <key> --pid=<pid>');
  const worktrees = collectWorktrees(ROOT);
  const tree = worktrees.find((w) => w.isCurrent) ?? worktrees[0];
  removeRecord(tree.path, opts.app, opts.pid);
  return 0;
}

function list() {
  const decl = loadDeclaration(ROOT);
  if (!decl) throw new UsageError(`no ${DECLARATION_PATH} in ${ROOT}`);
  for (const [name, app] of Object.entries(decl.apps)) {
    const block = portBlock(declaredPorts(app));
    console.log(`${name}  (offset step ${block.step}, ${block.blocks} blocks)`);
    for (const p of app.processes) {
      const ports = Object.entries(p.ports ?? {}).map(([n, v]) => `${n}=${v}`).join(' ');
      console.log(`  ${p.id}${p === primaryOf(app) ? ' (primary)' : ''}  ${ports}  ${typeof p.cmd === 'string' ? p.cmd : p.cmd.join(' ')}`);
    }
  }
  return 0;
}

/** Run a command; resolves its exit status. */
async function main(argv) {
  const opts = parseArgs(argv);
  switch (opts.command) {
    case 'serve':
      return serve(opts);
    case 'ps':
      return ps(opts);
    case 'stop':
      return stop(opts);
    case 'claim':
      return claim(opts);
    case 'release':
      return release(opts);
    case 'list':
      return list();
    case undefined:
    case 'help':
      console.log(USAGE);
      return opts.command === 'help' ? 0 : 1;
    default:
      throw new UsageError(`unknown command ${opts.command}`);
  }
}

// Run as a program, not imported (the tests import parseArgs). Compared by REAL path: import.meta.url is always the
// resolved file, while argv[1] is the path as invoked — through a symlinked home, macOS's /tmp, or the logical
// NX_WORKSPACE_ROOT_PATH the house sets — and a plain comparison then made `dev serve` print nothing and exit 0.
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      const known = err instanceof UsageError || err instanceof DeclarationError || err instanceof PortError || err instanceof ClaimError;
      console.error(known ? `[${process.argv[2] ?? 'dev'}] ${err.message}` : `[${process.argv[2] ?? 'dev'}] ${err?.stack ?? err}`);
      if (err instanceof UsageError && /unknown|unexpected/.test(err.message)) console.error(USAGE);
      process.exit(1);
    },
  );
}
