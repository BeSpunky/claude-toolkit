// 0.52.0 — the github-cli devcontainer feature gets a version.
//
// WHY A RUNG. Up to 0.51 the agent layer declared the bare id, which means `latest`, held only by a lock where one exists.
// The generator now declares `github-cli:1.1.3`, but it leaves a feature declared under any tag alone (`featureIdentity`),
// so the old key would stay, unpinned, for good. The mechanics and who may be moved: `pinHouseFeature`.
//
// Values frozen, per the migrations rule: the digest is ghcr.io's manifest digest of 1.1.3, read 2026-11-04.
import type { Tree } from '@nx/devkit';
import { pinHouseFeature } from '../../generators/_utils/devcontainer-feature';

const BARE = 'ghcr.io/devcontainers/features/github-cli';
const DIGEST = 'sha256:bd7ab48a832228f633239277552c30b353867fef2e5b037e064b4e64f0b843f2';

export default async function pinGithubCliFeature(tree: Tree): Promise<void> {
  pinHouseFeature(tree, {
    tag: '[0.52.0 pin-github-cli-feature]',
    from: BARE,
    to: `${BARE}:1.1.3`,
    pin: { version: '1.1.3', resolved: `${BARE}@${DIGEST}`, integrity: DIGEST },
  });
}
