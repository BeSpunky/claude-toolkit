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
//
// WHAT STILL NAMES IT IS REPORTED — always, whether or not the file is still there (a project that deleted it by hand
// can still have a caller that now fails), and wherever it is: a git-grep-like walk over the workspace's text files
// (not gitignored; node_modules, .git, dist, .nx and binary files skipped), each hit by path and line — a project.json
// target, a nested package.json script, a CI workflow, a .vscode task, a shell script, a doc. Nothing is rewritten:
// what a caller should run instead depends on why it was called by hand. The house's OWN files that called it in 0.49
// (tools/emulators.sh, tools/seed/build-seeds.sh, the shared browser's comments) are not reported: the firebase and
// shared-browser workspace generators rewrite them later in this same upgrade, without the call.
//
// THE ONE JOB WITH NO SUCCESSOR. Besides guarding every start, the reaper killed emulator JVMs a PRE-0.50 stack left
// orphaned. The dev engine's claim knows only stacks that claimed through it, so a JVM the old scheme orphaned is
// invisible to it: it keeps holding its ports until the container restarts, and the first 0.50 suite refuses (or
// fails to bind) on them. Said once, as a warning, in every Firebase workspace this rung crosses — with what to do.
//
// SELF-CONTAINED by the migration contract: the paths are frozen here.
import { type Tree, logger, visitNotIgnoredFiles } from '@nx/devkit';

const TAG = '[migrate 0.50.0 retire-reap-emulators]';
const REAPER = 'tools/reap-emulators.sh';
const NEEDLE = 'reap-emulators.sh';
/** Directories never walked, wherever they sit: installs, git, build output, Nx's cache. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', '.nx']);
/** The house's own 0.49 files that named the reaper — rewritten without it by the workspace generators this upgrade. */
const OWNED_CALLERS = new Set(['tools/emulators.sh', 'tools/seed/build-seeds.sh', 'tools/shared-browser/shared-browser']);
/** Larger than any hand-written script or config; a file past it is generated data, not a caller. */
const MAX_BYTES = 2 * 1024 * 1024;

export default function update(tree: Tree): void {
  const hadReaper = tree.exists(REAPER);
  // The reaper only ever existed in a Firebase workspace; anywhere else a mention is not a caller of it.
  if (!hadReaper && !tree.exists('firebase.json')) return;

  if (hadReaper) {
    tree.delete(REAPER);
    logger.info(`${TAG} removed ${REAPER} — every emulator suite now claims its ports through the dev engine (tools/dev/dev claim).`);
  }

  for (const { path, lines } of callers(tree)) {
    logger.warn(
      `${TAG} ${path}:${lines.join(',')} still names ${REAPER}, which is gone — a call to it now fails. Run the suite ` +
        'through tools/emulators.sh (it claims its ports, and refuses a block another stack holds), and stop a ' +
        'leftover stack with tools/dev/dev stop.',
    );
  }

  logger.warn(
    `${TAG} Emulator processes started before this upgrade are not known to the dev engine, and nothing reaps them ` +
      'any more. Once, now: stop any emulator suite still running from before the upgrade, then look for leftovers ' +
      "(`pgrep -af 'cloud-firestore-emulator|cloud-storage-rules-runtime|firebase emulators|java'`) and stop them " +
      '(`kill <pid>`), or rebuild the container. Otherwise they keep the emulator ports and the first suite refuses them.',
  );
}

/** Every text file outside the skipped dirs that names the reaper, with the 1-based lines it does so on. */
function callers(tree: Tree): Array<{ path: string; lines: number[] }> {
  const found: Array<{ path: string; lines: number[] }> = [];
  const inspect = (path: string): void => {
    if (OWNED_CALLERS.has(path) || path.split('/').some((segment) => SKIPPED_DIRS.has(segment))) return;
    const content = tree.read(path);
    if (!content || content.length > MAX_BYTES || content.includes(0)) return; // empty, generated data, or binary
    const text = content.toString('utf8');
    if (!text.includes(NEEDLE)) return;
    const lines = text.split(/\r?\n/).flatMap((line, i) => (line.includes(NEEDLE) ? [i + 1] : []));
    found.push({ path, lines });
  };
  // The root's skipped dirs are pruned BEFORE the walk: visitNotIgnoredFiles honours .gitignore/.nxignore, but in a
  // workspace with neither it would descend into node_modules and .git. Deeper ones are gitignored in practice, and
  // filtered by path either way.
  for (const child of tree.children('')) {
    if (SKIPPED_DIRS.has(child)) continue;
    if (tree.isFile(child)) inspect(child);
    else visitNotIgnoredFiles(tree, child, inspect);
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}
