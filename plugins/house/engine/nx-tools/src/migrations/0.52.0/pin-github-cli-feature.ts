// 0.52.0 — the github-cli devcontainer feature gets a version.
//
// WHY A RUNG. Up to 0.51 the agent layer declared the bare id, which means `latest`. The generator now declares
// `github-cli:1.1.3`, but its merge only adds keys: the old one would stay beside it, and the feature would install twice.
//
// WHAT IT TAKES: the bare key, where the house wrote it (`houseWrote`: an owned devcontainer, or the adopted merge's
// record). The key is renamed; its value and its `//` lines stay, so a project's option on an owned file survives. The
// lock pin moves with it, to the digest of the tag, so the next build leaves no uncommitted diff (0.44.0's lesson). A
// bare key the house did not write is the project's: reported, and the generator will not add a second one
// (`featureIdentity`). A key that already has a tag (`github-cli:1`) is pinned already, and left.
//
// Values frozen, per the migrations rule: the digest is ghcr.io's manifest digest of 1.1.3, read 2026-11-04.
import { type Tree, logger } from '@nx/devkit';
import { findNodeAtLocation, getNodeValue } from 'jsonc-parser';
import { DEVCONTAINER_JSON, DEVCONTAINER_LOCK, removeFeature, renameFeature } from '../../generators/_utils/devcontainer-feature';
import { houseWrote } from '../../generators/_utils/devcontainer-provenance';
import { parseJsoncStrict } from '../../generators/_utils/jsonc-strict';

const TAG = '[0.52.0 pin-github-cli-feature]';
const BARE = 'ghcr.io/devcontainers/features/github-cli';
const PINNED = `${BARE}:1.1.3`;
const DIGEST = 'sha256:bd7ab48a832228f633239277552c30b353867fef2e5b037e064b4e64f0b843f2';

export default async function pinGithubCliFeature(tree: Tree): Promise<void> {
  if (!tree.exists(DEVCONTAINER_JSON)) return;
  const text = tree.read(DEVCONTAINER_JSON, 'utf8') ?? '';
  const root = parseJsoncStrict(text);
  if (!root) {
    if (text.includes(`"${BARE}"`)) logger.warn(`${TAG} ${DEVCONTAINER_JSON} could not be read as JSONC. If it declares "${BARE}" with no tag, rename the key to "${PINNED}" and rebuild.`);
    return;
  }
  const node = findNodeAtLocation(root, ['features', BARE]);
  if (!node) return;

  if (!houseWrote(tree, { path: ['features', BARE], value: getNodeValue(node) })) {
    logger.warn(`${TAG} Left in place: "${BARE}" in ${DEVCONTAINER_JSON} was not written by the house. With no tag it means \`latest\`; to pin it, rename the key to "${PINNED}" and rebuild.`);
    return;
  }
  // Declared twice already: the tagged one is the pin, and the bare one can be depended on by nothing.
  if (findNodeAtLocation(root, ['features', PINNED])) {
    removeFeature(tree, BARE);
    logger.info(`${TAG} removed the bare "${BARE}" from ${DEVCONTAINER_JSON}: "${PINNED}" is already declared.`);
    return;
  }
  renameFeature(tree, BARE, PINNED, { version: '1.1.3', resolved: `${BARE}@${DIGEST}`, integrity: DIGEST });
  logger.info(`${TAG} ${DEVCONTAINER_JSON}: the github-cli feature is now pinned, "${PINNED}"${tree.exists(DEVCONTAINER_LOCK) ? `, and so is its pin in ${DEVCONTAINER_LOCK}` : ''}. The next rebuild installs that version.`);
}
