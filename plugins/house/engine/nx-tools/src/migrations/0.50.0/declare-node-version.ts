// 0.50.0 — the project declares its Node major ONCE, in `.nvmrc`, seeded from the Node it already runs.
//
// WHY. Up to 0.49.x the devcontainer's Node major was not the project's at all: house.sh took it from the machine
// running the upgrade (`process.versions.node`), or, on the Docker fallback, from the newest typescript-node image
// published that day. So a teammate on Node 24 — or anyone on the Docker path — silently moved the whole team's
// container, and the Cloud Functions manifest hardcoded "22" beside it. From 0.50.0 the generators read `.nvmrc`
// (generators/_utils/node-version.ts), and seed it with the house default only where a project declares none.
//
// So this rung writes `.nvmrc` from the Node the project's devcontainer ALREADY RUNS — its Node feature's `version`,
// else the image its `build.dockerfile` (house.Dockerfile or the project's own) builds FROM, else its `image` — read
// with the tag grammar the images actually use (`typescript-node:1-22-bookworm` is image 1, Node 22) and the aliases
// resolved (`lts` → the LTS major as of the facts below, said so) — so the next upgrade moves nothing. A project
// without a devcontainer Node gets no file: nothing reads one there until a layer that needs it seeds it, saying so.
// A devcontainer whose Node cannot be read is NEVER guessed (no file, reported; house.sh's probe refuses the run before
// this rung would meet it).
//
// WHAT IT NEVER DOES: write `.nvmrc` where the project already declares its Node (`.nvmrc`, `.node-version`, Volta —
// any of them IS the declaration; a disagreement with the devcontainer is reported), or change the deployed functions
// runtime (a deploy decision — a disagreement with `engines.node` is reported).
//
// FROZEN: the facts it resolves aliases with are 0.50.0's (a migration freezes the values it writes); the grammar is
// the shared mechanic (generators/_utils/node-spec.ts), the same one the generators and the probe read with.
import { type Tree, getProjects, logger } from '@nx/devkit';
import { type NodeFactsTable, devcontainerNode, resolveProjectNode } from '../../generators/_utils/node-spec';

const TAG = '[0.50.0 declare-node-version]';
const NVMRC = '.nvmrc';

/** The Node facts as of 0.50.0 (tools/node-facts/project.mjs, 2026-10-07) — frozen: the live table moves on. */
const NODE_FACTS_AS_OF_0_50_0: NodeFactsTable = {
  asOf: '2026-10-07',
  ltsCodenames: { argon: 4, boron: 6, carbon: 8, dubnium: 10, erbium: 12, fermium: 14, gallium: 16, hydrogen: 18, iron: 20, jod: 22, krypton: 24 },
  newestLtsMajor: 24,
  newestMajor: 26,
  imageMajors: [14, 16, 18, 20, 22, 24, 26],
};

export default function declareNodeVersion(tree: Tree): void {
  const read = (path: string) => (tree.exists(path) ? tree.read(path, 'utf8') ?? '' : undefined);
  const facts = NODE_FACTS_AS_OF_0_50_0;
  const running = devcontainerNode(read, facts);
  let pkg: { volta?: { node?: unknown }; engines?: { node?: unknown } } = {};
  try {
    pkg = JSON.parse(read('package.json') ?? '{}');
  } catch {
    /* an unreadable manifest declares nothing */
  }
  const declared = resolveProjectNode(
    {
      nvmrc: read(NVMRC),
      nodeVersion: read('.node-version'),
      volta: typeof pkg.volta?.node === 'string' ? pkg.volta.node : undefined,
      engines: typeof pkg.engines?.node === 'string' ? pkg.engines.node : undefined,
    },
    facts,
  );

  let major: number | undefined;
  if (declared.state === 'unknown') {
    logger.warn(`${TAG} ${declared.from} names no Node the house can resolve: ${declared.why}. Write a Node major (or lts/*, lts/<codename>) there.`);
  } else if (declared.state === 'declared') {
    major = declared.major;
    for (const line of declared.disagreements) logger.warn(`${TAG} ${line}.`);
    if (running && !('unknown' in running) && running.major !== major) {
      logger.warn(
        `${TAG} ${declared.from} declares Node ${major}, but the devcontainer runs Node ${running.major} (${running.from}). ${declared.from} is ` +
          `the one source: this upgrade's generators move the house-built container to Node ${major} (it takes effect on the next ` +
          `rebuild). If ${running.major} is right, write it there and re-run the upgrade.`,
      );
    }
  } else if (running && 'unknown' in running) {
    logger.warn(
      `${TAG} this project declares no Node version, and its devcontainer's Node cannot be read (${running.from}: ${running.unknown}). ` +
        `Nothing written — the house will not guess it. Write the major your container runs (\`node -v\` inside it) into ${NVMRC}.`,
    );
  } else if (running) {
    major = running.major;
    tree.write(NVMRC, `${running.major}\n`);
    logger.info(
      `${TAG} wrote ${NVMRC} = ${running.major} — the Node this project's devcontainer already runs (${running.from}` +
        `${running.alias ? `: ${running.alias} — an alias, now pinned` : ''}). It is now the project's ONE Node version: the devcontainer and ` +
        `the Cloud Functions runtime follow it, and no upgrade moves it. To change Node, edit ${NVMRC}, re-run the upgrade, rebuild the container.`,
    );
  }

  reportFunctionsRuntime(tree, major === undefined ? undefined : String(major));
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
