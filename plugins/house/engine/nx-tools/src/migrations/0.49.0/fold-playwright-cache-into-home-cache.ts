// 0.49.0 — the web layer's per-tool Playwright cache volume folds into ONE persisted ~/.cache (the agent layer's).
//
// WHY. `<folder>-playwright-cache` persisted only ~/.cache/ms-playwright; the shared browser's own runtime
// (~/.cache/bespunky/playwright-core@<v>) sat beside it, outside any volume, and was downloaded again on every
// rebuild — as was every other tool cache. The agent layer now persists ~/.cache whole (`<folder>-cache`), which
// covers both. The devcontainer merge never removes a key, so without this rung the old mount would stay, nested
// inside the new one: a second volume holding the same browsers, invisible to anything that reads ~/.cache.
//
// WHAT IT TAKES: that mount member, and the `//` line above it — WHOEVER wrote it. Not a guess about intent: this exact
// mount (a per-project volume named after the folder, at ~/.cache/ms-playwright) is SUPERSEDED by the persisted ~/.cache
// the agent layer now guarantees, so nothing can depend on it any more (the 0.43.0 precedent); left, it would sit
// nested inside the new volume, still in use, holding a second copy of the browsers. A mount at that path with any
// OTHER source (a volume deliberately shared between projects, say) is the project's design: kept and reported. What
// the rung CANNOT take is the Docker volume itself, which lives on the host: it is reported by name — a cache, so
// nothing is lost: the browsers download once into ~/.cache on the next create.
import { type Tree, logger } from '@nx/devkit';
import { findNodeAtLocation } from 'jsonc-parser';
import { removeMemberWithLeadingComment } from '../../generators/_utils/jsonc-remove-member';
import { parseJsoncStrict } from '../../generators/_utils/jsonc-strict';
import { basename } from 'node:path';
import { isPresent } from '../../layers/registry';

const TAG = '[0.49.0 fold-playwright-cache-into-home-cache]';
const DEVCONTAINER = '.devcontainer/devcontainer.json';
const OLD = /^source=\$\{localWorkspaceFolderBasename\}-playwright-cache,target=[^,]+\/\.cache\/ms-playwright,type=volume$/;

export default async function foldPlaywrightCacheIntoHomeCache(tree: Tree): Promise<void> {
  if (!tree.exists(DEVCONTAINER) || !isPresent(tree, 'agent')) return;
  const text = tree.read(DEVCONTAINER, 'utf8') ?? '';
  const root = parseJsoncStrict(text);
  const mounts = root && findNodeAtLocation(root, ['mounts']);
  if (!root || !mounts?.children) {
    if (!root && text.includes('-playwright-cache')) {
      logger.warn(`${TAG} Left in place — ${DEVCONTAINER} could not be parsed as JSONC. Remove its "-playwright-cache" mount by hand: ~/.cache is now one persisted volume.`);
    }
    return;
  }
  for (const other of mounts.children) {
    if (typeof other.value === 'string' && /target=[^,]+\/\.cache\/ms-playwright[,]/.test(`${other.value},`) && !OLD.test(other.value)) {
      logger.info(`${TAG} Left in place — the mount "${other.value}" in ${DEVCONTAINER} is the project's own design (not the per-project cache the house wrote). ~/.cache is now one persisted volume; this one stays nested inside it.`);
    }
  }
  const index = mounts.children.findIndex((item) => typeof item.value === 'string' && OLD.test(item.value));
  if (index === -1) return;
  const member = mounts.children[index].value as string;
  // Cut as TEXT (the member, its comma, the house's `//` line above it) — jsonc's own removal also took the comment
  // of the NEXT mount with it, which may be the project's.
  const next = removeMemberWithLeadingComment(text, mounts.children[index]);
  const after = parseJsoncStrict(next);
  if (!after || findNodeAtLocation(after, ['mounts'])?.children?.length !== mounts.children.length - 1) {
    logger.warn(`${TAG} Left in place — removing "${member}" from ${DEVCONTAINER} would not leave the file intact. Remove it by hand.`);
    return;
  }
  tree.write(DEVCONTAINER, next);
  logger.info(
    `${TAG} removed the mount "${member}" from ${DEVCONTAINER} — ~/.cache is now ONE persisted volume (<folder>-cache), ` +
      `which covers the Playwright browsers and the shared browser's runtime alike. The old Docker volume is now unused; ` +
      `remove it on the host when convenient: docker volume rm ${basename(tree.root) || '<folder>'}-playwright-cache ` +
      `(and the same for each git worktree folder this project was ever opened from — each has its own). A cache: the ` +
      `browsers download once into ~/.cache on the next create. Rebuild the container.`,
  );
}
