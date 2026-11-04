// The process stack — N long-running children under ONE graceful Ctrl+C. GENERATOR-OWNED
// (@bespunky/nx-tools:dev); rewritten every sync.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

import { describeProbe, waitUntilReady } from './ready.mjs';

/** Every descendant of `pid`, deepest first — read from /proc (Linux; elsewhere none). */
export function descendants(pid) {
  let entries;
  try {
    entries = readdirSync('/proc').filter((e) => /^\d+$/.test(e));
  } catch {
    return [];
  }
  const children = new Map();
  for (const e of entries) {
    try {
      // /proc/<pid>/stat: "pid (comm) state ppid …" — comm may contain spaces, so split after the last ')'.
      const stat = readFileSync(`/proc/${e}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(e));
    } catch {
      /* exited meanwhile */
    }
  }
  const out = [];
  const walk = (p) => {
    for (const c of children.get(p) ?? []) {
      walk(c);
      out.push(c);
    }
  };
  walk(pid);
  return out;
}

/**
 * Run the declared processes as parallel children in OUR foreground process group, and resolve when all
 * have exited: `{ success, failures, exits }` — `failures` names each child whose own exit failed the stack
 * (`{ id, code, signal, why? }`), so whoever reports the stack can say WHICH process died, not only that one did;
 * `exits` is how each one ended, `{ id: { code, signal } }`.
 *
 * THE ORDER. A child marked `dependency` starts first, in the order given, each once the one before it passes its
 * `ready` probe (at most `readyTimeoutMs`); then every other child starts, at once. A dependency runs for as long as the
 * stack does, so its own exit is a failure WHATEVER the code, and while any child has yet to start, any end of a running
 * one (that exit, a stop, a timed-out probe) means the rest never starts: this ends with what was started.
 *
 * Signal discipline (the reason this is bespoke rather than N independent runs) — the rule is decided by WHO
 * delivered the signal, and the signal's name says who that almost always is:
 *
 *   SIGINT            the TERMINAL's Ctrl+C. The children inherit our stdio and process group, so the terminal
 *                     delivered it to the WHOLE group — every child already got exactly one SIGINT. We forward
 *                     NOTHING: a second signal on top of the terminal's is precisely the bug that once made an
 *                     emulator suite read "force quit" and skip its data export. We note the stop (which keeps
 *                     this process alive to await each child's clean shutdown) and run `onStop` once.
 *   SIGTERM / SIGHUP  a stop aimed at US — `kill <pid>`, `timeout`, a supervisor, an IDE closing its task. The
 *                     children were NOT told, so swallowing it (as this once did) left the engine waiting forever
 *                     and every server still listening. We run the same graceful shutdown a crashed sibling
 *                     triggers: each remaining child tree gets exactly ONE SIGTERM, then we wait for all of them.
 *
 * Whichever stop comes first wins; every later signal is absorbed, so a SIGINT followed by a supervisor's SIGTERM
 * (e.g. Nx stopping its task after the terminal's Ctrl+C) never becomes the double signal. Known residue, by
 * construction: a SIGTERM/SIGHUP sent to the whole GROUP (`kill -- -<pgid>`, GNU `timeout` without --foreground,
 * a shell re-sending SIGHUP to its jobs as the terminal closes) reaches the children directly AND through us —
 * a signal carries no sender we can read, so the name is the whole rule. A sender that means "stop the group"
 * should send SIGINT, which is the Ctrl+C path.
 *
 * The other case where WE signal: a child that dies on its OWN while siblings still run (a crash, not a stop).
 * The group was never signalled, so each remaining child TREE gets exactly ONE SIGTERM — the stack goes down
 * together instead of leaving orphans.
 *
 * A child is `{ id, command, args, shell, env, dependency?, ready?, readyTimeoutMs? }`: `shell` runs `command` through `sh -c` (a hand-written
 * string command); otherwise `command` + `args` are spawned directly. `onSpawn(id, pid)` hears each one start —
 * how the stack's run record learns its processes' PIDs. `onWaiting(id)` hears each dependency being waited for, and
 * `onUp()` that every process has been started (only when that happens). `onStop(signal)` hears the stop once — with the signal
 * that asked for it, or none when the stack's own processes ended it (how the engine says who stopped the stack).
 * `lockFd`, the stack's lock (lib/stacks.mjs), is every child's fd 3: each one keeps the stack alive while it runs —
 * so a serve killed outright leaves an ORPHANED stack `dev stop` can still end, not a dead record over live servers.
 */
export function runStack({ children, cwd, onStop, onSpawn, onWaiting, onUp, log, lockFd }) {
  return new Promise((resolve) => {
    if (children.length === 0) {
      resolve({ success: true, failures: [], exits: {} });
      return;
    }

    const procs = new Array(children.length);
    const done = new Array(children.length).fill(false);
    const passedReady = new Array(children.length).fill(false);
    const exits = {};
    let remaining = 0; // started and not yet ended
    let unstarted = children.length; // held back behind a dependency; a stop means they never start
    let stopping = false;
    let failed = false;
    const failures = [];
    let stopHandled = false;
    const waiting = new AbortController(); // ends a dependency's readiness wait the moment the stack stops

    const runOnStop = (signal) => {
      waiting.abort();
      if (stopHandled) return;
      stopHandled = true;
      try {
        onStop?.(signal);
      } catch {
        /* teardown is best-effort — never let it fail the serve */
      }
    };

    // ONE SIGTERM per remaining child. A direct (argv) child gets it alone: it may be an orchestrator (nx)
    // that stops its own tree gracefully, and signalling that tree as well is the double signal an emulator
    // suite reads as "force quit". A `sh -c` child is a mere wrapper that may not have exec'd, so its
    // descendants get the one SIGTERM too — or the real server would be orphaned.
    const stopRemaining = () => {
      procs.forEach((p, i) => {
        if (!p || p.exitCode !== null || p.signalCode !== null || !p.pid) return;
        const tree = children[i].shell ? [...descendants(p.pid), p.pid] : [p.pid];
        for (const pid of tree) {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {
            /* already gone */
          }
        }
      });
    };

    // The children already have it (the terminal signalled the group): note the stop, wait.
    const onGroupStop = () => {
      if (stopping) return;
      stopping = true;
      runOnStop('SIGINT');
    };
    // Aimed at us alone: tell each child once, then wait.
    const onDirectedStop = (signal) => {
      if (stopping) return;
      stopping = true;
      runOnStop(signal);
      stopRemaining();
    };
    const handlers = { SIGINT: onGroupStop, SIGTERM: onDirectedStop, SIGHUP: onDirectedStop };
    for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
    const cleanup = () => {
      for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
    };

    const settle = (i, code, signal) => {
      if (done[i]) return;
      done[i] = true;
      exits[children[i].id] = { code, signal };

      // CLEAN means one of two things: the child exited 0, or it ended on a stop — ours (`stopping`), or the
      // terminal's Ctrl+C, which reached the child as SIGINT (or its shell's 130) in the same instant it reached us,
      // so its exit can be processed before our own SIGINT handler has run. Anything else is a failure, whatever
      // shape it takes: a non-zero exit, a SIGKILL from the OOM killer, a segfault. Reading every signal as a
      // clean stop made `nx serve` report success for a stack that had crashed.
      const interrupted = signal === 'SIGINT' || code === 130;
      if (!stopping && !interrupted && (code !== 0 || children[i].dependency)) {
        failed = true;
        failures.push({
          id: children[i].id,
          code,
          signal,
          ...(children[i].dependency ? { why: passedReady[i] ? 'a dependency runs for as long as the stack does' : 'before it was ready, so nothing else started' } : {}),
        });
      }
      // An interrupted child means the terminal stopped the GROUP: every sibling got the same SIGINT. Treat it as
      // the group stop it is (onGroupStop) — signalling the siblings again here would be the double signal.
      if (interrupted && !stopping) onGroupStop();

      if (!stopping && (remaining > 1 || unstarted > 0)) {
        log?.(`${children[i].id} exited (${signal ?? code}) — stopping the rest of the stack.`);
        stopping = true;
        runOnStop();
        stopRemaining();
      }

      if (--remaining === 0) {
        cleanup();
        runOnStop();
        resolve({ success: !failed, failures, exits });
      }
    };

    const start = (child, i) => {
      remaining++;
      unstarted--;
      const stdio = lockFd === undefined ? 'inherit' : ['inherit', 'inherit', 'inherit', lockFd];
      const proc = child.shell
        ? spawn('sh', ['-c', child.command], { cwd, env: child.env, stdio })
        : spawn(child.command, child.args, { cwd, env: child.env, stdio });
      procs[i] = proc;
      if (proc.pid) {
        try {
          onSpawn?.(child.id, proc.pid);
        } catch {
          /* bookkeeping only — never let it fail the serve */
        }
      }
      proc.on('error', (err) => {
        log?.(`failed to start ${child.id}: ${err.message}`);
        failed = true;
        settle(i, 1);
      });
      proc.on('exit', (code, signal) => settle(i, code, signal));
    };

    const inform = (fn, ...args) => {
      try {
        fn?.(...args);
      } catch {
        /* bookkeeping only — never let it fail the serve */
      }
    };

    /** Past its deadline: the stack fails, naming what it waited on and what the last attempt answered. */
    const notReady = (child, said) => {
      const seconds = Math.round(child.readyTimeoutMs / 1000);
      log?.(`${child.id} did not become ready within ${seconds}s — stopping the stack.`);
      failed = true;
      failures.push({ id: child.id, why: `it did not become ready within ${seconds}s (${describeProbe(child.ready)}${said ? `; last answer: ${said}` : ''}), so nothing else started` });
      stopping = true;
      runOnStop();
      stopRemaining();
    };

    (async () => {
      for (const [i, child] of children.entries()) {
        if (!child.dependency) continue;
        start(child, i);
        inform(onWaiting, child.id);
        log?.(`waiting for ${child.id} to be ready (${describeProbe(child.ready)})…`);
        const { ok, said } = await waitUntilReady(child.ready, { cwd, env: child.env, signal: waiting.signal, timeoutMs: child.readyTimeoutMs });
        if (stopping || done[i]) return; // settle() has stopped the stack: nothing else starts
        if (!ok) return notReady(child, said);
        passedReady[i] = true;
        log?.(`${child.id} is ready.`);
      }
      children.forEach((child, i) => child.dependency || start(child, i));
      inform(onUp);
    })();
  });
}
