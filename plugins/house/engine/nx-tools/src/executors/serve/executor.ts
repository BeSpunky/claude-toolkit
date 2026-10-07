import type { PromiseExecutor } from '@nx/devkit';
import { logger } from '@nx/devkit';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ServeExecutorSchema } from './schema';

/**
 * `<app>:serve` and `<app>:dev-stack` — the NX FACE of the stack-free dev engine, on two targets of this one executor:
 *
 *   serve      NOT continuous — what `nx serve <app>` runs. Nx shares only CONTINUOUS tasks between invocations, so
 *              every `nx serve` is its OWN stack (the engine claims its own port block: `auto` skips claimed ones),
 *              and the run's exit status is the engine's: 0 on a clean stop, non-zero when the stack failed. (A
 *              continuous task that ends while nothing depends on it is reported as SUCCEEDED whatever its code —
 *              which is why `serve` must not be one.) Explicitly `continuous: false` in project.json: Nx fills an
 *              absent key from targetDefaults or this executor's schema, and @nx/angular's set-continuous-option
 *              migration sets it on any dev-server-looking target that lacks it.
 *   dev-stack  the same, CONTINUOUS — only so an e2e target can `dependsOn` a running stack (and two e2e runs, or
 *              an e2e beside a `nx run <app>:dev-stack`, share it — the one level where Nx's sharing is right).
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

  const args = engineArgs(project, options as ServeExecutorSchema & Record<string, unknown>);
  return new Promise((resolve) => {
    // The engine's own signal rule, one level up (tools/dev/lib/stack.mjs states it in full): SIGINT is the
    // terminal's Ctrl+C, already delivered to the whole foreground group — the engine and its children have
    // it, so this process only waits. SIGTERM/SIGHUP is a stop aimed at THIS process (Nx, a supervisor,
    // `kill`) that the engine never saw — it gets exactly one SIGTERM, and runs its graceful shutdown. The
    // first stop wins; later signals are absorbed, so Ctrl+C followed by Nx's own SIGTERM is not a second one.
    let stopping = false;
    const onGroupStop = () => {
      stopping = true;
    };
    const onDirectedStop = () => {
      if (!stopping && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      stopping = true;
    };
    const handlers = { SIGINT: onGroupStop, SIGTERM: onDirectedStop, SIGHUP: onDirectedStop } as const;
    for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
    const done = (success: boolean) => {
      for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
      resolve({ success });
    };
    const child = spawn(process.execPath, [engine, ...args], { cwd: context.root, stdio: 'inherit' });
    child.on('error', (err) => {
      logger.error(`[serve] Could not start the dev engine: ${err.message}`);
      done(false);
    });
    // The engine's exit status IS this task's: 0 on a clean stop (`dev stop`, the stack's own end), non-zero — with the
    // engine's own account of which process died, already on the stream — when the stack failed.
    child.on('exit', (code) => done(code === 0));
  });
};

export default runExecutor;
