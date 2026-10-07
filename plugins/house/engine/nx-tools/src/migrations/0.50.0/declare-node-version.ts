// 0.50.0 — the project declares its Node major ONCE, in `.nvmrc`, seeded from the Node it already runs.
//
// WHY. Up to 0.49.x the devcontainer's Node major was not the project's at all: house.sh took it from the machine
// running the upgrade (`process.versions.node`), or, on the Docker fallback, from the newest typescript-node image
// published that day. So a teammate on Node 24 — or anyone on the Docker path — silently moved the whole team's
// container, and the Cloud Functions manifest hardcoded "22" beside it. From 0.50.0 the generators read `.nvmrc`
// (generators/_utils/node-version.ts), and seed it with the house default only where a project declares none.
//
// So this rung writes `.nvmrc` from the Node the project's devcontainer ALREADY RUNS — the house.Dockerfile's
// `FROM …typescript-node:<major>`, else devcontainer.json's typescript-node `image`, else its Node feature's `version`
// — so the next upgrade moves nothing. A project without a devcontainer Node (no agent layer) gets no file: nothing
// reads one there until a layer that needs it seeds it, saying so.
//
// WHAT IT NEVER DOES: overwrite a `.nvmrc` the project already has (it IS the declaration — but if it disagrees with
// the devcontainer, the next upgrade will move the container to it, so that is reported), or change the deployed
// functions runtime (a deploy decision — a disagreement with `engines.node` is reported).
import { type Tree, getProjects, logger } from '@nx/devkit';
import { getNodeValue } from 'jsonc-parser';
import { parseJsoncStrict } from '../../generators/_utils/jsonc-strict';

const TAG = '[0.50.0 declare-node-version]';
const NVMRC = '.nvmrc';
const DOCKERFILE = '.devcontainer/house.Dockerfile';
const DEVCONTAINER = '.devcontainer/devcontainer.json';
const TYPESCRIPT_NODE = /mcr\.microsoft\.com\/devcontainers\/typescript-node:(\d+)/;
const NODE_FEATURE = /^ghcr\.io\/devcontainers\/features\/node(?::\d+)?$/;

export default function declareNodeVersion(tree: Tree): void {
  const running = devcontainerNodeMajor(tree);
  const declared = tree.exists(NVMRC) ? /^v?(\d+)/.exec((tree.read(NVMRC, 'utf8') ?? '').trim())?.[1] : undefined;

  if (tree.exists(NVMRC)) {
    if (!declared) {
      logger.warn(
        `${TAG} ${NVMRC} says "${(tree.read(NVMRC, 'utf8') ?? '').trim()}", which names no Node major — the house now tags the ` +
          `devcontainer image${running ? ` (today Node ${running.major})` : ''} and the Cloud Functions runtime with it, so THIS upgrade ` +
          `will stop at the generators (after these migrations are committed). Write the major alone (e.g. "${running?.major ?? '24'}").`,
      );
    } else if (running && running.major !== declared) {
      logger.warn(
        `${TAG} ${NVMRC} declares Node ${declared}, but the devcontainer runs Node ${running.major} (${running.from}). ${NVMRC} is now the ` +
          `one source: this upgrade's generators move the container to Node ${declared} (it takes effect on the next rebuild). If ` +
          `${running.major} is right, write it into ${NVMRC} and re-run the upgrade.`,
      );
    }
  } else if (running) {
    tree.write(NVMRC, `${running.major}\n`);
    logger.info(
      `${TAG} wrote ${NVMRC} = ${running.major} — the Node this project's devcontainer already runs (${running.from}). It is now the ` +
        `project's ONE Node version: the devcontainer and the Cloud Functions runtime follow it, and no upgrade moves it. ` +
        `To change Node, edit ${NVMRC}, re-run the upgrade, rebuild the container.`,
    );
  }

  reportFunctionsRuntime(tree, declared ?? running?.major);
}

/** The Node major the devcontainer is built with, and where that was read. */
function devcontainerNodeMajor(tree: Tree): { major: string; from: string } | undefined {
  const from = TYPESCRIPT_NODE.exec(tree.exists(DOCKERFILE) ? (tree.read(DOCKERFILE, 'utf8') ?? '') : '')?.[1];
  if (from) return { major: from, from: `${DOCKERFILE} FROM typescript-node:${from}` };
  if (!tree.exists(DEVCONTAINER)) return undefined;
  const root = parseJsoncStrict(tree.read(DEVCONTAINER, 'utf8') ?? '');
  const json = (root ? getNodeValue(root) : undefined) as { image?: unknown; features?: Record<string, { version?: unknown }> } | undefined;
  const image = typeof json?.image === 'string' ? TYPESCRIPT_NODE.exec(json.image)?.[1] : undefined;
  if (image) return { major: image, from: `${DEVCONTAINER} image typescript-node:${image}` };
  for (const [id, options] of Object.entries(json?.features ?? {})) {
    const version = String(options?.version ?? '');
    if (NODE_FEATURE.test(id) && /^\d+$/.test(version)) return { major: version, from: `${DEVCONTAINER} Node feature version ${version}` };
  }
  return undefined;
}

/** Name a Cloud Functions runtime that disagrees with the project's Node — never rewrite it (a deploy decision). */
function reportFunctionsRuntime(tree: Tree, major: string | undefined): void {
  if (!major || !tree.exists('firebase.json')) return;
  const functions = [...getProjects(tree)].find(([name]) => name === 'functions')?.[1];
  const manifest = functions && `${functions.root}/package.json`;
  if (!manifest || !tree.exists(manifest)) return;
  let engines: unknown;
  try {
    engines = (JSON.parse(tree.read(manifest, 'utf8') ?? '') as { engines?: { node?: unknown } }).engines?.node;
  } catch {
    return;
  }
  if (engines === undefined || String(engines) === major) return;
  logger.warn(
    `${TAG} ${manifest} deploys Cloud Functions on Node "${engines}", but the project runs Node ${major}. Left as is — moving a ` +
      `deployed runtime is your call: set engines.node to "${major}" (if Cloud Functions offers it), or ${NVMRC} to ${engines}, so ` +
      `what you run locally is what is deployed.`,
  );
}
