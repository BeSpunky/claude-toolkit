// DOES THIS WORKFLOW DEPLOY? — what keeps the house from writing a second deploy workflow, read from what it RUNS.
//
// The answer deletes the owned deploy.yml, so text is not enough: a workflow that says `firebase deploy` in an `echo`, a
// step name, an env value or a heredoc written to the job summary deploys nothing. Only the commands in a step's `run`
// count, and a command that only prints its arguments is not running them. It stays a reading of shell, not a shell:
// a deploy inside a quoted `$(...)` of an `echo` goes unseen, and an unknown command mentioning a signal counts, because
// taking a real pipeline for an unrelated one puts two deploys on one push, the worse of the two errors.
import { parse } from 'yaml';

/** Commands that only print what they are given. */
const PRINTS = new Set(['echo', 'printf', ':']);
/** Words that precede a command without being it. */
const SHELL_KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'while', 'until', 'do', '!', '{', '(', 'time']);
/** Commands that run the text a heredoc gives them, so its body is commands too. */
const RUNS_STDIN = /^(?:\S*\/)?(?:ba|da|z)?sh$/;

/** The word a simple command runs: past shell keywords and `NAME=value` prefixes. */
function commandWord(command: string): string {
  const words = command.trim().split(/\s+/);
  const at = words.findIndex((word) => !SHELL_KEYWORDS.has(word) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  return at < 0 ? '' : words[at];
}

/** One line of shell cut at its unquoted `;`, `&`, `|` and at a comment, so each part is one simple command. */
function simpleCommands(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === '\\' && quote === '"') current += char + (line[++i] ?? '');
      else {
        if (char === quote) quote = '';
        current += char;
      }
    } else if (char === '\\') {
      current += char + (line[++i] ?? '');
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      break;
    } else if (char === ';' || char === '&' || char === '|') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  return [...parts, current].filter((part) => part.trim());
}

/** The commands a `run` script executes: printing commands and heredocs fed to anything but a shell are left out. */
export function executedCommands(script: string): string[] {
  const lines = script.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  const commands: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = simpleCommands(lines[i]);
    commands.push(...parts.filter((part) => !PRINTS.has(commandWord(part))));
    const heredoc = /<<-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/.exec(lines[i].replace(/<<</g, ''));
    if (!heredoc || parts.some((part) => RUNS_STDIN.test(commandWord(part)))) continue;
    while (i + 1 < lines.length && lines[i + 1].trim() !== heredoc[1]) i++;
    i++;
  }
  return commands;
}

/** Every `run` script in a workflow's jobs. A file that does not parse runs nothing on GitHub either. */
function runScripts(workflow: string): string[] {
  let parsed: unknown;
  try {
    parsed = parse(workflow);
  } catch {
    return [];
  }
  const jobs = (parsed as { jobs?: unknown } | null)?.jobs;
  if (!jobs || typeof jobs !== 'object') return [];
  return Object.values(jobs).flatMap((job) => {
    const steps = (job as { steps?: unknown } | null)?.steps;
    if (!Array.isArray(steps)) return [];
    return steps.flatMap((step) => (typeof step?.run === 'string' ? [step.run as string] : []));
  });
}

/** Does this workflow run a command any of `signals` recognises as a deploy? */
export function workflowDeploys(workflow: string, signals: readonly RegExp[]): boolean {
  return runScripts(workflow).some((script) => executedCommands(script).some((command) => signals.some((signal) => signal.test(command))));
}
