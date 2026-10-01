// The process stack — N long-running children under ONE graceful Ctrl+C. GENERATOR-OWNED
// (@bespunky/nx-tools:dev); rewritten every sync.
import { spawn } from 'node:child_process';

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
 * Ctrl+C). The group was never signalled, so each remaining child gets exactly ONE SIGTERM — the stack goes
 * down together instead of leaving orphans.
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

    const stopRemaining = () => {
      for (const p of procs) {
        if (p && p.exitCode === null && p.signalCode === null && p.pid) p.kill('SIGTERM');
      }
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
