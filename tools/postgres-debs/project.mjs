#!/usr/bin/env node
// Project the Postgres `.deb` closures the house can install — every file's URL and sha256, never typed by hand — into the
// payload (generators/_utils/postgres-closures.ts).
//
// WHY THE ARCHIVE: apt.postgresql.org's rolling index drops old builds, so a pin there expires. <codename>-pgdg-archive
// keeps every version. The same fact is what makes the selection matter: it holds prereleases too, and apt floats to them
// (libpq5 19~rc1 today).
//
// THE CHAIN OF TRUST, nothing else is read: the InRelease signature (gpg, PGDG's fingerprint checked) → the Packages
// sha256 it signs → each .deb's sha256, which the installer checks. Debian's indexes are read too, but only to ask
// whether `apt-get satisfy` could work: nothing is pinned from them, so TLS is enough there.
//
// IT DRIFTS WITH UPSTREAM, BY DESIGN: a new Postgres minor makes the check fail. That is the staleness alarm for a server
// whose minors are security releases — re-run with --write, review the diff, decide whether existing projects need a
// migration. It also HEADs every committed pin, because a pin that stops downloading fails consumers' cache-miss image
// builds, and a table frozen in their payload takes a release to repair. So it runs on a SCHEDULE and before every
// payload publish (.github/workflows/upstream-tables.yml, tools/publish-nx-tools/publish.sh), never per push.
//
//   node tools/postgres-debs/project.mjs [--check]   the generated file matches the archive today, and every pin downloads
//   node tools/postgres-debs/project.mjs --write     regenerate it
//
// Needs node, gpg, bzip2 and xz. Nothing downloaded is executed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClosure, debianSupplies, parsePackages, parseRelations, render, selectPackages, signedBy } from './closure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UTILS = join(ROOT, 'plugins/house/engine/nx-tools/src/generators/_utils');
const OUT = join(UTILS, 'postgres-closures.ts');
const VERSIONS = readFileSync(join(UTILS, 'versions.ts'), 'utf8');
const pinned = (name) => {
  const match = new RegExp(`${name} = \\[([^\\]]*)\\] as const`).exec(VERSIONS);
  if (!match) throw new Error(`${name} is not in versions.ts as a one-line list`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
};
const MAJORS = pinned('POSTGRES_MAJORS');
const CODENAMES = pinned('POSTGRES_DEB_CODENAMES');
const ARCHITECTURES = pinned('POSTGRES_DEB_ARCHITECTURES');
const EXTENSIONS = pinned('POSTGRES_EXTENSIONS');

const PGDG = 'https://apt-archive.postgresql.org/pub/repos/apt';
const PGDG_KEY_URL = 'https://www.postgresql.org/media/keys/ACCC4CF8.asc';
const PGDG_KEY_FINGERPRINT = 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8';
const DEBIAN_SUITES = (codename) => [
  ['https://deb.debian.org/debian', codename],
  ['https://deb.debian.org/debian', `${codename}-updates`],
  ['https://security.debian.org/debian-security', `${codename}-security`],
];

const fetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const unpack = (tool, bytes) => execFileSync(tool, ['-dc'], { input: bytes, maxBuffer: 1 << 30 }).toString();
const gpg = (home, args) => execFileSync('gpg', ['--homedir', home, '--batch', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

/** A private keyring holding PGDG's key, its fingerprint checked. The file may hold other keys, so `signedBy` holds each signature to that fingerprint. */
async function pgdgKeyring(home) {
  const key = join(home, 'pgdg.asc');
  writeFileSync(key, await fetchBytes(PGDG_KEY_URL));
  // gpg imports, then exits 2 when it cannot start its agent (a long socket path). A public import does not need it: the
  // fingerprint check below and the signature check after it are what count.
  try {
    gpg(home, ['--import', key]);
  } catch {}
  if (!gpg(home, ['--with-colons', '--fingerprint']).toString().includes(`:${PGDG_KEY_FINGERPRINT}:`)) throw new Error('the key served for PGDG does not have its fingerprint');
}

/** One architecture's archive index, from the signed InRelease down — refused at any break in the chain. */
async function archiveIndex(home, codename, arch) {
  const suite = `${PGDG}/dists/${codename}-pgdg-archive`;
  const signed = join(home, `${codename}-${arch}.InRelease`);
  const clear = `${signed}.clear`;
  writeFileSync(signed, await fetchBytes(`${suite}/InRelease`));
  // --decrypt on a clearsigned file writes only the text the signature covers, so nothing outside it can be read as signed.
  const status = gpg(home, ['--status-fd', '1', '--output', clear, '--decrypt', signed]).toString();
  if (!signedBy(status, PGDG_KEY_FINGERPRINT)) throw new Error(`no good signature by PGDG's key on ${suite}/InRelease`);
  const release = readFileSync(clear, 'utf8');
  const relative = `main/binary-${arch}/Packages.bz2`;
  const listed = new RegExp(`^ ([0-9a-f]{64})\\s+\\d+ ${relative.replace(/[.]/g, '\\.')}$`, 'm').exec(release.slice(release.indexOf('SHA256:')));
  if (!listed) throw new Error(`${relative} is not in ${suite}/InRelease`);
  const packed = await fetchBytes(`${suite}/${relative}`);
  if (createHash('sha256').update(packed).digest('hex') !== listed[1]) throw new Error(`${suite}/${relative} does not match the signed InRelease`);
  return parsePackages(unpack('bzip2', packed));
}

/** Could `apt-get satisfy` work on this codename × architecture? Refused now, rather than at a consumer's image build. */
async function assertDebianSupplies(codename, arch, systemDepends) {
  const indexes = await Promise.all(DEBIAN_SUITES(codename).map(async ([root, suite]) => parsePackages(unpack('xz', await fetchBytes(`${root}/dists/${suite}/main/binary-${arch}/Packages.xz`)))));
  const stanzas = indexes.flat();
  for (const clause of parseRelations(systemDepends)) {
    if (!clause.some((relation) => debianSupplies(stanzas, relation))) throw new Error(`${codename}/${arch}: Debian does not supply "${clause.map(({ name, op, want }) => `${name} ${op ?? ''} ${want ?? ''}`.trim()).join(' | ')}"`);
  }
}

async function project() {
  const home = mkdtempSync(join(tmpdir(), 'pg-'));
  try {
    await pgdgKeyring(home);
    const table = Object.fromEntries(MAJORS.map((major) => [major, {}]));
    for (const codename of CODENAMES) {
      const indexes = Object.fromEntries(await Promise.all(ARCHITECTURES.map(async (arch) => [arch, await archiveIndex(home, codename, arch)])));
      for (const major of MAJORS) {
        const perArch = Object.fromEntries(ARCHITECTURES.map((arch) => [arch, selectPackages(indexes[arch], major, EXTENSIONS)]));
        table[major][codename] = buildClosure(perArch, PGDG);
      }
      await Promise.all(ARCHITECTURES.map((arch) => assertDebianSupplies(codename, arch, MAJORS.map((major) => table[major][codename].systemDepends).join(', '))));
    }
    return table;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** HEAD every pin in the COMMITTED file, a few at a time: the promise consumers are holding, whatever upstream did since. */
async function goneFrom(text) {
  const urls = [...new Set([...text.matchAll(/url: '([^']+)'/g)].map(([, url]) => url))];
  const gone = [];
  for (let at = 0; at < urls.length; at += 8) {
    await Promise.all(
      urls.slice(at, at + 8).map(async (url) => {
        const response = await fetch(url, { method: 'HEAD' });
        if (!response.ok) gone.push(`${url} → HTTP ${response.status}`);
      }),
    );
  }
  return { checked: urls.length, gone };
}

const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
const previousDate = /POSTGRES_CLOSURES_AS_OF = '([^']+)'/.exec(previous)?.[1];
const table = await project();
// The date moves only when the data does: compared as of the recorded date, an unchanged archive is an unchanged file.
const unchanged = previousDate !== undefined && render(table, previousDate) === previous;
const expected = render(table, unchanged ? previousDate : new Date().toISOString().slice(0, 10));

if (process.argv.includes('--write')) {
  writeFileSync(OUT, expected);
  console.log(`${unchanged ? 'unchanged' : 'wrote'} ${OUT} (Postgres ${MAJORS.join(', ')} on ${CODENAMES.join(', ')})`);
} else {
  const { checked, gone } = await goneFrom(previous);
  if (gone.length) {
    console.error(`GONE, as of ${previousDate}'s table: ${gone.length} of ${checked} pinned files no longer download — consumers' cache-miss image builds fail on these. Run with --write and release:\n  ${gone.join('\n  ')}`);
    process.exit(1);
  }
  if (!unchanged) {
    console.error(`DRIFT: ${OUT} (as of ${previousDate ?? 'never'}) is not what the archive says today (a new Postgres or extension build, or a POSTGRES_* pin moved) — run: node tools/postgres-debs/project.mjs --write, review the diff, and decide whether existing projects need a migration.`);
    process.exit(1);
  }
  console.log(`ok: the Postgres closures match the archive as of ${previousDate}, and all ${checked} pinned files download`);
}
