// 0.50.0 — the Firebase CLI becomes the PROJECT's pinned devDependency; the image's unpinned copy goes.
//
// WHY. Up to 0.49.x the firebase layer installed the CLI as a devcontainer feature with no version
// (`ghcr.io/devcontainers-extra/features/firebase-cli`): whatever firebase-tools was newest on the day the image was
// built ran the emulators and the deploys — different on every machine, in CI, and after every rebuild — and nothing in
// the repo said which. From 0.50.0 the firebase layer declares `firebase-tools` as an exact devDependency (the house
// version below, frozen); `node_modules/.bin` is on PATH in the container (the node layer, which firebase requires) and
// for every Nx target (run-commands), so `firebase` resolves to the project's copy everywhere it is used.
//
// WHAT IT TAKES WITH IT. The feature, from devcontainer.json — where the HOUSE wrote it (an owned devcontainer, or the
// adopted merge's record says so: `houseWrote()`), with the `//` lines explaining it — and its pin in
// devcontainer-lock.json (the 0.44.0 lesson: a feature removed from one file and pinned in the other is half a job). A
// firebase-cli feature the project added itself may be what a script OUTSIDE the workspace relies on (no
// node_modules/.bin there), so it is left and reported: it is now a second, unpinned `firebase`, shadowed in the workspace.
//
// WHICH firebase-tools: 0.50.0's pin — unless the project's @angular/fire peers (optionally) a firebase-tools range the pin
// is outside of (@angular/fire 17–19 peer ^13): npm then refuses the install outright (ERESOLVE), so the rung declares the
// newest firebase-tools INSIDE that peer instead (from 0.50.0's frozen table) and says why, and how to get the house's.
//
// THE LOGIN SURVIVES: firebase-tools keeps it in ~/.config/configstore, the agent layer's persisted volume — the same
// file the feature's copy wrote, so nobody logs in again.
import { type Tree, logger } from '@nx/devkit';
import { retireHouseFeature } from '../../generators/_utils/devcontainer-feature';
import { placeDependency } from '../../generators/_utils/dependencies';
import { applyJsonChanges } from '../../generators/_utils/json-edits';
import { majorOf } from '../../adapters/angular/angularfire-judge';
import { ANGULARFIRE_TABLE_0_50_0 } from './firebase-compat-0.50.0';

const TAG = '[0.50.0 firebase-cli-from-package]';
const FEATURE = /^ghcr\.io\/devcontainers-extra\/features\/firebase-cli(?::[\w.-]+)?$/;
/** The house's firebase-tools as of 0.50.0 — frozen (the live pin moves on). */
const FIREBASE_TOOLS_AS_OF_0_50_0 = '15.32.1';

export default function firebaseCliFromPackage(tree: Tree): void {
  if (!tree.exists('firebase.json')) return; // the firebase layer's evidence
  const declared = declareFirebaseTools(tree);
  const removed = retireHouseFeature(tree, TAG, FEATURE, "an unpinned second Firebase CLI, superseded by the project's firebase-tools");
  if (declared || removed) {
    logger.info(
      `${TAG} the Firebase CLI is now this project's own firebase-tools${declared ? ` ${declared}` : ''}: INSTALL (yarn / npm / pnpm ` +
        `install)${removed ? ', then REBUILD the container' : ''} — \`firebase\` resolves to node_modules/.bin/firebase in the ` +
        `container and in every Nx target (outside the container: \`npx firebase …\`). Your \`firebase login\` is kept (~/.config).`,
    );
  }
}

/** Add the exact devDependency (or pin a `latest` one); returns the version written, or undefined. */
function declareFirebaseTools(tree: Tree): string | undefined {
  if (!tree.exists('package.json')) {
    logger.warn(`${TAG} no root package.json — firebase-tools cannot be declared; the firebase layer needs one (it requires the node layer).`);
    return undefined;
  }
  const text = tree.read('package.json', 'utf8') ?? '';
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(text);
  } catch {
    logger.warn(`${TAG} package.json is not valid JSON — firebase-tools not declared. Add "firebase-tools": "${FIREBASE_TOOLS_AS_OF_0_50_0}" to devDependencies.`);
    return undefined;
  }
  const block = (['dependencies', 'devDependencies'] as const).find((b) => pkg[b]?.['firebase-tools'] !== undefined);
  if (block && pkg[block]!['firebase-tools'] !== 'latest') return undefined; // the project's own pin
  let version = FIREBASE_TOOLS_AS_OF_0_50_0;
  const peer = angularFirePeer(tree, pkg);
  if (peer && peer.pin !== version) {
    version = peer.pin;
    logger.warn(
      `${TAG} @angular/fire ${peer.angularfire} peers firebase-tools "${peer.range}", which ${FIREBASE_TOOLS_AS_OF_0_50_0} (the house's) is ` +
        `outside of — npm would refuse the install (ERESOLVE). Declaring ${version}, the newest inside it. The house's emulator and ` +
        `deploy tooling is verified on ${FIREBASE_TOOLS_AS_OF_0_50_0}: moving to Angular 20+ (its @angular/fire accepts it) gets you there.`,
    );
  }
  if (block) {
    // A `latest` the project wrote: pin what it already runs, the 0.35.0 rule (nothing upgraded or downgraded).
    try {
      const installed = JSON.parse(tree.read('node_modules/firebase-tools/package.json', 'utf8') ?? '') as { version?: string };
      if (installed.version && /^\d+\.\d+\.\d+$/.test(installed.version)) version = installed.version;
    } catch {
      /* not installed — the house version */
    }
  }
  const target = block ?? 'devDependencies';
  pkg[target] = placeDependency(pkg[target], 'firebase-tools', version);
  // In place: only the entries that changed, in the file's own form (a new one at its sorted place).
  tree.write('package.json', applyJsonChanges(text, JSON.parse(text), pkg));
  logger.info(`${TAG} package.json ${target}["firebase-tools"] = "${version}"${block ? ' (was "latest")' : ''}.`);
  return version;
}

/**
 * The @angular/fire this project runs (installed, else declared exactly), when 0.50.0's table knows it and its
 * firebase-tools peer leads to a pin — what firebase-tools must satisfy.
 */
function angularFirePeer(
  tree: Tree,
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
): { angularfire: string; range: string; pin: string } | undefined {
  let version: string | undefined;
  try {
    version = (JSON.parse(tree.read('node_modules/@angular/fire/package.json', 'utf8') ?? '') as { version?: string }).version;
  } catch {
    version = (pkg.dependencies?.['@angular/fire'] ?? pkg.devDependencies?.['@angular/fire'])?.replace(/^[~^]/, '');
  }
  if (!version || !/^\d/.test(version)) return undefined;
  const row = ANGULARFIRE_TABLE_0_50_0.byMajor[majorOf(version)];
  const release = [row?.stable, row?.prerelease].find((r) => r?.angularfire === version);
  return release?.firebaseTools && release.firebaseToolsPin ? { angularfire: version, range: release.firebaseTools, pin: release.firebaseToolsPin } : undefined;
}
