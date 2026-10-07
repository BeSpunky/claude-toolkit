// THE PROJECT'S NODE MAJOR — declared ONCE, in the project, and read by everything that needs it.
//
// It used to be a fact about whoever ran the last upgrade: the devcontainer image tag came from the UPGRADING
// machine's Node (or, on house.sh's Docker fallback, the newest typescript-node image published that day), so the
// container's Node moved with the person, not with a commit — while the functions manifest hardcoded 22 beside it.
// A Node version is a REPO fact. So the project declares it in `.nvmrc` at its root — the file nvm, fnm, volta-less
// setups, `actions/setup-node` (`node-version-file`) and editors already read — and every house reader derives from
// it: the devcontainer composer (`{{nodeMajor}}`: the typescript-node image, the Node feature), the Cloud Functions
// manifest's `engines.node`, the docs.
//
// SEEDED ONCE, NEVER MOVED BY THE HOUSE. A project without one gets HOUSE_NODE_MAJOR (./versions.ts) the first time a
// reader needs it (class C: written once, the project's thereafter). An upgrade never changes it; changing Node is
// the developer editing `.nvmrc` and re-running the upgrade. (0.50.0's migration seeded existing projects from the
// Node their devcontainer already ran, so nothing moved for them either.)
import { type Tree, logger } from '@nx/devkit';
import { HOUSE_NODE_MAJOR } from './versions';

export const NODE_VERSION_FILE = '.nvmrc';

/**
 * The major `.nvmrc` declares — `22`, `v22`, `22.11.0`, `v22.11.0` — or undefined when there is no file. An alias
 * (`lts/*`, `node`, `lts/jod`) names no major the image can be tagged with, so it is refused with what to write.
 */
export function declaredNodeMajor(tree: Tree): string | undefined {
  if (!tree.exists(NODE_VERSION_FILE)) return undefined;
  const text = (tree.read(NODE_VERSION_FILE, 'utf8') ?? '').trim();
  const major = /^v?(\d+)(?:\.\d+){0,2}$/.exec(text)?.[1];
  if (!major) {
    throw new Error(
      `${NODE_VERSION_FILE} says "${text}", which names no Node major. The house tags the devcontainer image and the ` +
        `Cloud Functions runtime with it, so it must be a version: write the major alone (e.g. "${HOUSE_NODE_MAJOR}") ` +
        `and re-run.`,
    );
  }
  return major;
}

/** The project's Node major — seeding `.nvmrc` with the house default when the project declares none. */
export function projectNodeMajor(tree: Tree): string {
  const declared = declaredNodeMajor(tree);
  if (declared) return declared;
  tree.write(NODE_VERSION_FILE, `${HOUSE_NODE_MAJOR}\n`);
  logger.info(
    `[node] Seeded ${NODE_VERSION_FILE} with Node ${HOUSE_NODE_MAJOR} — this project's ONE Node version (the devcontainer ` +
      `image and the Cloud Functions runtime follow it). It is yours: edit it and re-run the upgrade to move Node.`,
  );
  return HOUSE_NODE_MAJOR;
}
