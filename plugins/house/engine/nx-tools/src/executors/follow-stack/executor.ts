import type { PromiseExecutor } from '@nx/devkit';
import { logger } from '@nx/devkit';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { tellInvoker } from '../_utils/invoker';
import { type ExitRecord, attachedDone, exitRecordPath, isAlive, readExit, registerFollower } from '../_utils/run-records';
import type { FollowStackSchema } from './schema';

/**
 * `<app>:serve` — what a person or an agent types, FOLLOWING the stack `<app>:dev-stack` runs, to its end.
 *
 * WHY IT EXISTS. Nx completes a continuous task that ends while nothing depends on it as SUCCEEDED, whatever its exit
 * code (task-orchestrator `handleContinuousTaskExit`: not needed → "fulfilled"). With `nx serve` straight on the
 * continuous composer, a stack whose emulators died reported "2 tasks: 2 succeeded" and exit 0 — and background
 * runners, an agent's included, trust that status. So `serve` is this NON-continuous follower, depending on
 * `dev-stack` (flags forwarded): while it runs, a dying stack is a crashed dependency and the run fails; and the
 * follower ends with the stack's own exit status, read from the engine's EXIT RECORD
 * (`.bespunky/run/exits/<invocation>@<app>.json`, written by tools/dev/dev as its last act), so either order of
 * the two endings gives the same answer.
 *
 * WHICH STACK. Its own run's, found by the invocation (Nx hands every task NX_INVOCATION_ROOT_PID; the engine records
 * it). Or — when this run ATTACHED to a stack another `nx serve` in this workspace runs (Nx shares the continuous
 * `dev-stack`; serve-preflight said so) — that stack, followed until its engine exits, and said to be over, with
 * who stopped it. It registers itself with that stack (run-records `registerFollower`), whose dev-stack then keeps
 * Nx's shared task alive until this run has ended — or this run's Nx would read the stack's end as a crash.
 *
 * A REFUSED RUN. serve-preflight never fails (a failed dependency leaves this task SKIPPED, and Nx exits a run with a
 * skipped task 130 — a Ctrl+C, to anyone reading the status). It writes the refusal as this run's exit record; the
 * follower says it and fails: exit 1.
 */
interface Stack {
  app: string;
  key: string;
  pid: number;
  state: string;
  owner: string;
  nxRoot: string | null;
  invocation: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

function stacksOf(engine: string, project: string, root: string): Stack[] {
  try {
    const out = execFileSync(process.execPath, [engine, 'ps', project, '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out) as Stack[];
  } catch {
    return [];
  }
}

/**
 * The run's result from a stack's exit record. Pure (exported for tests). `message` is the full account, for this
 * task's log; `headline` the same in a line or two, said to the invoker — the stack's stream already printed the full
 * block, so repeating all of it beside Nx's summary would be noise, and saying nothing there would leave an agent
 * with "✖ nx run <app>:serve" and a file path. `followed` names the stack when this run was ATTACHED to another
 * run's: its end is news here, and how it ended is said either way.
 */
export function verdict(
  project: string,
  record: ExitRecord,
  followed?: { key: string; owner?: string },
): { success: boolean; message?: string; headline?: string; note?: string } {
  if (record.refused) {
    const told = (record.report ?? []).join('\n');
    return { success: false, message: told, headline: `[serve] REFUSED — ${told.replace(/^\[serve\] /, '')}` };
  }
  const whose = followed ? `${followed.key} — the stack this run was following${followed.owner ? ` (owner ${followed.owner})` : ''} —` : `${project}'s dev stack`;
  if (record.code === 0) {
    if (!followed) return { success: true };
    return { success: true, note: `[serve] ${whose} was stopped${record.stoppedBy ? ` by ${record.stoppedBy}` : ''}; it ended cleanly, so this run did too.` };
  }
  const told = (record.report ?? []).join('\n');
  const head = `[serve] ${whose} FAILED (exit ${record.code})`;
  return {
    success: false,
    message: `${head}.${told ? `\n${told}` : ' Its output is above.'}`,
    headline: `${head}: ${(record.summary ?? []).join('; ') || 'see its output above'}`,
  };
}

const runExecutor: PromiseExecutor<FollowStackSchema> = async (options, context) => {
  const project = options.project ?? context.projectName;
  if (!project) return { success: false };
  const root = context.root;
  const engine = join(root, 'tools', 'dev', 'dev.mjs');
  const mine = process.env.NX_INVOCATION_ROOT_PID ?? '';

  const finish = async (record: ExitRecord, followed?: Stack) => {
    // This run's own stack: Nx stops `dev-stack` the moment this task returns, and runs attached to the stack are
    // watching that task — they must have ended first, or they read its end as a crash.
    if (!followed && !record.refused) await attachedDone(root, project, record.pid);
    const v = verdict(project, record, followed);
    if (v.message) logger.error(v.message);
    // Claude reads `nx serve` in Nx's agent renderer, which prints a task's output as a log path at best — which
    // process died and why, a refusal, and who stopped a followed stack go where they are read.
    if (v.note) logger.info(v.note);
    const said = v.headline ?? v.note;
    if (said) tellInvoker(said);
    return { success: v.success };
  };

  let ownSeen = false;
  let followed: Stack | undefined;
  let lastLook = 0;
  for (;;) {
    const own = mine ? readExit(exitRecordPath(root, mine, project)) : null;
    if (own) return finish(own);
    if (followed) {
      if (!isAlive(followed.pid)) {
        // An attached run ends when the stack it shares ends — with that stack's status, when its engine recorded it.
        return finish((followed.invocation && readExit(exitRecordPath(root, followed.invocation, project))) || { code: 0 }, followed);
      }
    } else if (!ownSeen && Date.now() - lastLook >= 2000 && existsSync(engine)) {
      lastLook = Date.now();
      const stacks = stacksOf(engine, project, root).filter((s) => s.app === project);
      ownSeen = stacks.some((s) => mine && String(s.invocation) === mine);
      if (!ownSeen) {
        followed = stacks.find((s) => s.state === 'live' && s.invocation && String(s.invocation) !== mine && s.nxRoot && real(s.nxRoot) === real(root));
        // Say so to that stack, which then lets its Nx drop the shared task only after this run has ended.
        if (followed && mine) registerFollower(root, mine, project, followed.pid);
      }
    }
    // Waiting on nothing else is safe: if `dev-stack` dies before recording anything, Nx fails the run and ends us.
    await sleep(250);
  }
};

export default runExecutor;
