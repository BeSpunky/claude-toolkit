// THE PROJECT'S NODE MAJOR — declared ONCE, in the project, and read by everything that needs it.
//
// It used to be a fact about whoever ran the last upgrade: the devcontainer image tag came from the UPGRADING
// machine's Node (or, on house.sh's Docker fallback, the newest typescript-node image published that day), so the
// container's Node moved with the person, not with a commit — while the functions manifest hardcoded 22 beside it.
// A Node version is a REPO fact. So the house reads it where the project ALREADY declares it, in the files nvm, fnm,
// nodenv, `actions/setup-node` and Volta read — `.nvmrc`, else `.node-version`, else package.json `volta.node` —
// in their own grammar (`lts/*`, `lts/jod`, `22.x`, comments: ./node-spec.ts), and every house reader derives from
// it: the devcontainer composer (`{{nodeMajor}}`: the typescript-node image, the Node feature), the Cloud Functions
// manifest's `engines.node`, the docs. ONE SOURCE: the first of those the project has; the others (and `engines.node`,
// a range) are only checked against it, and a disagreement is named on every run — never a second file written.
//
// SEEDED ONCE, NEVER MOVED BY THE HOUSE. A project that declares none gets `.nvmrc` the first time a reader needs it:
// with the Node its devcontainer ALREADY runs when it has one (so no upgrade ever moves a running container to the
// house default), else HOUSE_NODE_MAJOR (./versions.ts) — a choice for a project with no Node yet, said out loud.
// A Node the house cannot resolve (a personal nvm alias, a devcontainer built from an unreadable base) is NEVER
// guessed: house.sh's probe refuses it before anything is written, and this throws as the backstop.
import { type Tree, logger } from '@nx/devkit';
import { HOUSE_NODE_MAJOR } from './versions';
import * as NODE_FACTS from './node-facts';
import {
  type NodeSources,
  type ProjectNode,
  NODE_SOURCE_FILES,
  devcontainerNode,
  factsOf,
  imageGap,
  resolveProjectNode,
} from './node-spec';

export const NODE_VERSION_FILE = NODE_SOURCE_FILES.nvmrc;
export const LIVE_NODE_FACTS = factsOf(NODE_FACTS);

/** What the project declares, from the tree. */
export function nodeSources(tree: Tree): NodeSources {
  const read = (path: string) => (tree.exists(path) ? tree.read(path, 'utf8') ?? '' : undefined);
  let pkg: { volta?: { node?: unknown }; engines?: { node?: unknown } } = {};
  try {
    pkg = JSON.parse(read('package.json') ?? '{}');
  } catch {
    /* an unreadable manifest declares nothing */
  }
  return {
    nvmrc: read(NODE_SOURCE_FILES.nvmrc),
    nodeVersion: read(NODE_SOURCE_FILES.nodeVersion),
    volta: typeof pkg.volta?.node === 'string' ? pkg.volta.node : undefined,
    engines: typeof pkg.engines?.node === 'string' ? pkg.engines.node : undefined,
  };
}

export function projectNode(tree: Tree): ProjectNode {
  return resolveProjectNode(nodeSources(tree), LIVE_NODE_FACTS);
}

/** The project's Node major — seeding `.nvmrc` when the project declares none (from its devcontainer's Node, else the house default). */
export function projectNodeMajor(tree: Tree): string {
  const node = projectNode(tree);
  if (node.state === 'unknown') {
    throw new Error(
      `${node.from} names no Node the house can resolve: ${node.why}. The house tags the devcontainer image and the ` +
        `Cloud Functions runtime with the project's Node major, so write one there (e.g. "${HOUSE_NODE_MAJOR}", or an ` +
        'alias nvm defines for everyone: lts/*, lts/<codename>, node) and re-run.',
    );
  }
  for (const line of node.disagreements) logger.warn(`[node] ${line} — make them agree (the house reads only the first).`);
  const major = node.state === 'declared' ? node.major : seed(tree);
  if (node.state === 'declared' && node.alias) {
    logger.info(
      `[node] ${node.from} says ${node.alias}: the devcontainer and the Cloud Functions runtime are built on Node ${major} — ` +
        'an alias moves when Node releases, the image tag only when this toolkit\'s table does. Write the major to choose it outright.',
    );
  }
  return String(major);
}

/**
 * Refuse a major the house's image cannot be built on — for a caller that TAGS mcr's typescript-node image with it
 * (published for even majors only), so `.nvmrc = 23` fails here, by name, instead of at image pull.
 */
export function assertNodeImage(tree: Tree, major: string): void {
  const gap = imageGap(Number(major), LIVE_NODE_FACTS);
  if (gap) throw new Error(`[node] ${nodeVersionFile(tree)} says Node ${major}, but ${gap}`);
}

/** The file the project's Node is declared in — what CI's setup-node `node-version-file` must read (it reads them all). */
export function nodeVersionFile(tree: Tree): string {
  const sources = nodeSources(tree);
  if (sources.nvmrc !== undefined || (sources.nodeVersion === undefined && sources.volta === undefined)) return NODE_VERSION_FILE;
  return sources.nodeVersion !== undefined ? NODE_SOURCE_FILES.nodeVersion : 'package.json';
}

/** Write `.nvmrc` for a project that declares no Node: the one its devcontainer runs, else the house default. */
function seed(tree: Tree): number {
  const running = devcontainerNode((path) => (tree.exists(path) ? tree.read(path, 'utf8') ?? '' : undefined), LIVE_NODE_FACTS);
  if (running && 'unknown' in running) {
    throw new Error(
      `This project declares no Node version, and its devcontainer's Node cannot be read (${running.from}: ${running.unknown}). ` +
        `The house will not guess it: write the major your container runs (\`node -v\` inside it) into ${NODE_VERSION_FILE}, and re-run.`,
    );
  }
  const major = running ? running.major : Number(HOUSE_NODE_MAJOR);
  tree.write(NODE_VERSION_FILE, `${major}\n`);
  logger.info(
    `[node] Seeded ${NODE_VERSION_FILE} with Node ${major} — ${running ? `the Node this project's devcontainer already runs (${running.from}${running.alias ? `: ${running.alias}` : ''})` : 'the house default for a project with no Node yet'}. ` +
      'It is now the project\'s ONE Node version (the devcontainer image and the Cloud Functions runtime follow it). ' +
      'It is yours: edit it and re-run the upgrade to move Node.',
  );
  return major;
}
