import type { PromiseExecutor } from '@nx/devkit';
import { logger } from '@nx/devkit';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { tellInvoker } from '../_utils/invoker';

import type { ServePreflightSchema } from './schema';

/**
 * `<app>:serve-preflight` — what a second `nx serve <app>` hears BEFORE Nx decides to wait.
 *
 * Nx runs one instance of a continuous task per workspace: a second `nx serve <app>` in the same tree does not
 * start a stack, it waits on the running `<app>:dev-stack` ("Waiting for <app>:dev-stack in another nx process")
 * and ends when that one stops, without having served what it asked for. That sharing is RIGHT for the composer —
 * it is how an e2e target depending on `dev-stack` reuses the developer's running stack — so `dev-stack` stays
 * continuous, and this target (a non-continuous dependency of it, the serve's flags forwarded) is the one place
 * that runs in the colliding process before the share. It reads the stacks' run records
 * (`tools/dev/dev ps --json`) and:
 *
 *   - nothing of this app served by this workspace's Nx  → silent; the serve starts as always;
 *   - the run asks for a DIFFERENT stack (an explicit --port-offset or --worktree the running one is not)
 *       → refuses, naming the running stack and printing the command that starts the asked-for one beside it
 *         (`tools/dev/dev serve`, which no Nx task lock holds) and the one that stops the running one;
 *   - otherwise (a plain repeat, or an e2e target's dependency) → says this run ATTACHES to the running stack
 *       and will end when it stops, and how to get a second stack instead. The share proceeds.
 *
 * It never fails a serve on its own trouble: no engine, an unreadable answer → silent success. And its verdict is
 * said to the person at the command line in every Nx output mode — including the one that hides task output (see
 * tellInvoker).
 */
interface Stack {
  key: string;
  app: string;
  offset: number;
  pid: number;
  owner: string;
  url: string;
  tree: string;
  treeLabel?: string;
  startedAt: string;
  state: string;
  nxRoot: string | null;
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** Does a `--worktree` spec name this stack's tree (by path, directory name or branch)? */
const namesTree = (spec: string, s: Stack) =>
  real(spec) === real(s.tree) || s.tree.endsWith(`/${spec}`) || (s.treeLabel ?? '').split(' ')[0] === spec;

/** The decision, pure (exported for tests): null = say nothing; otherwise what to say and whether to refuse. */
export function preflight(
  project: string,
  options: ServePreflightSchema,
  holders: Stack[],
): { refuse: boolean; message: string } | null {
  if (!holders.length) return null;
  const offsetAsked = options.portOffset !== undefined && String(options.portOffset).trim().toLowerCase() !== 'auto';
  const worktreeAsked = options.worktree !== undefined && options.worktree !== '';
  const same = holders.find(
    (s) => (!offsetAsked || Number(options.portOffset) === s.offset) && (!worktreeAsked || namesTree(String(options.worktree), s)),
  );
  const list = holders.map((s) => `  ${s.key} · pid ${s.pid} · ${s.url} · owner ${s.owner} · since ${s.startedAt}`).join('\n');
  const flags = [
    offsetAsked ? `--port-offset=${options.portOffset}` : '--port-offset=auto',
    worktreeAsked ? `--worktree=${options.worktree}` : '',
  ].filter(Boolean).join(' ');
  const second = `tools/dev/dev serve ${project} ${flags}`;
  const stop = (s: Stack) => `tools/dev/dev stop ${project} --offset=${s.offset}`;

  if ((offsetAsked || worktreeAsked) && !same) {
    return {
      refuse: true,
      message:
        `${project} is already served by this workspace's \`nx serve\`:\n${list}\n` +
        `Nx runs one \`${project}:dev-stack\` per workspace — this run would only WAIT on it, then end when it stops, without serving what you asked for.\n` +
        `  Start the stack you asked for beside it:  ${second}\n` +
        `  Or stop the running one first:            ${stop(holders[0])}`,
    };
  }
  return {
    refuse: false,
    message:
      `${project} is already served by this workspace's \`nx serve\`:\n${list}\n` +
      `This run ATTACHES to it (Nx shares one \`${project}:dev-stack\` per workspace) and ends when it stops, with its exit status.\n` +
      `  A second, isolated stack instead:  ${second}`,
  };
}

const runExecutor: PromiseExecutor<ServePreflightSchema> = async (options, context) => {
  const project = options.project ?? context.projectName;
  const engine = join(context.root, 'tools', 'dev', 'dev.mjs');
  if (!project || !existsSync(engine)) return { success: true };

  let stacks: Stack[];
  try {
    const out = execFileSync(process.execPath, [engine, 'ps', project, '--json'], { cwd: context.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    stacks = JSON.parse(out) as Stack[];
  } catch {
    return { success: true };
  }
  const here = real(context.root);
  const holders = stacks.filter((s) => s.state === 'live' && s.app === project && s.nxRoot && real(s.nxRoot) === here);
  const verdict = preflight(project, options, holders);
  if (!verdict) return { success: true };
  if (verdict.refuse) {
    logger.error(`[serve] ${verdict.message}`);
    tellInvoker(`[serve] REFUSED — ${verdict.message}`);
    return { success: false };
  }
  logger.warn(`[serve] ${verdict.message}`);
  tellInvoker(`[serve] ${verdict.message}`);
  return { success: true };
};

export default runExecutor;
