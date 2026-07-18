import { logger } from '@nx/devkit';
import { spawn, type ChildProcess } from 'node:child_process';

/** One long-running child of the serve stack (the app dev-server, or the Firebase emulator suite). */
export interface ServeChild {
  /** Short label for logs, e.g. `app` or `emulators`. */
  label: string;
  /** Executable to run (the resolved tree's own `nx` binary). */
  command: string;
  /** Arguments, e.g. `['run', '<app>:dev-server', '--port=4200']`. */
  args: string[];
}

export interface ServeStackOptions {
  /** The continuous children to run in parallel (each an `nx run …` invocation). */
  children: ServeChild[];
  /** Working directory — the resolved tree's root. */
  cwd: string;
  /** Environment for every child (carries NX_WORKSPACE_ROOT_PATH / NX_DAEMON / PORT_OFFSET). */
  env: NodeJS.ProcessEnv;
  /** Best-effort teardown, run EXACTLY ONCE when the stack stops (e.g. unregister the worktree domain). */
  onStop?: () => void;
}

/**
 * Run the serve stack — the app dev-server plus, optionally, the Firebase emulator suite — as N
 * parallel children in ONE shared foreground process group, and await them.
 *
 * Signal discipline (the reason this is bespoke rather than N independent runs):
 * each child is itself an `nx` invocation whose own orchestrator spawns the continuous work and, on
 * shutdown, sends a single graceful `SIGTERM` to each of its process trees. Because we run the children
 * with `stdio: 'inherit'` in OUR foreground process group, one terminal Ctrl+C is delivered by the
 * terminal to the WHOLE group — every child gets exactly one SIGINT. So we forward NOTHING; forwarding a
 * second signal on top of the terminal's is precisely the bug that once made a downstream emulator read
 * "force quit" and skip its data export. We only note that a stop was requested (which also keeps this
 * process alive to await each child's clean shutdown) and run the best-effort `onStop` once.
 *
 * The one case where WE signal: a child that dies on its OWN while siblings still run (a crash, not a
 * Ctrl+C). The group was never signalled, so we send exactly ONE SIGTERM to each remaining child tree —
 * the same single graceful stop, never a double-signal — so the stack goes down together instead of
 * leaving orphans.
 */
export function runServeStack(options: ServeStackOptions): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const { children } = options;
    if (children.length === 0) {
      resolve({ success: true });
      return;
    }

    const procs: (ChildProcess | undefined)[] = new Array(children.length);
    const done: boolean[] = new Array(children.length).fill(false);
    let remaining = children.length;
    let stopping = false; // an external Ctrl+C OR an internal teardown is under way
    let failed = false;
    let stopHandled = false;

    const runOnStop = () => {
      if (stopHandled) return;
      stopHandled = true;
      try {
        options.onStop?.();
      } catch {
        /* teardown is best-effort — never let it fail the serve */
      }
    };

    // Send ONE SIGTERM to each still-running child (used only for an internal teardown — a crash —
    // where the terminal has NOT already signalled the group). Never double-signals: it runs only when
    // `stopping` was false, i.e. no terminal Ctrl+C is in flight.
    const stopRemaining = () => {
      for (const p of procs) {
        if (p && p.exitCode === null && p.signalCode === null && p.pid) {
          p.kill('SIGTERM');
        }
      }
    };

    // Terminal Ctrl+C already reaches every child in our shared foreground group — forward nothing.
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

    // Called once per child when it finishes (via 'exit' or a spawn 'error'). Guarded so the two events
    // can't double-count a single child.
    const settle = (i: number, code: number | null) => {
      if (done[i]) return;
      done[i] = true;

      // A Ctrl+C stop ends a child via signal (exit code `null`, or the 128+n signal-exit convention) —
      // a clean shutdown, not a failure. Only an unbidden non-zero exit is a real failure.
      const stoppedBySignal = code === null || (typeof code === 'number' && code >= 128);
      if (!stopping && !stoppedBySignal && code !== 0) failed = true;

      // A child that exits on its own while siblings still run → tear the rest down gracefully.
      if (!stopping && remaining > 1) {
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
      const proc = spawn(child.command, child.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: 'inherit',
      });
      procs[i] = proc;

      proc.on('error', (err) => {
        logger.error(`[serve] Failed to start ${child.label}: ${err.message}`);
        failed = true;
        settle(i, 1);
      });
      proc.on('exit', (code) => settle(i, code));
    });
  });
}
