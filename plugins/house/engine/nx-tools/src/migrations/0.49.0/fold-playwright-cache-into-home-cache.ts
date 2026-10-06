// 0.49.0 — the web layer's per-tool Playwright cache volume folds into ONE persisted ~/.cache (the agent layer's).
//
// WHY. `<folder>-playwright-cache` persisted only ~/.cache/ms-playwright; the shared browser's own runtime
// (~/.cache/bespunky/playwright-core@<v>) sat beside it, outside any volume, and was downloaded again on every
// rebuild — as was every other tool cache. The agent layer now persists ~/.cache whole (`<folder>-cache`), which
// covers both. The devcontainer merge never removes a key, so without this rung the old mount would stay, nested
// inside the new one: a second volume holding the same browsers, invisible to anything that reads ~/.cache.
//
// WHAT IT TAKES: that mount member — only where the HOUSE wrote it (`houseWrote`) — and the house's `//` line that
// explained it. A mount the project wrote stays and is reported. What it CANNOT take is the Docker volume itself,
// which lives on the host: it is reported by name (`docker volume rm <folder>-playwright-cache`) — a cache, so nothing
// is lost: the browsers download once into ~/.cache on the next create.
import { type Tree, logger } from '@nx/devkit';
import { findNodeAtLocation } from 'jsonc-parser';
import { removeMemberWithLeadingComment } from '../../generators/_utils/jsonc-remove-member';
import { parseJsoncStrict } from '../../generators/_utils/jsonc-strict';
import { houseWrote } from '../../generators/_utils/devcontainer-provenance';
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
  const index = mounts.children.findIndex((item) => typeof item.value === 'string' && OLD.test(item.value));
  if (index === -1) return;
  const member = mounts.children[index].value as string;
  if (!houseWrote(tree, { path: ['mounts'], member })) {
    logger.info(`${TAG} Left in place — the mount "${member}" in ${DEVCONTAINER} is not recorded as house-written. ~/.cache is now one persisted volume, which already covers ~/.cache/ms-playwright; remove it if nothing else of yours relies on it.`);
    return;
  }
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
      `remove it on the host when convenient: docker volume rm <this folder's name>-playwright-cache (a cache — the ` +
      `browsers download once into ~/.cache on the next create). Rebuild the container.`,
  );
}
