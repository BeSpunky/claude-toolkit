// 0.50.0 — the Google Cloud CLI becomes a PINNED IMAGE PACKAGE; the unpinned feature goes.
//
// WHY. Up to 0.49.x the firebase layer installed gcloud with `ghcr.io/jajera/features/gcloud-cli`, which has no version
// option: it downloads whatever Google's rapid channel serves on the day the image is built — different on every
// machine and after every rebuild, and pinned by nothing in the repo (devcontainer-lock.json pins the FEATURE's script,
// not the CLI it fetches). From 0.50.0 the firebase layer contributes `google-cloud-cli=<version>` to the image's one
// cached package layer (.devcontainer/house.packages.sh), from Google's apt repository added the modern way
// (`signed-by=` keyring — no apt-key, which Debian 13 dropped). The generator writes that; this rung removes the old
// feature, which the devcontainer merge never would, and which would otherwise put a second, unpinned gcloud
// (/usr/local/bin) in front of the pinned one (/usr/bin).
//
// WHAT IT TAKES: the feature — with its `//` lines and its devcontainer-lock.json pin — where the house wrote it
// (`houseWrote`); a project-added one is reported. LOGINS SURVIVE: gcloud keeps them (and application-default
// credentials) in ~/.config/gcloud, the agent layer's persisted ~/.config, wherever the binary comes from.
import { type Tree, logger } from '@nx/devkit';
import { retireHouseFeature } from '../../generators/_utils/devcontainer-feature';

const TAG = '[0.50.0 gcloud-cli-from-image]';
const FEATURE = /^ghcr\.io\/jajera\/features\/gcloud-cli(?::[\w.-]+)?$/;

export default function gcloudCliFromImage(tree: Tree): void {
  if (!tree.exists('firebase.json')) return; // the firebase layer's evidence — the layer that brought the feature
  if (retireHouseFeature(tree, TAG, FEATURE, 'gcloud is now a pinned package in the image (.devcontainer/house.packages.sh)')) {
    logger.info(`${TAG} REBUILD the container to get the pinned gcloud. Your gcloud login is kept (~/.config/gcloud).`);
  }
}
