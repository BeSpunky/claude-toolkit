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
//   - firebase-tools@<FIREBASE_TOOLS_VERSION>'s own runtime table → the GA `nodejsNN` runtimes.
// And for the pinned GCLOUD_CLI_VERSION it projects the sha256 of Google's versioned archive per architecture
// (gcloud-archive.ts, with --write — the archives are downloaded and hashed), and CHECKS that the projection is for the
// pin and that both archives are still served.
//
// IT DRIFTS WITH UPSTREAM, BY DESIGN. Unlike playwright-deps (keyed to a pin), the check re-asks npm, so a new
// @angular/fire release (the day Angular 21 gets a stable one) makes it fail: that is the staleness alarm — re-run
// with --write, review the diff, and decide whether existing projects need a migration.
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

async function packument(name) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
  if (!response.ok) throw new Error(`npm registry: ${name} → HTTP ${response.status}`);
  return response.json();
}

async function angularFireRows() {
  const [fire, core] = await Promise.all([packument('@angular/fire'), packument('@angular/core')]);
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
    const firebaseTools = manifest.peerDependencies?.['firebase-tools'] ?? null;
    return {
      angularfire: version,
      firebase,
      angularCore,
      // The lowest Angular this @angular/fire accepts INSIDE the major (a peer like ^21.2.0 refuses 21.0.x).
      minAngular: semver.minVersion(semver.validRange(`(${angularCore}) >=${major}.0.0`) ?? angularCore).version,
      firebaseTools,
      // Does the house's pinned firebase-tools satisfy its (optional) peer? npm refuses the install when it does not.
      firebaseToolsOk: firebaseTools === null || semver.satisfies(FIREBASE_TOOLS, firebaseTools),
    };
  };
  const rows = {};
  for (let major = FIRST_MAJOR; major <= newestMajor; major += 1) {
    const stable = versions.find(([version, manifest]) => !semver.prerelease(version) && admits(manifest, major));
    const prerelease = versions.find(([version, manifest]) => semver.prerelease(version) && admits(manifest, major));
    rows[major] = stable ? { stable: row(stable, major), prerelease: null } : { stable: null, prerelease: prerelease ? row(prerelease, major) : null };
  }
  return { rows, newestMajor };
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

function render({ rows, newestMajor }, runtimes) {
  const literal = (row) => (row ? JSON.stringify(row, null, 2).replace(/\n/g, '\n    ') : 'null');
  return `// GENERATED by tools/firebase-compat/project.mjs from the npm registry — never hand-edit; re-run it with --write
// (CI fails when npm has moved on: a new @angular/fire, or FIREBASE_TOOLS_VERSION moved).
//
// Read by the Angular adapter's Firebase client (@angular/fire + firebase follow the INSTALLED Angular major) and the
// functions manifest (engines.node must be a live Cloud Functions runtime). See the script for the derivation.

/** One @angular/fire release, with what it requires. */
export interface AngularFireRelease {
  /** Exact: firebase below is THIS release's own range, so a floating @angular/fire would break the pairing. */
  angularfire: string;
  /** @angular/fire's own \`dependencies.firebase\` — the root declares exactly this, so the package manager keeps ONE SDK. */
  firebase: string;
  /** Its peer on @angular/core. */
  angularCore: string;
  /** The lowest @angular/core it accepts within the major. */
  minAngular: string;
  /** Its (optional) peer on firebase-tools, or null. */
  firebaseTools: string | null;
  /** Whether the house's pinned firebase-tools satisfies that peer (npm refuses the install when it does not). */
  firebaseToolsOk: boolean;
}

/** Per Angular major: the newest stable @angular/fire for it — or, when none exists, the newest prerelease (or null). */
export const ANGULARFIRE_BY_ANGULAR_MAJOR: Readonly<Record<number, { stable: AngularFireRelease | null; prerelease: AngularFireRelease | null }>> = {
${Object.entries(rows)
  .map(([major, { stable, prerelease }]) => `  ${major}: {\n    stable: ${literal(stable)},\n    prerelease: ${literal(prerelease)},\n  },`)
  .join('\n')}
};

/** The newest Angular major npm knew when this was projected — a newer one is a major this table has never seen. */
export const ANGULARFIRE_TABLE_NEWEST_ANGULAR = ${newestMajor};

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

const expected = render(await angularFireRows(), functionsRuntimes(FIREBASE_TOOLS));
if (process.argv.includes('--write')) {
  writeFileSync(OUT, expected);
  console.log(`wrote ${OUT} (firebase-tools@${FIREBASE_TOOLS})`);
} else if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== expected) {
  console.error(
    `DRIFT: ${OUT} is not what npm says today (a new @angular/fire, or FIREBASE_TOOLS_VERSION moved) — run: ` +
      `node tools/firebase-compat/project.mjs --write, review the diff, and decide whether existing projects need a migration.`,
  );
  process.exit(1);
} else {
  console.log(`ok: the Firebase compatibility table matches npm (firebase-tools@${FIREBASE_TOOLS}); google-cloud-cli ${GCLOUD}'s archives are projected and served`);
}
