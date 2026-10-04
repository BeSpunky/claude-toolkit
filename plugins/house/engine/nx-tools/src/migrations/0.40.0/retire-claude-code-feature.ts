// 0.40.0 — Claude Code is installed ONCE, natively; the devcontainer feature that installed a second copy goes.
//
// WHY. Up to 0.39 the agent layer added `ghcr.io/devcontainers-extra/features/claude-code` to every house
// devcontainer. It installs Claude Code at build time into /usr/local/bin, which sits EARLY on PATH; `claude
// update` and the background auto-updater manage the native install in ~/.local/bin, which sits LATE. So every
// update landed in the shadowed copy, reported success, and changed nothing: each house container stayed frozen
// at its build-day Claude Code — the toolkit's mods (which need a newer build) silently never loaded. 0.40.0
// drops the feature, installs natively in post-create, and puts ~/.local/bin FIRST on PATH (composed from the
// layers' `path` entries into one `remoteEnv.PATH`).
//
// WHY A MIGRATION. The devcontainer generator's merge never removes a key it no longer renders — on owned and
// adopted devcontainers alike — so without this rung the feature (and its shadowing copy) would stay forever,
// and an adopted devcontainer would keep the old PATH (the merge keeps a project's value for a key both declare).
//
// WHAT IT DOES.
//   - The feature: removed from a devcontainer the house OWNS (marker `owned: true`), with the house comment
//     written above it. In an ADOPTED one the merge added it, but the project may since have come to rely on it,
//     so it is REPORTED, not removed — the new PATH makes it harmless either way (the native copy wins).
//   - `remoteEnv.PATH`: the one value the house ever wrote there (the node layer's) is retargeted in place, on
//     both paths, to the new composed value. Any other PATH is the project's own: reported, never edited.
import { type Tree, logger } from '@nx/devkit';
import { parseJsoncStrict } from '../../generators/_utils/jsonc-strict';
import { applyEdits, findNodeAtLocation, getNodeValue, modify } from 'jsonc-parser';
import { removeFeature } from '../../generators/_utils/devcontainer-feature';

const TAG = '[0.40.0 retire-claude-code-feature]';
const DEVCONTAINER = '.devcontainer/devcontainer.json';
const MARKER = '.devcontainer/.bespunky-devcontainer.json';

const FEATURE = 'ghcr.io/devcontainers-extra/features/claude-code';
/** The node layer's PATH — the only `remoteEnv.PATH` the house ever wrote (verified across the fragment's history). */
const OLD_HOUSE_PATH = '${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}';
const NEW_HOUSE_PATH = '${containerEnv:HOME}/.local/bin:${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}';

const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' };

export default async function retireClaudeCodeFeature(tree: Tree): Promise<void> {
  if (!tree.exists(DEVCONTAINER)) return;
  const original = tree.read(DEVCONTAINER, 'utf8') ?? '';
  if (!original.includes(FEATURE) && !original.includes(OLD_HOUSE_PATH)) return;

  const root = parseJsoncStrict(original);
  if (!root) {
    logger.warn(
      `${TAG} Left in place — ${DEVCONTAINER} could not be parsed as JSONC. Remove the "${FEATURE}" feature and ` +
        `put the remote user's ~/.local/bin first in remoteEnv.PATH, so \`claude update\` reaches the copy that runs.`,
    );
    return;
  }

  const owned = isOwned(tree);
  let text = original;

  const feature = findNodeAtLocation(root, ['features', FEATURE]);
  if (feature && owned) {
    // Through the shared removal, so its pin leaves devcontainer-lock.json too (this rung's first release forgot it).
    removeFeature(tree, FEATURE);
    text = tree.read(DEVCONTAINER, 'utf8') ?? text;
    logger.info(
      `${TAG} ${DEVCONTAINER}: removed the "${FEATURE}" feature (and its lock pin) — its build-time copy of Claude Code shadowed the ` +
        `one \`claude update\` keeps current. post-create.sh now installs Claude Code natively. Rebuild the container.`,
    );
  } else if (feature) {
    logger.warn(
      `${TAG} Left in place — ${DEVCONTAINER} is your devcontainer (adopted), so its "${FEATURE}" feature was not ` +
        `removed. It installs a second, build-time Claude Code; with ~/.local/bin first on PATH it no longer shadows ` +
        `the native copy, but it is now redundant (the house post-create installs Claude Code natively). Remove it to drop it.`,
    );
  }

  const pathNode = findNodeAtLocation(parseJsoncStrict(text)!, ['remoteEnv', 'PATH']);
  const pathValue = pathNode ? (getNodeValue(pathNode) as unknown) : undefined;
  if (pathValue === OLD_HOUSE_PATH) {
    text = applyEdits(text, modify(text, ['remoteEnv', 'PATH'], NEW_HOUSE_PATH, { formattingOptions: FORMAT }));
    logger.info(`${TAG} ${DEVCONTAINER}: remoteEnv.PATH now starts with \${containerEnv:HOME}/.local/bin (native Claude Code first).`);
  } else if (pathNode && typeof pathValue === 'string' && !pathValue.startsWith('${containerEnv:HOME}/.local/bin')) {
    logger.warn(
      `${TAG} Left in place — ${DEVCONTAINER} remoteEnv.PATH "${pathValue}" is not the value the house wrote, so it ` +
        `is yours and was not changed. Put the remote user's ~/.local/bin first in it, or \`claude update\` may ` +
        `update a copy of Claude Code that never runs.`,
    );
  }

  if (text !== original) tree.write(DEVCONTAINER, text);
}

/** The marker says who owns the devcontainer; no marker, or an unreadable one, is never ownership. */
function isOwned(tree: Tree): boolean {
  try {
    return JSON.parse(tree.read(MARKER, 'utf8') ?? '{}').owned === true;
  } catch {
    return false;
  }
}
