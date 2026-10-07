import type { PromiseExecutor, TaskGraph } from '@nx/devkit';
import { logger } from '@nx/devkit';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { attachedDone, exitRecordPath, readExit, writeExit } from '../_utils/run-records';
import type { ServeExecutorSchema } from './schema';

/**
 * `<app>:dev-stack` (what `nx serve <app>` runs, through its `serve` follower) — the NX FACE of the stack-free dev engine.
 *
 * The dev loop lives in `tools/dev/` (written by the `dev` generator) and reads what the project serves from
 * `.bespunky/dev.json`: worktree selection, one port offset for every declared port, `<slug>.localhost`, the
 * shared co-driven browser, one graceful Ctrl+C across every process. None of it is Nx's, so none of it is
 * here. This executor is a THIN WRAPPER: it maps Nx's parsed options onto the engine's flags and hands over.
 *
 *   own options      worktree · portOffset · skip · sharedBrowser · install · dryRun   → engine flags
 *   emulators:false  the historic `--no-emulators` — the Firebase adapter's process id is `emulators`, so it is
 *                    `--skip=emulators` (a no-op, said so, on an app that declares no such process)
 *   port             IGNORED, with a warning — a port is the declaration's (`ports`), shifted by the offset; a
 *                    forwarded `--port` would silently pin the primary back onto its base port
 *   everything else  forwarded to the app's PRIMARY process as `--<key>=<value>` — buildTarget, host,
 *                    proxyConfig, ssl… for an Angular dev-server, whatever a Vite one takes. Generic on purpose:
 *                    the wrapper does not know which framework the primary runs.
 *
 * What the Nx adapter owns lives in the DECLARATION, where a direct `tools/dev/dev serve` sees it too: the
 * processes run `nx run <target>` with NX_WORKSPACE_ROOT_PATH pinned to the served tree and NX_DAEMON=false
 * (see the dev generator's fragments/nx.ts).
 */
const OWN = new Set(['project', 'worktree', 'portOffset', 'skip', 'sharedBrowser', 'install', 'dryRun', 'emulators', 'port']);

/** An option value as one engine flag: `--k` (true), `--k=false`, `--k=<v>`. */
function asFlag(key: string, value: unknown): string {
  if (value === true) return `--${key}`;
  return `--${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`;
}

/** The engine argv for these options (exported for tests). */
export function engineArgs(project: string, options: ServeExecutorSchema & Record<string, unknown>): string[] {
  const args = ['serve', project];
  if (options.worktree !== undefined) args.push(`--worktree=${options.worktree}`);
  if (options.portOffset !== undefined) args.push(`--port-offset=${options.portOffset}`);
  const skip = [options.skip ?? []].flat().flatMap((s) => String(s).split(',')).filter(Boolean);
  if (options.emulators === false) skip.push('emulators');
  if (skip.length) args.push(`--skip=${[...new Set(skip)].join(',')}`);
  if (options.sharedBrowser === false) args.push('--no-shared-browser');
  if (options.install === false) args.push('--no-install');
  if (options.dryRun) args.push('--dry-run');

  const forwarded = Object.entries(options)
    .filter(([key, value]) => !OWN.has(key) && !key.startsWith('_') && !key.startsWith('$') && value !== undefined)
    .map(([key, value]) => asFlag(key, value));
  if (forwarded.length) args.push('--', ...forwarded);
  return args;
}

/** Does anything in THIS run depend on this task (a `serve` follower, an e2e target)? Pure (exported for tests). */
export function dependedOnHere(taskGraph: TaskGraph | undefined, project: string, target: string): boolean {
  if (!taskGraph) return false;
  const mine = new Set(Object.values(taskGraph.tasks).filter((t) => t.target.project === project && t.target.target === target).map((t) => t.id));
  return Object.values(taskGraph.continuousDependencies ?? {}).some((deps) => deps.some((d) => mine.has(d)));
}

const runExecutor: PromiseExecutor<ServeExecutorSchema> = async (options, context) => {
  const project = options.project ?? context.projectName;
  if (!project) {
    logger.error('[serve] No project to serve — attach this target to a project or pass --project.');
    return { success: false };
  }

  const engine = join(context.root, 'tools', 'dev', 'dev.mjs');
  if (!existsSync(engine)) {
    logger.error(
      `[serve] The dev engine is missing (${engine}).\n` +
        '  It is written by the house sync — run `house.sh upgrade <project>` (or `nx g @bespunky/nx-tools:dev`).',
    );
    return { success: false };
  }
  if (options.port !== undefined) {
    logger.warn(
      `[serve] Ignoring port=${options.port}: a served port is declared in .bespunky/dev.json (processes[].ports) and ` +
        'shifted by --port-offset. Change the base port there.',
    );
  }

  // HOW THIS TASK ENDS IS THE RUN'S EXIT STATUS — and Nx reads a continuous task's end by WHEN it comes, not only by
  // its code (task-orchestrator `handleContinuousTaskExit`):
  //   - while a task of this run still depends on it: exit 0 → "continuous but exited with code 0" → CRASHED (the run
  //     fails); 129/130/131/143 → "interrupted" → STOPPED (the run exits 130, "Stopped before finishing").
  //   - once nothing depends on it, or when Nx itself stops it after its dependents are done: SUCCEEDED, whatever the
  //     code ("fulfilled").
  // So a stack that ENDED CLEANLY (`dev stop`) does not end this task while the follower still runs: it stays until Nx
  // releases it — the follower reads the exit record, succeeds, and Nx then stops this task as fulfilled. Exit 0,
  // "3 succeeded", whichever of the two noticed first. A FAILED stack ends this task at once, non-zero: the crash Nx
  // must see while the follower runs (D3). Nothing depending on it here (`nx run <app>:dev-stack` alone): it simply
  // ends, 0 or 1.
  const invocation = process.env.NX_INVOCATION_ROOT_PID ?? '';
  const followed = dependedOnHere(context.taskGraph, project, context.targetName ?? 'dev-stack');
  let release: (() => void) | undefined;
  let stopping = false;
  const released = new Promise<void>((r) => (release = r));

  // A run serve-preflight REFUSED starts no stack: its follower reports the refusal (and fails the run, exit 1).
  // This task only runs at all when Nx did not share another run's — it waits to be released, starting nothing.
  const refused = invocation ? readExit(exitRecordPath(context.root, invocation, project)) : null;
  if (refused?.refused) {
    if (!followed) {
      logger.error((refused.report ?? []).join('\n'));
      return { success: false };
    }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => release?.());
    await released;
    return { success: true };
  }

  const args = engineArgs(project, options as ServeExecutorSchema & Record<string, unknown>);
  return new Promise((resolve) => {
    // The engine's own signal rule, one level up (tools/dev/lib/stack.mjs states it in full): SIGINT is the
    // terminal's Ctrl+C, already delivered to the whole foreground group — the engine and its children have
    // it, so this process only waits. SIGTERM/SIGHUP is a stop aimed at THIS process (Nx, a supervisor,
    // `kill`) that the engine never saw — it gets exactly one SIGTERM, and runs its graceful shutdown. The
    // first stop wins; later signals are absorbed, so Ctrl+C followed by Nx's own SIGTERM is not a second one.
    // Once the engine has ended, any stop is Nx releasing this task.
    const onGroupStop = () => {
      stopping = true;
      release?.();
    };
    const onDirectedStop = () => {
      if (!stopping && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      stopping = true;
      release?.();
    };
    const handlers = { SIGINT: onGroupStop, SIGTERM: onDirectedStop, SIGHUP: onDirectedStop } as const;
    for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
    const done = (success: boolean) => {
      for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
      resolve({ success });
    };
    // DEV_NX_ROOT tells the engine that THIS workspace's Nx holds the stack as its `<app>:dev-stack` task — recorded in
    // the stack's run record, so a second `nx serve` here is told what it would be waiting on (serve-preflight).
    const env = { ...process.env, DEV_NX_ROOT: context.root };
    const child = spawn(process.execPath, [engine, ...args], { cwd: context.root, env, stdio: 'inherit' });
    child.on('error', (err) => {
      logger.error(`[serve] Could not start the dev engine: ${err.message}`);
      done(false);
    });
    child.on('exit', async (code) => {
      if (code !== 0) return done(false);
      // The follower ends on the exit record; an engine that ended cleanly without leaving one (it could not write
      // it) must not leave the follower — and so this task — waiting forever.
      if (invocation && !readExit(exitRecordPath(context.root, invocation, project))) writeExit(context.root, invocation, project, { code: 0 });
      // Runs attached to this stack watch THIS task through Nx's shared-task record, which disappears when it ends
      // (the follower waits for them too, before its return lets Nx stop this task).
      await attachedDone(context.root, project, child.pid);
      if (followed && !stopping) await released;
      done(true);
    });
  });
};

export default runExecutor;
