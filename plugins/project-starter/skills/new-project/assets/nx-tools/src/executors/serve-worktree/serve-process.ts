import { logger } from '@nx/devkit';
import { spawn } from 'node:child_process';

export interface ServeProcessOptions {
  /** Executable to run (the chosen worktree's own `nx` binary). */
  command: string;
  /** Arguments, e.g. `['run', '<app>:serve']`. */
  args: string[];
  /** Working directory — the chosen worktree's root. */
  cwd: string;
  /** Environment for the child (carries the NX_WORKSPACE_ROOT_PATH override). */
  env: NodeJS.ProcessEnv;
}

/**
 * Run the delegated `nx run <project>:<serveTarget>` and await it.
 *
 * We deliberately do NOT manage signals or process groups here — Nx already does.
 * The child is itself an `nx` invocation whose own task orchestrator spawns the
 * continuous tasks (e.g. Firebase emulators + the Angular dev server) **detached**,
 * and on shutdown its `cleanup()` sends a single graceful `SIGTERM` to each process
 * tree (see nx `run-commands` `running-tasks.js`). Running the child in our foreground
 * process group (`stdio: 'inherit'`) lets the terminal deliver one Ctrl+C straight
 * to it, which triggers that graceful teardown.
 *
 * The earlier bug was forwarding a *second* SIGINT to the child on top of the one
 * the terminal already delivered to the shared group — a downstream emulator read the
 * second as "force quit" and skipped its data export. So we forward nothing. We only
 * note that a stop was requested (installing the listeners also keeps this process
 * alive to await the child's own clean shutdown) and map the exit code.
 */
export function runServe(options: ServeProcessOptions): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
    });

    let stopping = false;
    const noteStop = () => {
      stopping = true;
    };
    process.on('SIGINT', noteStop);
    process.on('SIGTERM', noteStop);
    const cleanup = () => {
      process.off('SIGINT', noteStop);
      process.off('SIGTERM', noteStop);
    };

    child.on('error', (err) => {
      cleanup();
      logger.error(`[serve-worktree] Failed to start serve: ${err.message}`);
      resolve({ success: false });
    });
    child.on('exit', (code) => {
      cleanup();
      // A Ctrl+C stop ends the serve via signal (exit code `null`, or the 128+n
      // signal-exit convention) — a clean shutdown, not a failure. Only an unbidden
      // non-zero exit is a real failure.
      const stoppedBySignal = code === null || (typeof code === 'number' && code >= 128);
      resolve({ success: stopping || stoppedBySignal || code === 0 });
    });
  });
}
