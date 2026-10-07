// Saying something to WHOEVER RAN NX — not only to a task's log.
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, constants, fstatSync, openSync, readFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isatty } from 'node:tty';

/**
 * Does the invoking nx keep this task's output out of the terminal? Pure (exported for tests).
 *
 * Every Nx renderer prints a failed dependency's output — TUI, dynamic, static, static-failures-only, stream —
 * except `summary`, which names a log file instead ("full log: …"). Nx picks `summary` when it is named
 * (`--output-style=summary`, or NX_DEFAULT_OUTPUT_STYLE) and, unnamed, when it is driven by an AI agent and has no
 * terminal for the TUI. That last case is the common one: Claude running `nx serve`.
 */
export function nxHidesTaskOutput({ style, invokerIsTty, aiAgent }: { style?: string; invokerIsTty: boolean; aiAgent: boolean }): boolean {
  if (style) return style === 'summary';
  return aiAgent && !invokerIsTty;
}

/** The output style named to the invoking nx — its own argv, else NX_DEFAULT_OUTPUT_STYLE. Undefined when unnamed. */
function namedOutputStyle(pid: number): string | undefined {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    for (let i = 0; i < argv.length; i++) {
      const m = /^--output-?[sS]tyle(?:=(.*))?$/.exec(argv[i]);
      if (m) return m[1] ?? argv[i + 1];
    }
  } catch {
    /* not Linux, or gone */
  }
  return process.env.NX_DEFAULT_OUTPUT_STYLE || undefined;
}

/**
 * Would a write appended to the invoker's stderr be EATEN? Pure (exported for tests).
 *
 * `nx … > log 2>&1`: the shell opened the file WITHOUT O_APPEND, and Nx writes at its own file offset. A write from
 * here (a separate open, appending at the end) moves the end of the file but not Nx's offset, so Nx's next output —
 * its summary, always — is written OVER it: only the part of the message longer than the summary survived (DF2b: the
 * last 3 lines of the refusal). A pipe, a terminal and a `>>` file have no such offset to lose against.
 */
export function eatenByInvoker({ regularFile, invokerAppends }: { regularFile: boolean; invokerAppends: boolean }): boolean {
  return regularFile && !invokerAppends;
}

/** The O_APPEND bit of the invoker's own open of its stderr (`/proc/<pid>/fdinfo/2` flags, octal). */
function invokerAppends(pid: number): boolean {
  try {
    const flags = /^flags:\s*([0-7]+)/m.exec(readFileSync(`/proc/${pid}/fdinfo/2`, 'utf8'))?.[1];
    return flags !== undefined && (parseInt(flags, 8) & constants.O_APPEND) !== 0;
  } catch {
    return true; // unknown: write now, as before
  }
}

/** A process's kernel start time (with the PID, its identity). */
function processStart(pid: number): string {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? '';
  } catch {
    return '';
  }
}

/**
 * The POSTSCRIPT — the one place in a non-appending capture file Nx can never write over: after its last write. The
 * messages of one invocation are queued in order, and ONE detached helper (it outlives every task and Nx's tree kill)
 * holds the file open, waits for the invoking nx to exit, and appends them. A reader of the file after the run sees
 * them below Nx's summary; nothing is shown mid-run (the file is the run's record, not a terminal).
 */
function postscript(pid: number, fd: number, message: string): void {
  const start = processStart(pid);
  const queue = join(tmpdir(), `bespunky-nx-postscript-${pid}-${start}.txt`);
  appendFileSync(queue, `${message}\n`);
  try {
    closeSync(openSync(`${queue}.lock`, 'wx'));
  } catch {
    return; // the helper of this invocation is already waiting; it prints the whole queue
  }
  const helper = `
    const fs = require('fs');
    const [pid, start, queue] = process.argv.slice(1);
    const gone = () => {
      try {
        const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
        const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return f[0] === 'Z' || f[19] !== start;
      } catch { return true; }
    };
    const tick = () => {
      if (!gone()) return setTimeout(tick, 20);
      try { fs.writeSync(1, fs.readFileSync(queue)); } catch {}
      fs.rmSync(queue, { force: true });
      fs.rmSync(queue + '.lock', { force: true });
    };
    tick();
  `;
  spawn(process.execPath, ['-e', helper, String(pid), start, queue], { detached: true, stdio: ['ignore', fd, 'ignore'] }).unref();
}

/**
 * Say `message` to WHOEVER RAN NX, not only to this task's log. Some messages are addressed to the person (or agent)
 * at the command line — the preflight's "this run would only wait; here is the command you meant", the follower's
 * "the stack FAILED, and why" — and under the `summary` renderer a task's output never reaches them: they get
 * "✖ nx run <task>" and a file path. So when
 * Nx is going to hide it, the message is also written to the invoking nx process's own stderr: Nx names that process
 * to every task (NX_INVOCATION_ROOT_PID). When Nx shows task output itself, nothing extra is written (a raw write
 * would duplicate it, or tear a TUI). Into a capture file Nx would write over, it goes after Nx's last line (see
 * postscript). Best effort, Linux /proc: anywhere else the task log still holds it.
 */
export function tellInvoker(message: string): void {
  const pid = Number(process.env.NX_INVOCATION_ROOT_PID);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  let fd: number | undefined;
  try {
    // Append, never truncate: the invoker's stderr may be a file someone redirected it to.
    fd = openSync(`/proc/${pid}/fd/2`, constants.O_WRONLY | constants.O_APPEND);
    let aiAgent = false;
    try {
      // The very check Nx made when it picked its renderer (nx is always resolvable from where this executor runs).
      aiAgent = Boolean((require('nx/src/native') as { isAiAgent?: () => boolean }).isAiAgent?.());
    } catch {
      /* an Nx without it — then only a NAMED summary style is detected */
    }
    if (!nxHidesTaskOutput({ style: namedOutputStyle(pid), invokerIsTty: isatty(fd), aiAgent })) return;
    if (eatenByInvoker({ regularFile: fstatSync(fd).isFile(), invokerAppends: invokerAppends(pid) })) postscript(pid, fd, message);
    else writeSync(fd, `${message}\n`);
  } catch {
    /* no /proc, or the invoker's stderr cannot be reopened (a socket) — the task log still has it */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

