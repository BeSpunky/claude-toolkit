// 0.39.0 — the upgrade's transient lock is now `.bespunky-upgrade.lock/`: retarget the project's `.gitignore` line.
//
// WHY. The engine's `sync` command became `upgrade`, and the lock directory an upgrade holds inside the project
// was renamed with it (`.bespunky-sync.lock/` → `.bespunky-upgrade.lock/`). The `nx` layer's gitignore block names
// the lock, and the `gitignore` generator is APPEND-ONLY — it adds an entry it does not find and never removes one
// — so without this rung every existing project would carry the new line beside a dead one (and its heading)
// forever.
//
// HOW. A RENAME, IN PLACE. Every `.gitignore` line that ignores the old lock (any of the spellings a gitignore
// accepts for it: with or without a leading `/`, with or without the trailing `/`) is rewritten to the same
// spelling of the new name, and the house heading above the generator's block is reworded with it — so the
// generator, which runs after the ladder, finds the new entry already there and appends nothing. Where the new
// name is ALREADY ignored (a hand edit got there first), the old line is deleted instead, and the old house
// heading with it when nothing is left under it, so nothing is duplicated.
//
// THE OLD LOCK DIRECTORY, IF ONE IS STILL THERE: REPORTED, NEVER DELETED, AND ITS LINE KEPT. Only the toolkit
// creates it, but this rung cannot tell a crashed run's leftover from an older engine's upgrade that is still
// RUNNING (a live holder's pid is a fact about a process, not about the tree — and on the container path the
// process is not even in this pid namespace). Deleting it would pull the lock out from under that run; dropping
// its `.gitignore` line would let this ladder's own `git add -A` checkpoint commit it. So both stay, and the log
// says what to do once no older run holds it. (`house.sh` itself — which does own the lock protocol and can
// check the holder — takes over a DEAD legacy lock before the ladder runs, so under the engine this branch is
// reached only by a bare `nx migrate`.)
import { type Tree, logger } from '@nx/devkit';

const TAG = '[0.39.0 rename-upgrade-lock]';

const GITIGNORE = '.gitignore';
const OLD_NAME = '.bespunky-sync.lock';
const NEW_NAME = '.bespunky-upgrade.lock';
const OLD_HEADING = "# The house sync's transient lock (machine-local; never committed)";
const NEW_HEADING = "# The house upgrade's transient lock (machine-local; never committed)";

/** A line that ignores `name` and nothing else: `name`, `/name`, `name/`, `/name/` — what the line says, captured. */
const ignoring = (name: string) => new RegExp(`^(/?)${name.replace(/\./g, '\\.')}(/?)\\s*$`);
const OLD_LINE = ignoring(OLD_NAME);
const NEW_LINE = ignoring(NEW_NAME);

export default async function renameUpgradeLock(tree: Tree): Promise<void> {
  if (!tree.exists(GITIGNORE)) return;
  const text = tree.read(GITIGNORE, 'utf8') ?? '';
  const lines = text.split('\n');
  // The cheap gate, and the idempotence: once retargeted, no line ignores the old name.
  if (!lines.some((line) => OLD_LINE.test(line))) return;

  if (tree.exists(OLD_NAME) || tree.children(OLD_NAME).length > 0) {
    logger.warn(
      `${TAG} Left ${GITIGNORE}'s "${OLD_NAME}" line in place: a ${OLD_NAME}/ directory is still in the project. ` +
        `It is the lock an older toolkit's upgrade holds while it runs — or a crashed run's leftover; this ` +
        `migration cannot tell which, so it deletes neither the directory nor the line that keeps it out of git. ` +
        `Once no older upgrade is running, delete ${OLD_NAME}/ and that line by hand (the new lock, ${NEW_NAME}/, ` +
        `is ignored by its own line).`,
    );
    return;
  }

  const alreadyNew = lines.some((line) => NEW_LINE.test(line));
  const out: string[] = [];
  for (const line of lines) {
    const old = OLD_LINE.exec(line);
    if (!old) {
      out.push(line === OLD_HEADING && !alreadyNew ? NEW_HEADING : line);
      continue;
    }
    if (alreadyNew) {
      // The old house heading goes with its only entry; the blank line that separated the block goes too.
      if (out[out.length - 1] === OLD_HEADING) {
        out.pop();
        if (out[out.length - 1] === '') out.pop();
      }
      continue;
    }
    out.push(`${old[1]}${NEW_NAME}${old[2]}`);
  }

  tree.write(GITIGNORE, out.join('\n'));
  logger.info(
    alreadyNew
      ? `${TAG} Removed the "${OLD_NAME}" line from ${GITIGNORE} — "${NEW_NAME}" was already ignored there.`
      : `${TAG} Retargeted ${GITIGNORE}: "${OLD_NAME}" -> "${NEW_NAME}" (the upgrade's lock was renamed), in place.`,
  );
}
