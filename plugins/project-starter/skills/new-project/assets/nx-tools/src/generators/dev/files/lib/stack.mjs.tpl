// The process stack — N long-running children under ONE graceful Ctrl+C. GENERATOR-OWNED
// (@bespunky/nx-tools:dev); rewritten every sync.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

/** Every descendant of `pid`, deepest first — read from /proc (Linux; elsewhere none). */
function descendants(pid) {
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
 * have exited: `{ success }`.
 *
 * Signal discipline (the reason this is bespoke rather than N independent runs): the children inherit our
 * stdio and process group, so one terminal Ctrl+C is delivered by the terminal to the WHOLE group — every
 * child gets exactly one SIGINT. So we forward NOTHING; forwarding a second signal on top of the terminal's
 * is precisely the bug that once made an emulator suite read "force quit" and skip its data export. We only
 * note that a stop was requested (which keeps this process alive to await each child's clean shutdown) and
 * run `onStop` once.
 *
 * The one case where WE signal: a child that dies on its OWN while siblings still run (a crash, not a
 * Ctrl+C). The group was never signalled, so each remaining child TREE gets exactly ONE SIGTERM — the stack
 * goes down together instead of leaving orphans.
 *
 * A child is `{ id, command, args, shell, env }`: `shell` runs `command` through `sh -c` (a hand-written
 * string command); otherwise `command` + `args` are spawned directly.
 */
export function runStack({ children, cwd, onStop, log }) {
  return new Promise((resolve) => {
    if (children.length === 0) {
      resolve({ success: true });
      return;
    }

    const procs = new Array(children.length);
    const done = new Array(children.length).fill(false);
    let remaining = children.length;
    let stopping = false;
    let failed = false;
    let stopHandled = false;

    const runOnStop = () => {
      if (stopHandled) return;
      stopHandled = true;
      try {
        onStop?.();
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

    const onSignal = () => {
      if (stopping) return;
      stopping = true;
      runOnStop();
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const cleanup = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    };

    const settle = (i, code) => {
      if (done[i]) return;
      done[i] = true;

      // A Ctrl+C stop ends a child via signal (code null, or 128+n) — a clean shutdown, not a failure.
      const stoppedBySignal = code === null || (typeof code === 'number' && code >= 128);
      if (!stopping && !stoppedBySignal && code !== 0) failed = true;

      if (!stopping && remaining > 1) {
        log?.(`${children[i].id} exited (${code ?? 'signal'}) — stopping the rest of the stack.`);
        stopping = true;
        runOnStop();
        stopRemaining();
      }

      if (--remaining === 0) {
        cleanup();
        runOnStop();
        resolve({ success: !failed });
      }
    };

    children.forEach((child, i) => {
      const proc = child.shell
        ? spawn('sh', ['-c', child.command], { cwd, env: child.env, stdio: 'inherit' })
        : spawn(child.command, child.args, { cwd, env: child.env, stdio: 'inherit' });
      procs[i] = proc;
      proc.on('error', (err) => {
        log?.(`failed to start ${child.id}: ${err.message}`);
        failed = true;
        settle(i, 1);
      });
      proc.on('exit', (code) => settle(i, code));
    });
  });
}
