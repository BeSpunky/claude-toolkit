import type { PromiseExecutor } from '@nx/devkit';
import { logger } from '@nx/devkit';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ServeExecutorSchema } from './schema';

/**
 * `nx serve <app>` — the NX FACE of the stack-free dev engine.
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
        '  It is written by the house sync — run `scaffold.sh --sync <project>` (or `nx g @bespunky/nx-tools:dev`).',
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
    // Same foreground process group as the engine and its children: the terminal's Ctrl+C reaches all of
    // them once. This process only waits for the engine's own graceful shutdown — it forwards nothing.
    const hold = () => undefined;
    process.on('SIGINT', hold);
    process.on('SIGTERM', hold);
    const done = (success: boolean) => {
      process.off('SIGINT', hold);
      process.off('SIGTERM', hold);
      resolve({ success });
    };
    const child = spawn(process.execPath, [engine, ...args], { cwd: context.root, env: process.env, stdio: 'inherit' });
    child.on('error', (err) => {
      logger.error(`[serve] Could not start the dev engine: ${err.message}`);
      done(false);
    });
    child.on('exit', (code) => done(code === 0));
  });
};

export default runExecutor;
