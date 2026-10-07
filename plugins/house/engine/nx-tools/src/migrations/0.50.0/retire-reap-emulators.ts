// 0.50.0 — retire tools/reap-emulators.sh: the emulator suite's stack CLAIM (tools/dev — one identity for everything
// that binds the project's ports) took over its job.
//
// WHAT IT WAS. The reaper ran before every suite start and decided, by `PPID == 1`, whether a process holding the
// suite's ports (or any emulator JVM in the container) was an orphan to kill or a live suite to refuse. It was one of
// three identity schemes for one thing (the dev engine's run record, a direct run's own state dir, and this), and the
// weakest: a JVM reparented to a subreaper instead of PID 1 was "owned" forever, and nothing tied what it killed to the
// stack that left it.
//
// WHAT REPLACES IT. Every suite now claims its block through the dev engine before anything starts — a serve for its
// whole stack, a direct run or a seed build for its own (`tools/dev/dev claim`). A block another stack holds is
// refused by name; one this stack's previous run is still saving on is waited for. What a suite starts lives in its
// keeper's process group, and the keeper ends that group itself when the suite is over (or past its deadline), so the
// orphans the reaper hunted are not left behind; a stack whose keeper was killed outright keeps its record (ORPHANED)
// and `tools/dev/dev stop` ends what it left. The generator no longer writes the file; this rung removes it.
//
// It was generator-OWNED (rewritten on every sync), so its content is the house's: it is deleted whatever it holds.
// A target or script of the project's own that still runs it is REPORTED (with where), not rewritten — what it should
// run instead depends on why it was called by hand.
//
// SELF-CONTAINED by the migration contract: the path is frozen here.
import { type Tree, getProjects, logger } from '@nx/devkit';

const TAG = '[migrate 0.50.0 retire-reap-emulators]';
const REAPER = 'tools/reap-emulators.sh';

/** Every string value under `value` that mentions the reaper, by dotted path. */
function mentions(value: unknown, at: string, out: string[]): string[] {
  if (typeof value === 'string') {
    if (value.includes('reap-emulators.sh')) out.push(at);
  } else if (Array.isArray(value)) value.forEach((v, i) => mentions(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) mentions(v, at ? `${at}.${k}` : k, out);
  return out;
}

export default function update(tree: Tree): void {
  if (!tree.exists(REAPER)) return;
  tree.delete(REAPER);
  logger.info(`${TAG} removed ${REAPER} — every emulator suite now claims its ports through the dev engine (tools/dev/dev claim).`);

  const callers: string[] = [];
  for (const [name, config] of getProjects(tree)) {
    for (const path of mentions(config.targets ?? {}, '', [])) callers.push(`${name}: targets.${path}`);
  }
  if (tree.exists('package.json')) {
    try {
      const scripts = (JSON.parse(tree.read('package.json', 'utf8') ?? '{}') as { scripts?: unknown }).scripts;
      for (const path of mentions(scripts ?? {}, '', [])) callers.push(`package.json: scripts.${path}`);
    } catch {
      /* unreadable package.json — nothing to report from it */
    }
  }
  for (const where of callers) {
    logger.warn(
      `${TAG} ${where} still runs ${REAPER}, which is gone. Run the suite through tools/emulators.sh (it claims its ports, ` +
        'and refuses a block another stack holds), and stop a leftover stack with tools/dev/dev stop.',
    );
  }
}
