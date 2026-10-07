// The process stack — N long-running children under ONE graceful Ctrl+C. GENERATOR-OWNED
// (@bespunky/nx-tools:dev); rewritten every sync.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

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
 * have exited: `{ success, failures }` — `failures` names each child whose own exit failed the stack
 * (`{ id, code, signal }`), so whoever reports the stack can say WHICH process died, not only that one did.
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
 * A child is `{ id, command, args, shell, env }`: `shell` runs `command` through `sh -c` (a hand-written
 * string command); otherwise `command` + `args` are spawned directly. `onSpawn(id, pid)` hears each one start —
 * how the stack's run record learns its processes' PIDs. `onStop(signal)` hears the stop once — with the signal
 * that asked for it, or none when the stack's own processes ended it (how the engine says who stopped the stack).
 */
export function runStack({ children, cwd, onStop, onSpawn, log }) {
  return new Promise((resolve) => {
    if (children.length === 0) {
      resolve({ success: true, failures: [] });
      return;
    }

    const procs = new Array(children.length);
    const done = new Array(children.length).fill(false);
    let remaining = children.length;
    let stopping = false;
    let failed = false;
    const failures = [];
    let stopHandled = false;

    const runOnStop = (signal) => {
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

      // CLEAN means one of two things: the child exited 0, or it ended on a stop — ours (`stopping`), or the
      // terminal's Ctrl+C, which reached the child as SIGINT (or its shell's 130) in the same instant it reached us,
      // so its exit can be processed before our own SIGINT handler has run. Anything else is a failure, whatever
      // shape it takes: a non-zero exit, a SIGKILL from the OOM killer, a segfault. Reading every signal as a
      // clean stop made `nx serve` report success for a stack that had crashed.
      const interrupted = signal === 'SIGINT' || code === 130;
      if (!stopping && !interrupted && code !== 0) {
        failed = true;
        failures.push({ id: children[i].id, code, signal });
      }
      // An interrupted child means the terminal stopped the GROUP: every sibling got the same SIGINT. Treat it as
      // the group stop it is (onGroupStop) — signalling the siblings again here would be the double signal.
      if (interrupted && !stopping) onGroupStop();

      if (!stopping && remaining > 1) {
        log?.(`${children[i].id} exited (${signal ?? code}) — stopping the rest of the stack.`);
        stopping = true;
        runOnStop();
        stopRemaining();
      }

      if (--remaining === 0) {
        cleanup();
        runOnStop();
        resolve({ success: !failed, failures });
      }
    };

    children.forEach((child, i) => {
      const proc = child.shell
        ? spawn('sh', ['-c', child.command], { cwd, env: child.env, stdio: 'inherit' })
        : spawn(child.command, child.args, { cwd, env: child.env, stdio: 'inherit' });
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
    });
  });
}
