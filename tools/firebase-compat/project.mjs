#!/usr/bin/env node
// Project what the house must KNOW about Firebase versions — never typed by hand — into the payload.
//
// WHY: three versions in a house Firebase app have hard relationships the house used to ignore by writing `latest`:
//   - `@angular/fire` peers ONE Angular major, so it must follow the workspace's installed Angular major — and for
//     some majors (Angular 21 and 22, as of 0.50.0) no stable @angular/fire exists at all;
//   - `firebase` is a DEPENDENCY of @angular/fire (not a peer), so the root `firebase` must be @angular/fire's own
//     declared range verbatim, or the package manager nests a second SDK under it ("No Firebase App '[DEFAULT]'");
//   - Cloud Functions runs only the Node majors the pinned firebase-tools declares as live runtimes.
// The source of truth for all three is npm itself, so it is projected from there:
//   - the @angular/fire packument → for every Angular major (17 … the newest @angular/core), the newest STABLE
//     @angular/fire whose peer admits it, with its firebase range; else the newest prerelease (named in the refusal
//     so a developer can choose it deliberately);
//   - firebase-tools@<FIREBASE_TOOLS_VERSION>'s own runtime table → the GA `nodejsNN` runtimes;
//   - for every firebase range a row names, and for what `firebase@latest` is today: the NODE that firebase needs — the
//     `engines.node` of its whole dependency closure, as the package manager resolves it (the newest release inside each
//     range). firebase itself declares no engines; its packages do (`@firebase/ai@3.0.0`: `>=24.12.0`, in firebase 13),
//     and yarn refuses the install on any other Node (npm and pnpm warn). So a firebase the project's Node cannot install is a fact
//     the table carries, and the judges never choose it (adapters/angular/angularfire-judge.ts).
// And for the pinned GCLOUD_CLI_VERSION it projects the sha256 of Google's versioned archive per architecture
// (gcloud-archive.ts, with --write — the archives are downloaded and hashed), and CHECKS that the projection is for the
// pin and that both archives are still served.
//
// IT DRIFTS WITH UPSTREAM, BY DESIGN. Unlike playwright-deps (keyed to a pin), the check re-asks npm, so a new
// @angular/fire release (the day Angular 21 gets a stable one) makes it fail: that is the staleness alarm — re-run
// with --write, review the diff, and decide whether existing projects need a migration. It runs on a SCHEDULE and
// before every payload publish (.github/workflows/upstream-tables.yml, tools/publish-nx-tools/publish.sh) — never in the
// per-push test job, where an upstream release would turn every unrelated PR red and stop the tests behind it.
//
//   node tools/firebase-compat/project.mjs           check: the generated file matches npm today
//   node tools/firebase-compat/project.mjs --write   regenerate it (needs the network)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const semver = createRequire(join(ROOT, 'package.json'))('semver');
const UTILS = join(ROOT, 'plugins/house/engine/nx-tools/src/generators/_utils');
const VERSIONS = readFileSync(join(UTILS, 'versions.ts'), 'utf8');
const FIREBASE_TOOLS = VERSIONS.match(/FIREBASE_TOOLS_VERSION = '([^']+)'/)[1];
const GCLOUD = VERSIONS.match(/GCLOUD_CLI_VERSION = '([^']+)'/)[1];
const OUT = join(UTILS, 'firebase-compat.ts');
/** The oldest Angular major the table covers: older majors' @angular/fire predates the modular API the house uses. */
const FIRST_MAJOR = 17;
/**
 * The Node majors a firebase's needs are judged against: from the oldest still in Cloud Functions' and the house
 * images' range to the newest Node there is (node-facts.ts — projected beside this, from nodejs.org).
 */
const FIRST_NODE_MAJOR = 18;
const NEWEST_NODE_MAJOR = Number(/NODE_NEWEST_MAJOR = (\d+)/.exec(readFileSync(join(UTILS, 'node-facts.ts'), 'utf8'))[1]);
const NODE_MAJORS = Array.from({ length: NEWEST_NODE_MAJOR - FIRST_NODE_MAJOR + 1 }, (_, i) => FIRST_NODE_MAJOR + i);

async function packument(name) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
  if (!response.ok) throw new Error(`npm registry: ${name} → HTTP ${response.status}`);
  return response.json();
}

/** npm's abbreviated packument (versions with dependencies and engines only) — one fetch per package per run. */
const abbreviated = new Map();
function installDocument(name) {
  if (!abbreviated.has(name)) {
    abbreviated.set(
      name,
      fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, { headers: { accept: 'application/vnd.npm.install-v1+json' } }).then(
        (response) => {
          if (!response.ok) throw new Error(`npm registry: ${name} → HTTP ${response.status}`);
          return response.json();
        },
      ),
    );
  }
  return abbreviated.get(name);
}

/** The release a package manager installs for `range`: `latest` when it satisfies, else the newest release inside. */
async function resolveRelease(name, range) {
  const doc = await installDocument(name);
  const latest = doc['dist-tags']?.latest;
  const version =
    range === 'latest' ? latest : latest && semver.satisfies(latest, range) ? latest : semver.maxSatisfying(Object.keys(doc.versions), range);
  if (!version) throw new Error(`npm registry: no ${name} release satisfies "${range}" — the projection's premise is gone`);
  return doc.versions[version];
}

/**
 * What `firebase@<range>` needs of Node: the release it resolves to, the Node majors its WHOLE dependency closure
 * accepts (every `engines.node`; yarn refuses an install outside one, npm and pnpm warn), and the constraints that exclude any
 * major in NODE_MAJORS (`>=24.12.0`, stated by `@firebase/ai@3.0.0`) — for the messages.
 */
const nodeNeeds = new Map();
function firebaseNodeNeed(range) {
  if (!nodeNeeds.has(range)) nodeNeeds.set(range, computeNodeNeed(range));
  return nodeNeeds.get(range);
}
async function computeNodeNeed(range) {
  const root = await resolveRelease('firebase', range);
  const seen = new Set();
  const constraints = [];
  let level = [root];
  while (level.length) {
    const next = [];
    for (const manifest of level) {
      const id = `${manifest.name}@${manifest.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const engine = manifest.engines?.node;
      if (typeof engine === 'string' && engine.trim()) {
        if (!semver.validRange(engine)) throw new Error(`${id}: engines.node "${engine}" is not a range semver reads — the projection's premise is gone`);
        constraints.push({ id, range: engine });
      }
      for (const [dep, depRange] of Object.entries(manifest.dependencies ?? {})) {
        if (!semver.validRange(depRange)) throw new Error(`${id}: dependency ${dep}@"${depRange}" is not a registry range — the projection's premise is gone`);
        next.push(resolveRelease(dep, depRange));
      }
    }
    level = await Promise.all(next);
  }
  const admits = (constraint, major) => semver.intersects(constraint.range, `>=${major}.0.0 <${major + 1}.0.0-0`);
  return {
    firebase: root.version,
    nodeMajors: NODE_MAJORS.filter((major) => constraints.every((c) => admits(c, major))),
    // Grouped by range: one entry per distinct requirement, with the majors it admits and the packages that state it.
    nodeNeeds: [...new Set(constraints.map((c) => c.range))]
      .map((range) => ({
        range,
        nodeMajors: NODE_MAJORS.filter((major) => admits({ range }, major)),
        packages: [...new Set(constraints.filter((c) => c.range === range).map((c) => c.id))].sort(),
      }))
      .filter((need) => need.nodeMajors.length < NODE_MAJORS.length)
      .sort((a, b) => (a.range < b.range ? -1 : a.range > b.range ? 1 : 0)),
  };
}

/**
 * The lowest version a peer range admits inside `major`. node-semver has no range intersection (and no parentheses),
 * so each `||` alternative is bounded to the major on its own and the lowest minimum wins — `^20.0.0 || ^21.2.0` gives
 * 21.2.0 for 21, not 20.0.0.
 */
function minWithinMajor(range, major) {
  const band = `>=${major}.0.0 <${major + 1}.0.0-0`;
  return new semver.Range(range).set
    .map((comparators) => comparators.map((c) => c.value).join(' ').trim() || '*')
    .filter((alternative) => semver.intersects(alternative, band))
    .map((alternative) => semver.minVersion(`${alternative} ${band}`)?.version)
    .filter(Boolean)
    .sort(semver.compare)[0];
}

/**
 * Per Angular major: the TypeScript its compiler accepts — the newest stable @angular/compiler-cli of the major peers a
 * range (`>=5.8 <6.0` for 20) — and the TypeScript the house declares for it (`~` the newest release inside). Needed
 * the day the house CREATES a workspace below Nx's newest Angular (the Firebase creation path): create-nx-workspace
 * installs Nx's newest TypeScript, which an older Angular compiler refuses ("requires TypeScript >=5.8.0 and <6.0.0").
 */
async function typescriptByMajor(newestMajor) {
  const [cli, ts] = await Promise.all([packument('@angular/compiler-cli'), packument('typescript')]);
  const releases = Object.keys(ts.versions).filter((v) => !semver.prerelease(v));
  const out = {};
  for (let major = FIRST_MAJOR; major <= newestMajor; major += 1) {
    const newest = Object.keys(cli.versions).filter((v) => !semver.prerelease(v) && semver.major(v) === major).sort(semver.rcompare)[0];
    const range = newest && cli.versions[newest].peerDependencies?.typescript;
    const pin = range && semver.maxSatisfying(releases, range);
    if (pin) out[major] = { range, pin: `~${pin}` };
  }
  return out;
}

async function angularFireRows() {
  const [fire, core, tools] = await Promise.all([packument('@angular/fire'), packument('@angular/core'), packument('firebase-tools')]);
  const toolsReleases = Object.entries(tools.versions)
    .filter(([version, manifest]) => !semver.prerelease(version) && !manifest.deprecated)
    .map(([version]) => version);
  const newestMajor = semver.major(core['dist-tags'].latest);
  const versions = Object.entries(fire.versions)
    // canary/exp builds are CI snapshots, never something to recommend; deprecated releases are withdrawn.
    .filter(([version, manifest]) => !/canary|exp/.test(version) && !manifest.deprecated)
    .sort(([a], [b]) => semver.rcompare(a, b));
  const admits = (manifest, major) => {
    const peer = manifest.peerDependencies?.['@angular/core'];
    return Boolean(peer) && semver.intersects(peer, `>=${major}.0.0-0 <${major + 1}.0.0-0`, { includePrerelease: true });
  };
  const row = ([version, manifest], major) => {
    const angularCore = manifest.peerDependencies['@angular/core'];
    const firebase = manifest.dependencies?.firebase;
    if (!firebase) throw new Error(`@angular/fire@${version} declares no firebase dependency — the projection's premise is gone`);
    // The judges read "the @angular/fire release line for Angular N" as "@angular/fire N.x" (they compare majors). A
    // release that peers two Angular majors (as AngularFire 7 did) breaks that silently — so it fails here instead.
    if (semver.major(version) !== major) {
      throw new Error(`@angular/fire@${version} is the release for Angular ${major}, but its major is not ${major} — the judges' premise (adapters/angular/angularfire-judge.ts) is gone`);
    }
    const firebaseTools = manifest.peerDependencies?.['firebase-tools'] ?? null;
    const minAngular = minWithinMajor(angularCore, major);
    if (!minAngular) throw new Error(`@angular/fire@${version}: its @angular/core peer "${angularCore}" admits no Angular ${major}`);
    return {
      angularfire: version,
      firebase,
      firebaseResolves: firebaseNodeNeed(firebase), // awaited below
      angularCore,
      // The lowest Angular this @angular/fire accepts INSIDE the major (a peer like ^21.2.0 refuses 21.0.x).
      minAngular,
      firebaseTools,
      // The firebase-tools a project with this release declares: the house pin when its (optional) peer admits it, else
      // the newest stable release inside the peer (npm refuses the install otherwise — ERESOLVE), else null (none).
      firebaseToolsPin: firebaseTools === null || semver.satisfies(FIREBASE_TOOLS, firebaseTools) ? FIREBASE_TOOLS : semver.maxSatisfying(toolsReleases, firebaseTools),
    };
  };
  const rows = {};
  for (let major = FIRST_MAJOR; major <= newestMajor; major += 1) {
    const stable = versions.find(([version, manifest]) => !semver.prerelease(version) && admits(manifest, major));
    const prerelease = versions.find(([version, manifest]) => semver.prerelease(version) && admits(manifest, major));
    rows[major] = stable ? { stable: row(stable, major), prerelease: null } : { stable: null, prerelease: prerelease ? row(prerelease, major) : null };
  }
  for (const release of Object.values(rows).flatMap(({ stable, prerelease }) => [stable, prerelease]).filter(Boolean)) {
    release.firebaseResolves = await release.firebaseResolves;
  }
  return { rows, newestMajor, typescript: await typescriptByMajor(newestMajor), byTag: { latest: await firebaseNodeNeed('latest') } };
}

function functionsRuntimes(version) {
  const dir = mkdtempSync(join(tmpdir(), 'firebase-tools-'));
  try {
    execFileSync('npm', ['pack', '--silent', `firebase-tools@${version}`], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
    execFileSync('tar', ['xzf', `firebase-tools-${version}.tgz`, 'package/lib/deploy/functions/runtimes/supported/types.js'], { cwd: dir });
    const source = readFileSync(join(dir, 'package/lib/deploy/functions/runtimes/supported/types.js'), 'utf8');
    // `nodejs22: { friendly: "Node.js 22", status: "GA", …}` — read as text, never evaluated (it is a downloaded file).
    const runtimes = [...source.matchAll(/nodejs(\d+):\s*\{[^}]*status:\s*"([A-Za-z]+)"/g)]
      .filter(([, , status]) => status === 'GA')
      .map(([, major]) => major);
    if (!runtimes.length) throw new Error(`firebase-tools@${version}: no GA nodejs runtime found — the projection's premise is gone`);
    return runtimes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function render({ rows, newestMajor, typescript, byTag }, runtimes, asOf) {
  // JSON, with a list of plain values (majors, package ids) kept on one line.
  const pretty = (value) =>
    JSON.stringify(value, null, 2).replace(/\[\s*([^[\]{}]*?)\s*\]/g, (_, items) => `[${items.split(/,\s*/).filter(Boolean).join(', ')}]`);
  const literal = (row) => (row ? pretty(row).replace(/\n/g, '\n    ') : 'null');
  return `// GENERATED by tools/firebase-compat/project.mjs from the npm registry — never hand-edit; re-run it with --write
// (the scheduled check fails when npm has moved on: a new @angular/fire or firebase, a new engines.node in firebase's
// dependency closure, or FIREBASE_TOOLS_VERSION moved).
//
// Read by the Angular adapter's Firebase client (@angular/fire + firebase follow the INSTALLED Angular major) and the
// functions manifest (engines.node must be a live Cloud Functions runtime). See the script for the derivation.
// Import-free on purpose: house.sh's probe loads it (with adapters/angular/angularfire-judge.ts) before any install.

/**
 * The date npm last said this — a project's installed toolkit carries a FROZEN copy, so every message that rests on
 * the table ("no stable @angular/fire for Angular 22") says "as of" this date, never "yet".
 */
export const ANGULARFIRE_TABLE_AS_OF = '${asOf}';

/**
 * What a firebase spec installs, and what that install needs of Node: the \`engines.node\` of firebase's WHOLE dependency
 * closure (firebase declares none itself; its packages do — and yarn refuses an install on any other Node; npm and pnpm warn).
 */
export interface FirebaseResolution {
  /** The firebase release the spec resolves to on npm (the newest inside the range; \`latest\`'s target). */
  firebase: string;
  /** The Node majors (${FIRST_NODE_MAJOR}–${NEWEST_NODE_MAJOR}) every package in that closure accepts. */
  nodeMajors: number[];
  /** Each distinct \`engines.node\` in the closure that excludes one of those majors: the majors it admits, who states it. */
  nodeNeeds: Array<{ range: string; nodeMajors: number[]; packages: string[] }>;
}

/** One @angular/fire release, with what it requires. */
export interface AngularFireRelease {
  /** Exact: firebase below is THIS release's own range, so a floating @angular/fire would break the pairing. */
  angularfire: string;
  /** @angular/fire's own \`dependencies.firebase\` — the root declares exactly this, so the package manager keeps ONE SDK. */
  firebase: string;
  /** What that range installs today, and the Node it needs — a release the project's Node cannot install is never chosen. */
  firebaseResolves: FirebaseResolution;
  /** Its peer on @angular/core. */
  angularCore: string;
  /** The lowest @angular/core it accepts within the major. */
  minAngular: string;
  /** Its (optional) peer on firebase-tools, or null. */
  firebaseTools: string | null;
  /**
   * The firebase-tools a project on this release declares: the house's pin when that peer admits it, else the newest
   * stable firebase-tools inside the peer (npm refuses the install otherwise — ERESOLVE), else null (none exists).
   */
  firebaseToolsPin: string | null;
}

/** Per Angular major: the newest stable @angular/fire for it — or, when none exists, the newest prerelease (or null). */
export const ANGULARFIRE_BY_ANGULAR_MAJOR: Readonly<Record<number, { stable: AngularFireRelease | null; prerelease: AngularFireRelease | null }>> = {
${Object.entries(rows)
  .map(([major, { stable, prerelease }]) => `  ${major}: {\n    stable: ${literal(stable)},\n    prerelease: ${literal(prerelease)},\n  },`)
  .join('\n')}
};

/** The newest Angular major npm knew when this was projected — a newer one is a major this table has never seen. */
export const ANGULARFIRE_TABLE_NEWEST_ANGULAR = ${newestMajor};

/**
 * What a firebase declared by npm dist-tag installed as of this table — and the Node it needs. A floating tag moves with
 * no commit behind it, so the house never writes one; this is what it says to a project that still declares one.
 */
export const FIREBASE_BY_DIST_TAG: Readonly<Record<string, FirebaseResolution>> = ${pretty(byTag).replace(/^  "([a-z]+)":/gm, '  $1:')};

/**
 * Per Angular major: the TypeScript range its newest compiler-cli peers, and the TypeScript the house declares when it
 * CREATES a workspace on that major (create-nx-workspace installs Nx's newest, which an older compiler refuses).
 */
export const ANGULAR_TYPESCRIPT_BY_MAJOR: Readonly<Record<number, { range: string; pin: string }>> = ${JSON.stringify(typescript, null, 2).replace(/"(\d+)":/g, '$1:')};

/** The firebase-tools these runtimes were read from (must equal FIREBASE_TOOLS_VERSION). */
export const FUNCTIONS_RUNTIMES_FROM_FIREBASE_TOOLS = '${FIREBASE_TOOLS}';
/** The Node majors Cloud Functions runs as GA runtimes, oldest first. */
export const FUNCTIONS_NODE_RUNTIMES: readonly string[] = [${runtimes.map((major) => `'${major}'`).join(', ')}];
`;
}

/**
 * gcloud: the pin (GCLOUD_CLI_VERSION) is a deliberate choice; what follows from it — each architecture's archive URL
 * and sha256 — is PROJECTED into gcloud-archive.ts, never typed. Google keeps every release in this archive (unlike its
 * apt index, a rolling window of about a year), so a pin does not expire. --write downloads both archives and hashes
 * them; the check is cheap: the projection is for the pin, and both URLs still answer.
 */
const GCLOUD_OUT = join(UTILS, 'gcloud-archive.ts');
const GCLOUD_ARCHES = { amd64: 'x86_64', arm64: 'arm' };
const gcloudUrl = (arch) =>
  `https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-${GCLOUD}-linux-${GCLOUD_ARCHES[arch]}.tar.gz`;

async function sha256Of(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  const hash = createHash('sha256');
  for await (const chunk of response.body) hash.update(chunk);
  return hash.digest('hex');
}

function renderGcloud(downloads) {
  return `// GENERATED by tools/firebase-compat/project.mjs from Google's versioned gcloud archive — never hand-edit; move
// GCLOUD_CLI_VERSION (versions.ts) and re-run it with --write.

/** The Google Cloud CLI archive per architecture, for GCLOUD_CLI_VERSION, with the sha256 the installer checks. */
export const GCLOUD_CLI_ARCHIVE = {
  version: '${GCLOUD}',
  downloads: {
${Object.entries(downloads).map(([arch, { url, sha256 }]) => `    ${arch}: {\n      url: '${url}',\n      sha256: '${sha256}',\n    },`).join('\n')}
  },
} as const;
`;
}

async function gcloudArchives() {
  if (process.argv.includes('--write')) {
    const downloads = {};
    for (const arch of Object.keys(GCLOUD_ARCHES)) downloads[arch] = { url: gcloudUrl(arch), sha256: await sha256Of(gcloudUrl(arch)) };
    writeFileSync(GCLOUD_OUT, renderGcloud(downloads));
    console.log(`wrote ${GCLOUD_OUT} (google-cloud-cli ${GCLOUD})`);
    return;
  }
  const projected = existsSync(GCLOUD_OUT) ? readFileSync(GCLOUD_OUT, 'utf8') : '';
  const stale = Object.keys(GCLOUD_ARCHES).filter((arch) => !projected.includes(`url: '${gcloudUrl(arch)}'`));
  if (!projected.includes(`version: '${GCLOUD}'`) || stale.length) {
    console.error(`STALE: ${GCLOUD_OUT} is not for google-cloud-cli ${GCLOUD} (GCLOUD_CLI_VERSION) — run: node tools/firebase-compat/project.mjs --write`);
    process.exit(1);
  }
  for (const arch of Object.keys(GCLOUD_ARCHES)) {
    const response = await fetch(gcloudUrl(arch), { method: 'HEAD' });
    if (!response.ok) {
      console.error(`GONE: ${gcloudUrl(arch)} → HTTP ${response.status} — Google no longer serves google-cloud-cli ${GCLOUD} for ${arch}; move GCLOUD_CLI_VERSION (versions.ts) and re-run with --write.`);
      process.exit(1);
    }
  }
}
await gcloudArchives();

const projection = [await angularFireRows(), functionsRuntimes(FIREBASE_TOOLS)];
const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
const previousDate = /ANGULARFIRE_TABLE_AS_OF = '([^']+)'/.exec(previous)?.[1];
// The date moves only when the data does: compared as of the recorded date, an unchanged npm is an unchanged file.
const unchanged = previousDate !== undefined && render(...projection, previousDate) === previous;
const expected = render(...projection, unchanged ? previousDate : new Date().toISOString().slice(0, 10));
if (process.argv.includes('--write')) {
  writeFileSync(OUT, expected);
  console.log(`${unchanged ? 'unchanged' : 'wrote'} ${OUT} (firebase-tools@${FIREBASE_TOOLS})`);
} else if (!unchanged) {
  console.error(
    `DRIFT: ${OUT} is not what npm says today (a new @angular/fire or firebase, a new Node requirement, or FIREBASE_TOOLS_VERSION moved) — run: ` +
      `node tools/firebase-compat/project.mjs --write, review the diff, and decide whether existing projects need a migration.`,
  );
  process.exit(1);
} else {
  console.log(`ok: the Firebase compatibility table matches npm (firebase-tools@${FIREBASE_TOOLS}); google-cloud-cli ${GCLOUD}'s archives are projected and served`);
}
