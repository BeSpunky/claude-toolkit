import type { PromiseExecutor } from '@nx/devkit';
import { logger } from '@nx/devkit';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ServeWorktreeExecutorSchema } from './schema';
import { runServe } from './serve-process';
import {
  collectWorktrees,
  matchWorktree,
  worktreeLabel,
  type Worktree,
} from './worktrees';

/**
 * Serve a *chosen* git worktree.
 *
 * The house worktree workflow keeps each in-flight feature in its own checkout
 * under `.claude/worktrees/`. There is only one set of forwarded dev ports, so
 * exactly one serve owns them at a time — the job here is to point that single
 * serve at whichever worktree you want to look at, *without* merging the feature
 * back first.
 *
 * It reuses the target's own project `serve` definition (whatever that is — a
 * plain Angular dev-server, or a Firebase emulators + dev-server orchestrator)
 * rather than re-implementing it: pick a worktree, then run
 * `<project>:<serveTarget>` inside that worktree with the workspace-root override
 * that keeps Nx from silently building the main tree's source.
 */
const runExecutor: PromiseExecutor<ServeWorktreeExecutorSchema> = async (
  options,
  context,
) => {
  const project = options.project ?? context.projectName;
  if (!project) {
    logger.error(
      '[serve-worktree] No project to serve — attach this target to a project or pass --project.',
    );
    return { success: false };
  }
  const serveTarget = options.serveTarget ?? 'serve';

  const worktrees = collectWorktrees(context.root);
  if (worktrees.length === 0) {
    logger.error('[serve-worktree] No git worktrees found.');
    return { success: false };
  }

  const chosen = await selectWorktree(worktrees, options);
  if (!chosen) return { success: false };

  if (!ensureInstalled(chosen, options.install !== false, Boolean(options.dryRun))) {
    return { success: false };
  }

  const target = `${project}:${serveTarget}`;
  const nxBin = join(
    chosen.path,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'nx.cmd' : 'nx',
  );
  // NX_WORKSPACE_ROOT_PATH pins Nx to the chosen worktree (otherwise the Nx daemon,
  // which caches a single workspace root across trees, resolves back to the main tree
  // and serves the wrong source); NX_DAEMON=false stops that daemon from cross-talking
  // between trees.
  const env = {
    ...process.env,
    NX_DAEMON: 'false',
    NX_WORKSPACE_ROOT_PATH: chosen.path,
  };

  if (options.dryRun) {
    logger.info('[serve-worktree] DRY RUN — would serve:');
    logger.info(`  worktree : ${worktreeLabel(chosen)}`);
    logger.info(`  command  : ${nxBin} run ${target}`);
    logger.info(`  cwd      : ${chosen.path}`);
    logger.info(`  env      : NX_DAEMON=false NX_WORKSPACE_ROOT_PATH=${chosen.path}`);
    return { success: true };
  }

  logger.info(`[serve-worktree] Serving ${target} from ${worktreeLabel(chosen)}`);

  // Hand off to the serve-process lifecycle, which owns graceful Ctrl+C shutdown.
  return await runServe({ command: nxBin, args: ['run', target], cwd: chosen.path, env });
};

/**
 * Resolve the worktrees down to the single one to serve:
 * explicit `--worktree` wins → a lone worktree is auto-picked → otherwise
 * prompt interactively (requires a TTY).
 */
async function selectWorktree(
  worktrees: Worktree[],
  options: ServeWorktreeExecutorSchema,
): Promise<Worktree | null> {
  if (options.worktree) {
    const matches = matchWorktree(worktrees, options.worktree);
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
      logger.error(`[serve-worktree] No worktree matches "${options.worktree}". Available:`);
    } else {
      logger.error(
        `[serve-worktree] "${options.worktree}" is ambiguous — matches ${matches.length} worktrees:`,
      );
    }
    (matches.length ? matches : worktrees).forEach((w) =>
      logger.error(`  - ${worktreeLabel(w)}`),
    );
    return null;
  }

  if (worktrees.length === 1) {
    logger.info(`[serve-worktree] Only one worktree — serving ${worktreeLabel(worktrees[0])}`);
    return worktrees[0];
  }

  if (!process.stdin.isTTY) {
    logger.error(
      '[serve-worktree] Multiple worktrees but no interactive terminal. Pass --worktree=<branch|path>. Available:',
    );
    worktrees.forEach((w) => logger.error(`  - ${worktreeLabel(w)}`));
    return null;
  }

  return await promptForWorktree(worktrees);
}

/** Minimal shape of enquirer's `Select` prompt — arrow-key navigation + Enter. */
interface SelectPrompt {
  run(): Promise<string>;
}
type SelectCtor = new (opts: {
  name: string;
  message: string;
  initial?: number;
  choices: { name: string; message: string }[];
}) => SelectPrompt;

/**
 * Interactive picker. enquirer ships with Nx; its `Select` prompt gives the
 * arrow-key + Enter selection the workflow calls for. Loaded lazily so the
 * module imports cleanly in non-interactive contexts (and in unit tests).
 */
async function promptForWorktree(worktrees: Worktree[]): Promise<Worktree | null> {
  const mod = (await import('enquirer')) as unknown as {
    Select?: SelectCtor;
    default?: { Select?: SelectCtor };
  };
  const Select = mod.Select ?? mod.default?.Select;
  if (!Select) {
    logger.error('[serve-worktree] enquirer Select prompt unavailable.');
    return null;
  }

  const initial = Math.max(
    0,
    worktrees.findIndex((w) => w.isCurrent),
  );
  const prompt = new Select({
    name: 'worktree',
    message: 'Which worktree do you want to serve?',
    initial,
    choices: worktrees.map((w) => ({ name: w.path, message: worktreeLabel(w) })),
  });

  try {
    const answer = await prompt.run();
    return worktrees.find((w) => w.path === answer) ?? null;
  } catch {
    // enquirer rejects with '' on Ctrl+C / Esc — a deliberate cancel, not an error.
    logger.info('[serve-worktree] Cancelled.');
    return null;
  }
}

/**
 * Guarantee the chosen worktree has its own `node_modules`. Fresh worktrees
 * start empty; installing on first serve removes the "why is my feature not
 * showing" foot-gun. Returns false only on a real, blocking failure.
 */
function ensureInstalled(worktree: Worktree, install: boolean, dryRun: boolean): boolean {
  if (existsSync(join(worktree.path, 'node_modules'))) return true;

  if (dryRun) {
    logger.info(
      `[serve-worktree] (dry run) ${worktree.path} has no node_modules — would run 'yarn install'.`,
    );
    return true;
  }
  if (!install) {
    logger.error(
      `[serve-worktree] ${worktree.path} has no node_modules and --install=false. Run 'yarn install' there first.`,
    );
    return false;
  }

  logger.info(
    `[serve-worktree] Installing dependencies in ${worktree.path} (first serve of this worktree)…`,
  );
  try {
    execFileSync('yarn', ['install'], { cwd: worktree.path, stdio: 'inherit' });
    return true;
  } catch (err) {
    logger.error(
      `[serve-worktree] 'yarn install' failed in ${worktree.path}: ${(err as Error).message}`,
    );
    return false;
  }
}

export default runExecutor;
