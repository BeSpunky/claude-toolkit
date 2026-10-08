// THE PROJECT-FACTS PROBE — what an upgrade cannot do, found BEFORE anything is written.
//
// house.sh's preflight runs this (cwd = the project) between its own checks and the single verdict. It reads the
// project as it is on disk — nothing installed yet, nothing written — and prints one refusal per line for the
// preflight to report: `<code>\t<text>` (newlines in the text escaped as `\n`, backslashes as `\\`, for printf %b).
// It answers with the SAME code the generators would later throw with — the payload's pure, import-free modules
// (Node's grammar, the @angular/fire judge, their projected tables), loaded here straight from the toolkit's source by
// Node's type stripping — so the probe and the generators cannot disagree; they used to, by the probe not existing:
// an `.nvmrc` the generators could not read, or an `add-layer firebase` on an Angular @angular/fire cannot follow, threw
// mid-generate, after the migrations had committed.
//
//   node house-probe.mts --ensure=<csv> --evident=<csv>      (Node 22.18+: type stripping)
import { existsSync, readFileSync } from 'node:fs';
import * as NODE_FACTS from './nx-tools/src/generators/_utils/node-facts.ts';
import { devcontainerNode, factsOf, imageGap, resolveProjectNode, stripJsonc } from './nx-tools/src/generators/_utils/node-spec.ts';
import * as FIREBASE_COMPAT from './nx-tools/src/generators/_utils/firebase-compat.ts';
import { coherentPair, firebaseToolsAdvice, majorOf, renderAdvice, tableOf } from './nx-tools/src/adapters/angular/angularfire-judge.ts';

const arg = (name: string) => (process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? '').split(',').filter(Boolean);
const layers = new Set([...arg('ensure'), ...arg('evident')]);
const read = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);
const json = (path: string): Record<string, any> | undefined => {
  try {
    const text = read(path);
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};
const versionsTs = read(new URL('./nx-tools/src/generators/_utils/versions.ts', import.meta.url).pathname) ?? '';
const constant = (name: string) => new RegExp(`${name} = '([^']+)'`).exec(versionsTs)?.[1] ?? '';

const refusals: Array<[string, string]> = [];
const refuse = (code: string, text: string) => refusals.push([code, `[preflight] ${code}: ${text}`]);

// The project's Node as this probe resolved it (and where from) — the Firebase judge never chooses a firebase it cannot install.
let projectNodeFact: { major: number; from: string } | null = null;

// ---- Node: the generators tag the image (and the functions runtime) with the project's major --------------------
if (layers.has('agent') || layers.has('node') || layers.has('firebase')) {
  const facts = factsOf(NODE_FACTS);
  const pkg = json('package.json') ?? {};
  const node = resolveProjectNode(
    {
      nvmrc: read('.nvmrc'),
      nodeVersion: read('.node-version'),
      volta: typeof pkg.volta?.node === 'string' ? pkg.volta.node : undefined,
      engines: typeof pkg.engines?.node === 'string' ? pkg.engines.node : undefined,
    },
    facts,
  );
  let major: number | undefined;
  if (node.state === 'unknown') {
    refuse(
      'node-version-unknown',
      `${node.from} names no Node the house can resolve: ${node.why}.\n           The house tags the devcontainer image ` +
        `and the Cloud Functions runtime with the project's Node major. Write one there — a version (22, 22.11.0, 22.x) or an ` +
        `alias nvm defines for everyone (lts/*, lts/<codename>, node) — then re-run.`,
    );
  } else if (node.state === 'declared') {
    major = node.major;
    projectNodeFact = { major, from: node.from };
  } else {
    const running = devcontainerNode(read, facts);
    if (running && 'unknown' in running) {
      refuse(
        'node-version-undeclared',
        `this project declares no Node version (.nvmrc, .node-version, package.json volta.node), and its devcontainer's ` +
          `Node cannot be read (${running.from}: ${running.unknown}).\n           The house will not guess it (the next upgrade ` +
          `would move your container): write the major it runs (\`node -v\` inside it) into .nvmrc, then re-run.`,
      );
    } else {
      major = running?.major ?? Number(constant('HOUSE_NODE_MAJOR'));
      projectNodeFact = { major, from: running ? `${running.from}, which .nvmrc will record` : 'the house default, which .nvmrc will record' };
    }
  }
  // The typescript-node image is tagged with it where the house's image is used: the node layer, on a devcontainer the
  // house owns or creates, or one already built from (or referencing) the house's image.
  const devcontainer = (() => {
    try {
      const text = read('.devcontainer/devcontainer.json');
      return text === undefined ? undefined : JSON.parse(stripJsonc(text));
    } catch {
      return {};
    }
  })();
  const owned = json('.devcontainer/.bespunky-devcontainer.json')?.owned === true;
  const housesImage =
    !devcontainer ||
    owned ||
    /house\.Dockerfile$/.test(String(devcontainer.build?.dockerfile ?? '')) ||
    (!devcontainer.build && !devcontainer.dockerFile && !devcontainer.dockerComposeFile && (!devcontainer.image || /\/typescript-node:/.test(String(devcontainer.image))));
  const gap = major !== undefined && layers.has('node') && housesImage ? imageGap(major, facts) : undefined;
  if (gap) refuse('node-image-missing', `the project's Node is ${major}, but ${gap}`);
}

// ---- Firebase on Angular: the client step pairs @angular/fire with the workspace's Angular ------------------------
if (layers.has('firebase') && layers.has('angular')) {
  const pkg = json('package.json') ?? {};
  const declared = (name: string): string | undefined => pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (declared('@angular/fire') === undefined) {
    const installed = json('node_modules/@angular/core/package.json')?.version;
    const range = declared('@angular/core')?.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    const version = typeof installed === 'string' ? installed : range ? `${range[1]}.${range[2] ?? 0}.${range[3] ?? 0}` : undefined;
    const table = tableOf(FIREBASE_COMPAT, constant('FIREBASE_TOOLS_VERSION'));
    const verdict = coherentPair(
      {
        angular: version ? { version, major: majorOf(version), from: typeof installed === 'string' ? 'installed' : 'declared' } : null,
        declared: { fire: undefined, firebase: declared('firebase') },
        installedFire: null,
        node: projectNodeFact,
        installedFirebase: null,
      },
      table,
    );
    // The firebase-tools peer only BLOCKS an npm install (yarn and pnpm warn, and the generator says so on every run).
    // npm unless the project says otherwise — Nx's own default when no lockfile names the package manager.
    const otherManager = ['yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'].some(existsSync) || /^(?:yarn|pnpm|bun)@/.test(String(pkg.packageManager ?? ''));
    const advice = 'refusal' in verdict ? verdict.refusal : otherManager ? undefined : firebaseToolsAdvice(verdict.pair, table, declared('firebase-tools'));
    if (advice) {
      refuse(
        'firebase-angular-unpaired',
        `the firebase layer's Angular client cannot be added coherently here:\n           ` +
          renderAdvice('', advice).trimStart().replace(/\n/g, '\n         '),
      );
    }
  }
}

for (const [code, text] of refusals) process.stdout.write(`${code}\t${text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}\n`);
