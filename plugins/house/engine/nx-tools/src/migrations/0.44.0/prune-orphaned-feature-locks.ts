// 0.44.0 — devcontainer-lock.json stops pinning features devcontainer.json no longer declares.
//
// WHY. The lock (written by the devcontainer CLI on every build) pins each feature's resolved digest. 0.40.0 and
// 0.43.0 removed the claude-code feature from devcontainer.json but not from the lock, so the lock kept pinning a
// feature nothing declares; the next rebuild rewrote it and left every project with an uncommitted diff the upgrade
// should have made. Those rungs now remove the pin too (`removeFeature`); this one cleans up after the projects
// that already ran them.
//
// WHY IT IS SAFE TO PRUNE EVERY ORPHAN, NOT JUST CLAUDE-CODE'S. A pin whose feature devcontainer.json does not
// declare can be depended on by nothing — the CLI only reads pins for declared features and drops the rest on the
// next build. So the test that governs deletion ("might anything still depend on it?") answers no for every orphan,
// whoever's feature it was.
import { type Tree, logger } from '@nx/devkit';
import { DEVCONTAINER_LOCK, declaredFeatures, pruneLock } from '../../generators/_utils/devcontainer-feature';

const TAG = '[0.44.0 prune-orphaned-feature-locks]';

export default async function pruneOrphanedFeatureLocks(tree: Tree): Promise<void> {
  if (!tree.exists(DEVCONTAINER_LOCK)) return;
  const declared = declaredFeatures(tree);
  if (!declared) return; // no readable devcontainer.json: no way to tell an orphan from a pin in use
  const removed = pruneLock(tree, (id) => !declared.has(id));
  if (removed.length) {
    logger.info(
      `${TAG} ${DEVCONTAINER_LOCK}: removed the pin(s) for ${removed.map((id) => `"${id}"`).join(', ')} — ` +
        `devcontainer.json no longer declares them, so nothing reads them (the next build would drop them anyway).`,
    );
  }
}
