// The files `nx serve`'s three tasks (serve-preflight, dev-stack, serve) leave each other under `<nx root>/.bespunky/run/`
// — self-ignoring, machine-local. One home for their shapes, so the writer and the readers cannot drift.
//
//   exits/<invocation>@<app>.json      THE EXIT RECORD — how this invocation's stack ended (or why it never started).
//                                      Written by the dev engine as its last act (tools/dev/dev.mjs writeExit); by
//                                      serve-preflight for a REFUSED run; by dev-stack as a fallback when the engine
//                                      ended cleanly without leaving one. Read by the `serve` follower.
//   followers/<invocation>@<app>.json  An ATTACHED follower: a `serve` in ANOTHER invocation following this stack. The
//                                      stack's dev-stack waits for it before it lets its own Nx drop the shared task —
//                                      which is what that other run's Nx is watching.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ExitRecord {
  code: number;
  /** The engine's full account (it streamed it too). */
  report?: string[];
  /** The same in a line or two. */
  summary?: string[];
  /** Who or what stopped a stack that ended cleanly — "claude:… (tools/dev/dev stop)", "Ctrl+C", … */
  stoppedBy?: string;
  /** The stack's handle (`<app>@<offset>`). */
  key?: string;
  /** Set by serve-preflight: this run asked for a stack it cannot have here, and started none. */
  refused?: boolean;
}

const runDir = (root: string) => join(root, '.bespunky', 'run');
export const exitRecordPath = (root: string, invocation: string, app: string) => join(runDir(root), 'exits', `${invocation}@${app}.json`);
const followerPath = (root: string, invocation: string, app: string) => join(runDir(root), 'followers', `${invocation}@${app}.json`);

export const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
};

/** Atomic JSON write, so a reader never sees half a record. */
function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(`${file}.${process.pid}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.${process.pid}.tmp`, file);
}

export function readExit(file: string): ExitRecord | null {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as ExitRecord;
    return typeof record.code === 'number' ? record : null;
  } catch {
    return null;
  }
}

export function writeExit(root: string, invocation: string, app: string, record: ExitRecord): void {
  writeJson(exitRecordPath(root, invocation, app), { app, invocation, ...record, at: new Date().toISOString() });
}

export function clearExit(root: string, invocation: string, app: string): void {
  rmSync(exitRecordPath(root, invocation, app), { force: true });
}

/** A follower in `invocation` follows the stack whose engine is `enginePid`. Never removed by the follower (see below). */
export function registerFollower(root: string, invocation: string, app: string, enginePid: number): void {
  writeJson(followerPath(root, invocation, app), { invocation: Number(invocation), app, enginePid, pid: process.pid });
}

/**
 * The invocations still following the stack whose engine was `enginePid`. An entry counts while its INVOCATION lives —
 * not merely its follower task: the follower returns before its Nx has recorded the result, and the moment this
 * stack's own Nx drops the shared task, a still-recording Nx reads "the dependency ended under me" (see
 * executors/serve). Entries of dead invocations are pruned on the way.
 */
export function attachedFollowers(root: string, app: string, enginePid: number): number[] {
  const dir = join(runDir(root), 'followers');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(`@${app}.json`));
  } catch {
    return [];
  }
  const live: number[] = [];
  for (const f of files) {
    try {
      const entry = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { invocation: number; enginePid: number };
      if (!isAlive(entry.invocation)) rmSync(join(dir, f), { force: true });
      else if (entry.enginePid === enginePid) live.push(entry.invocation);
    } catch {
      /* mid-write — the next look sees it */
    }
  }
  return live;
}
