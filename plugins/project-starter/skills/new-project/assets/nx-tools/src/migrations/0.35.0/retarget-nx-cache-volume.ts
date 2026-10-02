// 0.35.0 — the house's Nx volume moves from the whole `.nx/` folder to `.nx/cache` + `.nx/workspace-data`.
//
// WHY. Up to 0.34 every house devcontainer mounted a named volume over `${containerWorkspaceFolder}/.nx`, which
// was harmless while Nx always lived in node_modules: `.nx/` then held nothing but machine-local state. 0.35.0
// introduces the Nx WRAPPER host (`./nx`, `.nx/nxw.js` — the floor for a repo without a package.json, and kept
// by any repo that already runs it), and there `.nx/` carries the COMMITTED `nxw.js`. A volume over the folder
// hides it: inside the container `./nx` fails to start. The devcontainer generator therefore now contributes
// two exact volumes (from the `nx` layer's fragment) instead — right on both hosts.
//
// WHY A MIGRATION. The generator's merge is ADDITIVE on owned and adopted devcontainers alike: it adds the two
// new volumes and never removes the old one, so without this rung every existing project would carry the
// whole-folder volume forever, mounted over the new ones — still hiding `nxw.js` the day the repo moves to the
// wrapper. So the exact house mount is REPLACED IN PLACE by the two new ones (its position and any comment
// around it kept), which also leaves a bare `nx migrate` (no generators after it) with the final shape.
//
// WHAT IT LEAVES, AND SAYS SO. Only the exact house value is touched — that string is what the generator wrote
// on both paths, and the only spelling it has ever had. Any other mount targeting `.nx/` is the project's own:
// it is reported (with the consequence on the wrapper host), never edited. The old volume's DATA is not copied:
// it is a cache, rebuilt on the first `nx` run; the orphaned Docker volume (`<folder>-nx`) can be removed with
// `docker volume rm` and is named in the log.
import { type Tree, logger } from '@nx/devkit';
import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from 'jsonc-parser';

const TAG = '[0.35.0 retarget-nx-cache-volume]';
const DEVCONTAINER = '.devcontainer/devcontainer.json';

/** The one spelling the house ever wrote (verified across the template's full history). */
const HOUSE_NX_MOUNT = 'source=${localWorkspaceFolderBasename}-nx,target=${containerWorkspaceFolder}/.nx,type=volume';
const CACHE_MOUNT = 'source=${localWorkspaceFolderBasename}-nx-cache,target=${containerWorkspaceFolder}/.nx/cache,type=volume';
const DATA_MOUNT =
  'source=${localWorkspaceFolderBasename}-nx-workspace-data,target=${containerWorkspaceFolder}/.nx/workspace-data,type=volume';

const NX_TARGET = '${containerWorkspaceFolder}/.nx';
const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false };
const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' };

const targetOf = (mount: unknown) => (typeof mount === 'string' ? /(?:^|,)target=([^,]+)/.exec(mount)?.[1] : undefined);

export default async function retargetNxCacheVolume(tree: Tree): Promise<void> {
  if (!tree.exists(DEVCONTAINER)) return;
  const original = tree.read(DEVCONTAINER, 'utf8') ?? '';
  if (!original.includes(HOUSE_NX_MOUNT) && !original.includes(NX_TARGET)) return;

  if (!parseTree(original, [], PARSE_OPTIONS)) {
    logger.warn(
      `${TAG} Left in place — ${DEVCONTAINER} could not be parsed as JSONC, so its .nx volume was not retargeted. ` +
        `Replace a mount targeting \${containerWorkspaceFolder}/.nx with "${CACHE_MOUNT}" and "${DATA_MOUNT}".`,
    );
    return;
  }

  let text = original;
  const mountsNow = () => {
    const node = findNodeAtLocation(parseTree(text, [], PARSE_OPTIONS)!, ['mounts']);
    return node?.type === 'array' ? (node.children ?? []).map((child) => getNodeValue(child) as unknown) : [];
  };
  const hasTarget = (target: string) => mountsNow().some((mount) => targetOf(mount) === target);
  let replaced = false;

  for (;;) {
    const index = mountsNow().findIndex((mount) => mount === HOUSE_NX_MOUNT);
    if (index === -1) break;
    replaced = true;
    // In place: the old member's line, position and the comments around it stay; only the value changes.
    const next = !hasTarget(targetOf(CACHE_MOUNT)!) ? CACHE_MOUNT : !hasTarget(targetOf(DATA_MOUNT)!) ? DATA_MOUNT : undefined;
    text = applyEdits(text, modify(text, ['mounts', index], next, { formattingOptions: FORMAT }));
    if (next === CACHE_MOUNT && !hasTarget(targetOf(DATA_MOUNT)!)) {
      text = applyEdits(
        text,
        modify(text, ['mounts', index + 1], DATA_MOUNT, { formattingOptions: FORMAT, isArrayInsertion: true }),
      );
    }
  }

  if (text !== original) tree.write(DEVCONTAINER, text);
  if (replaced) {
    logger.info(
      `${TAG} ${DEVCONTAINER}: replaced the house volume over the whole .nx/ folder with .nx/cache + ` +
        `.nx/workspace-data volumes (a volume over .nx/ hides the Nx wrapper's committed nxw.js). Rebuild the ` +
        `container to apply it; the old Docker volume "<workspace folder>-nx" is now unused (docker volume rm).`,
    );
  }

  // Someone else's whole-folder .nx mount: theirs, so reported rather than removed.
  mountsNow().forEach((mount, index) => {
    if (targetOf(mount) === NX_TARGET) {
      logger.warn(
        `${TAG} Left in place — ${DEVCONTAINER} mounts[${index}] "${String(mount)}" mounts over the whole .nx/ ` +
          `folder but is not the value the house wrote, so it is yours and was not changed. On the Nx wrapper host ` +
          `it hides the committed .nx/nxw.js (./nx stops working in the container); the house now mounts ` +
          `.nx/cache and .nx/workspace-data instead.`,
      );
    }
  });
}
