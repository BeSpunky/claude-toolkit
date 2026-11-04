// 0.52.0 — the node devcontainer feature moves from its major tag to an exact one.
//
// WHY A RUNG. Up to 0.51 the agent layer declared `node:1`, which moves within v1 with no commit behind it. The generator
// now declares `node:1.7.1`, but it leaves a feature declared under any tag alone (`featureIdentity`), so the old key
// would stay for good. The mechanics and who may be moved: `pinHouseFeature`. `:1` and `:1.7.1` were one manifest when this
// was written, so the rename installs nothing different. `overrideFeatureInstallOrder` names the feature with no tag, and
// is untouched. The `version` option stays: it is the project's own Node major.
//
// Values frozen, per the migrations rule: the digest is ghcr.io's manifest digest of 1.7.1, read 2026-11-04.
import type { Tree } from '@nx/devkit';
import { pinHouseFeature } from '../../generators/_utils/devcontainer-feature';

const ID = 'ghcr.io/devcontainers/features/node';
const DIGEST = 'sha256:8c0de46939b61958041700ee89e3493f3b2e4131a06dc46b4d9423427d06e5f6';

export default async function pinNodeFeature(tree: Tree): Promise<void> {
  pinHouseFeature(tree, {
    tag: '[0.52.0 pin-node-feature]',
    from: `${ID}:1`,
    to: `${ID}:1.7.1`,
    pin: { version: '1.7.1', resolved: `${ID}@${DIGEST}`, integrity: DIGEST },
  });
}
