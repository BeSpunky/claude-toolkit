// Saying something to WHOEVER RAN NX — not only to a task's log.
import { closeSync, constants, openSync, readFileSync, writeSync } from 'node:fs';
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
 * Say `message` to WHOEVER RAN NX, not only to this task's log. Some messages are addressed to the person (or agent)
 * at the command line — the preflight's "this run would only wait; here is the command you meant", the follower's
 * "the stack FAILED, and why" — and under the `summary` renderer a task's output never reaches them: they get
 * "✖ nx run <task>" and a file path. So when
 * Nx is going to hide it, the message is also written to the invoking nx process's own stderr: Nx names that process
 * to every task (NX_INVOCATION_ROOT_PID). When Nx shows task output itself, nothing extra is written (a raw write
 * would duplicate it, or tear a TUI). Best effort, Linux /proc: anywhere else the task log still holds it.
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
    writeSync(fd, `${message}\n`);
  } catch {
    /* no /proc, or the invoker's stderr cannot be reopened (a socket) — the task log still has it */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

