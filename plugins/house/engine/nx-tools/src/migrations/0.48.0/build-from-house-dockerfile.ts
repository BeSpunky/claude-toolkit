// 0.48.0 — a devcontainer the house wrote stops PULLING its image and BUILDS it from .devcontainer/house.Dockerfile.
//
// WHY. The OS packages used to be apt-installed by post-create on every container create, so every rebuild paid for
// them again. 0.48.0 builds the image from a generated Dockerfile (FROM the same image) whose package layer Docker
// caches; the devcontainer generator now composes `build` instead of `image`. But its merge never REMOVES a key —
// so without this rung a house-owned devcontainer.json would keep its old `image` next to the new `build`, two image
// sources in one file.
//
// WHAT IT TAKES: the `image` member (its comma and the `//` lines directly above it, which explained a key that is
// gone) — only where the HOUSE wrote it (`houseWrote`: the file is owned, or the adoption record says the house
// added exactly this). An adopted devcontainer's own `image` is the project's: left in place and reported — the
// generator then records `build` as skipped and prints the one-line switch. The generator, later in the same
// upgrade, adds `build` and writes house.Dockerfile, os-packages.sh and the seeded os-packages.txt.
import { type Tree, logger } from '@nx/devkit';
import { findNodeAtLocation } from 'jsonc-parser';
import { parseJsoncStrict } from '../../generators/_utils/jsonc-strict';
import { removeMemberWithLeadingComment } from '../../generators/_utils/jsonc-remove-member';
import { houseWrote } from '../../generators/_utils/devcontainer-provenance';
import { isPresent } from '../../layers/registry';

const TAG = '[0.48.0 build-from-house-dockerfile]';
const DEVCONTAINER = '.devcontainer/devcontainer.json';

export default async function buildFromHouseDockerfile(tree: Tree): Promise<void> {
  if (!tree.exists(DEVCONTAINER) || !isPresent(tree, 'agent')) return;
  const text = tree.read(DEVCONTAINER, 'utf8') ?? '';
  const root = parseJsoncStrict(text);
  if (!root) {
    logger.warn(
      `${TAG} Left in place — ${DEVCONTAINER} could not be parsed as JSONC. If the house wrote its "image", replace it ` +
        `with "build": { "dockerfile": "house.Dockerfile", "context": "." } by hand.`,
    );
    return;
  }
  const image = findNodeAtLocation(root, ['image']);
  if (!image) return;
  if (!houseWrote(tree, { path: ['image'], value: image.value })) {
    logger.info(
      `${TAG} Left in place — the "image" in ${DEVCONTAINER} is the project's own (the house did not write it). ` +
        `To build from the house's cached package layer instead, replace it with ` +
        `"build": { "dockerfile": "house.Dockerfile", "context": "." }.`,
    );
    return;
  }
  tree.write(DEVCONTAINER, removeMemberWithLeadingComment(text, image));
  logger.info(
    `${TAG} removed "image": "${image.value}" from ${DEVCONTAINER} — the container now builds from ` +
      `.devcontainer/house.Dockerfile (FROM the same image, the OS packages one cached layer), which the devcontainer ` +
      `generator writes in this same upgrade. Rebuild the container.`,
  );
}
