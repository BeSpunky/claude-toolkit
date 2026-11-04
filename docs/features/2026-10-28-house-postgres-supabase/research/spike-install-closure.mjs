#!/usr/bin/env node
// SPIKE PROTOTYPE of the projection tool for the planned `postgres` house layer (see spike-install.md). Not shipped.
//
// Computes, FROM SIGNED INDEXES ONLY, the .deb closure of postgresql-NN + postgresql-NN-pgvector for each
// codename x arch x major: which packages are pinned from apt-archive.postgresql.org (<codename>-pgdg-archive) and which
// resolve from Debian. Chain of trust: InRelease signature (gpg, private home) -> Packages sha256 -> .deb sha256.
//
//   node spike-install-closure.mjs --state <dir> [--codenames trixie,bookworm] [--archs amd64,arm64] [--majors 18,17]
//                                  [--download amd64] [--status <dpkg status file>]
//
// Writes <state>/closure.json. With --download <arch>, fetches that arch's closure into <state>/dl/<sha256>.deb, refuses
// any file whose size or sha256 differs from the index, and links them as <state>/debs/<codename>-<arch>-pg<NN>/{pgdg,debian}/.
// Node built-ins plus the system's curl, gpg, bzip2, xz. All downloads are treated as data; nothing downloaded is executed.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const STATE = arg('state');
if (!STATE) throw new Error('--state <dir> is required');
const CODENAMES = arg('codenames', 'trixie,bookworm').split(',');
const ARCHS = arg('archs', 'amd64,arm64').split(',');
const MAJORS = arg('majors', '18,17').split(',');
const DOWNLOAD_ARCH = arg('download');
const STATUS_FILE = arg('status');

const PGDG_ROOT = 'https://apt-archive.postgresql.org/pub/repos/apt';
const PGDG_KEY_URL = 'https://www.postgresql.org/media/keys/ACCC4CF8.asc';
const PGDG_KEY_FPR = 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8';

const debianSources = (codename) => [
  { id: `${codename}`, root: 'https://deb.debian.org/debian', suite: codename },
  { id: `${codename}-updates`, root: 'https://deb.debian.org/debian', suite: `${codename}-updates` },
  { id: `${codename}-security`, root: 'https://security.debian.org/debian-security', suite: `${codename}-security` },
];

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const curl = (url, out) => sh('curl', ['-fsSL', '--retry', '3', '--retry-delay', '3', '-o', out, url]);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// --- dpkg version ordering (Debian Policy 5.6.12) ---
const order = (c) => (c === '~' ? -1 : c === undefined || c === '' ? 0 : /[A-Za-z]/.test(c) ? c.charCodeAt(0) : c.charCodeAt(0) + 256);
function cmpPart(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    while ((i < a.length && !/\d/.test(a[i])) || (j < b.length && !/\d/.test(b[j]))) {
      const d = order(/\d/.test(a[i] ?? '') ? '' : a[i]) - order(/\d/.test(b[j] ?? '') ? '' : b[j]);
      if (d) return d;
      if (i < a.length && !/\d/.test(a[i])) i++;
      if (j < b.length && !/\d/.test(b[j])) j++;
    }
    let x = '';
    let y = '';
    while (/\d/.test(a[i] ?? '')) x += a[i++];
    while (/\d/.test(b[j] ?? '')) y += b[j++];
    const d = Number(x || 0) - Number(y || 0);
    if (d) return d;
  }
  return 0;
}
function split(v) {
  const c = v.indexOf(':');
  const e = c < 0 ? 0 : Number(v.slice(0, c));
  const rest = c < 0 ? v : v.slice(c + 1);
  const h = rest.lastIndexOf('-');
  return [e, h < 0 ? rest : rest.slice(0, h), h < 0 ? '' : rest.slice(h + 1)];
}
export function cmpVersion(a, b) {
  const [ea, ua, ra] = split(a);
  const [eb, ub, rb] = split(b);
  return ea - eb || cmpPart(ua, ub) || cmpPart(ra, rb);
}
const satisfies = (v, op, want) => {
  if (!op) return true;
  const c = cmpVersion(v, want);
  return { '=': c === 0, '>=': c >= 0, '<=': c <= 0, '>>': c > 0, '<<': c < 0 }[op];
};

// --- indexes ---
// gpg imports the key and then exits 2 when it cannot start gpg-agent (its socket path is too long under a deep state
// dir). A public-key import does not need the agent: what counts is the fingerprint check and GOODSIG afterwards.
function importKeys(home, file) {
  try {
    sh('gpg', ['--homedir', home, '--batch', '--import', file]);
  } catch {}
}

function gnupgHome() {
  const home = join(STATE, 'gnupg');
  if (existsSync(join(home, '.ready'))) return home;
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const key = join(home, 'pgdg.asc');
  curl(PGDG_KEY_URL, key);
  importKeys(home, key);
  const fprs = sh('gpg', ['--homedir', home, '--batch', '--with-colons', '--fingerprint']).toString();
  if (!fprs.includes(`:${PGDG_KEY_FPR}:`)) throw new Error('PGDG key fingerprint mismatch');
  for (const ring of ['debian-archive-bookworm-stable', 'debian-archive-bookworm-automatic', 'debian-archive-bookworm-security-automatic',
    'debian-archive-trixie-stable', 'debian-archive-trixie-automatic', 'debian-archive-trixie-security-automatic']) {
    const f = `/usr/share/keyrings/${ring}.pgp`;
    if (existsSync(f)) importKeys(home, f);
  }
  writeFileSync(join(home, '.ready'), '');
  return home;
}

/** Fetch InRelease, require a good signature, fetch the arch's Packages by its signed sha256, parse it. */
function loadIndex({ id, root, suite, component = 'main', compression }, arch) {
  const dir = join(STATE, 'idx', `${id}-${arch}`);
  mkdirSync(dir, { recursive: true });
  const release = join(dir, 'InRelease');
  if (!existsSync(release)) curl(`${root}/dists/${suite}/InRelease`, release);
  const home = gnupgHome();
  let status = '';
  try {
    status = sh('gpg', ['--homedir', home, '--batch', '--status-fd', '1', '--verify', release]).toString();
  } catch (e) {
    status = e.stdout?.toString() ?? '';
  }
  if (!/^\[GNUPG:\] GOODSIG/m.test(status)) throw new Error(`no good signature on ${root}/dists/${suite}/InRelease`);
  const text = readFileSync(release, 'utf8');
  const date = /^Date: (.*)$/m.exec(text)?.[1];
  const body = text.slice(text.indexOf('SHA256:'));
  const relative = `${component}/binary-${arch}/Packages.${compression}`;
  const m = new RegExp(`^ ([0-9a-f]{64})\\s+(\\d+) ${relative.replace(/[.+]/g, '\\$&')}$`, 'm').exec(body);
  if (!m) throw new Error(`${relative} not in ${suite} InRelease`);
  const packed = join(dir, `Packages.${compression}`);
  if (!existsSync(packed) || sha256(packed) !== m[1]) curl(`${root}/dists/${suite}/${relative}`, packed);
  if (sha256(packed) !== m[1]) throw new Error(`${relative}: sha256 differs from signed InRelease`);
  const plain = sh(compression === 'bz2' ? 'bzip2' : 'xz', ['-dc', packed]).toString();
  const stanzas = [];
  for (const block of plain.split('\n\n')) {
    if (!block.trim()) continue;
    const f = {};
    for (const line of block.split('\n')) {
      const k = /^([A-Za-z0-9-]+): (.*)$/.exec(line);
      if (k) f[k[1]] = k[2];
    }
    stanzas.push({
      name: f.Package, version: f.Version, arch: f.Architecture, source: f.Source ?? f.Package,
      depends: [f['Pre-Depends'], f.Depends].filter(Boolean).join(', '), recommends: f.Recommends ?? '', provides: f.Provides ?? '',
      conflicts: f.Conflicts ?? '', breaks: f.Breaks ?? '',
      essential: f.Essential === 'yes', priority: f.Priority, filename: f.Filename, size: Number(f.Size), installedKb: Number(f['Installed-Size'] ?? 0),
      sha256: f.SHA256, url: `${root}/${f.Filename}`, from: id,
    });
  }
  return { id, date, stanzas };
}

function indexBy(stanzas) {
  const byName = new Map();
  const providers = new Map();
  for (const s of stanzas) {
    (byName.get(s.name) ?? byName.set(s.name, []).get(s.name)).push(s);
    for (const p of s.provides.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [, n, , ver] = /^([^\s(:]+)(:\S+)?(?:\s*\(=\s*([^)]+)\))?/.exec(p);
      (providers.get(n) ?? providers.set(n, []).get(n)).push({ s, ver });
    }
  }
  return { byName, providers };
}

const parseDeps = (text) =>
  text.split(',').map((x) => x.trim()).filter(Boolean).map((clause) =>
    clause.split('|').map((alt) => {
      const m = /^([^\s(:]+)(?::\S+)?(?:\s*\(\s*(<<|<=|=|>=|>>)\s*([^)\s]+)\s*\))?/.exec(alt.trim());
      return { name: m[1], op: m[2], want: m[3] };
    }));

const stable = (s) => !s.version.includes('~');
const newest = (list) => [...list].sort((a, b) => cmpVersion(b.version, a.version))[0];

// --- the policy under test ---
/** The packages that are pinned, and from where: the Postgres family, PGDG archive only, never a prerelease. */
const isFamily = (name, major) =>
  ['libpq5', 'postgresql-common', 'postgresql-client-common', 'postgresql-common-dev'].includes(name) ||
  name === `postgresql-${major}` || name === `postgresql-client-${major}` || name === `postgresql-${major}-pgvector`;

function pickFamily(pgdg, name, major) {
  let list = (pgdg.byName.get(name) ?? []).filter(stable);
  // libpq5 is built by whichever major is newest in a suite, so it must be tied to the major being installed.
  if (name === 'libpq5') list = list.filter((s) => split(s.version)[1].split('.')[0] === major);
  return newest(list);
}

function resolve(pgdg, debian, major) {
  const chosen = new Map();
  const problems = [];
  const prereleasesAvoided = [];
  const queue = [`postgresql-${major}`, `postgresql-${major}-pgvector`, 'libpq5', 'postgresql-common', 'postgresql-client-common', `postgresql-client-${major}`]
    .map((name) => [{ name }]);

  const candidate = ({ name, op, want }) => {
    if (isFamily(name, major)) {
      const s = pickFamily(pgdg, name, major);
      const newestAny = newest(pgdg.byName.get(name) ?? []);
      if (newestAny && !stable(newestAny)) prereleasesAvoided.push(`${name} ${newestAny.version}`);
      return s && satisfies(s.version, op, want) ? s : undefined;
    }
    const real = (debian.byName.get(name) ?? []).filter((s) => satisfies(s.version, op, want));
    if (real.length) return newest(real);
    const virtual = (debian.providers.get(name) ?? []).filter((p) => !op || (p.ver && satisfies(p.ver, op, want))).map((p) => p.s);
    if (virtual.length) return newest(virtual);
    const fromPgdg = (pgdg.byName.get(name) ?? []).filter((s) => stable(s) && satisfies(s.version, op, want));
    return fromPgdg.length ? newest(fromPgdg) : undefined;
  };

  while (queue.length) {
    const alternatives = queue.shift();
    // An alternative already chosen satisfies the clause without adding anything.
    const done = alternatives.some((a) => {
      const hit = chosen.get(a.name);
      if (hit && satisfies(hit.version, a.op, a.want)) return true;
      return [...chosen.values()].some((c) => !a.op && c.provides.split(',').some((p) => p.trim().split(/[\s(:]/)[0] === a.name));
    });
    if (done) continue;
    let s;
    for (const a of alternatives) if ((s = candidate(a))) break;
    if (!s) {
      problems.push(`unsatisfiable: ${alternatives.map((a) => `${a.name} ${a.op ?? ''} ${a.want ?? ''}`.trim()).join(' | ')}`);
      continue;
    }
    if (chosen.has(s.name)) {
      problems.push(`version clash on ${s.name}: ${chosen.get(s.name).version} vs ${s.version}`);
      continue;
    }
    chosen.set(s.name, s);
    queue.push(...parseDeps(s.depends));
  }
  return { chosen, problems, prereleasesAvoided: [...new Set(prereleasesAvoided)] };
}

const installedOnSystem = (() => {
  if (!STATUS_FILE) return null;
  const names = new Set();
  for (const block of readFileSync(STATUS_FILE, 'utf8').split('\n\n')) {
    if (/^Status: .* installed$/m.test(block)) names.add(/^Package: (.*)$/m.exec(block)?.[1]);
  }
  return names;
})();

const pickFields = (s) => ({ name: s.name, version: s.version, arch: s.arch, source: s.source, from: s.from, size: s.size, installedKb: s.installedKb, sha256: s.sha256, url: s.url, priority: s.priority, essential: s.essential });
const sum = (list, key) => list.reduce((a, s) => a + s[key], 0);
const mb = (b) => `${(b / 1048576).toFixed(1)}MB`;

function download(s, codename, arch, major) {
  const dl = join(STATE, 'dl');
  mkdirSync(dl, { recursive: true });
  const target = join(dl, `${s.sha256}.deb`);
  if (!existsSync(target)) {
    const part = `${target}.part`;
    curl(s.url, part);
    const got = sha256(part);
    if (statSync(part).size !== s.size || got !== s.sha256) {
      rmSync(part);
      throw new Error(`REFUSED ${s.url}: index sha256 ${s.sha256}, got ${got}`);
    }
    renameSync(part, target);
  }
  const side = s.from.endsWith('-archive') ? 'pgdg' : 'debian';
  const dir = join(STATE, 'debs', `${codename}-${arch}-pg${major}`, side);
  mkdirSync(dir, { recursive: true });
  const link = join(dir, `${s.name}_${s.version.replace(/:/g, '%3a')}_${s.arch}.deb`);
  if (!existsSync(link)) linkSync(target, link);
}

const report = [];
for (const codename of CODENAMES) {
  for (const arch of ARCHS) {
    const pgdgIndex = loadIndex({ id: `${codename}-pgdg-archive`, root: PGDG_ROOT, suite: `${codename}-pgdg-archive`, compression: 'bz2' }, arch);
    const debianIndexes = debianSources(codename).map((src) => loadIndex({ ...src, compression: 'xz' }, arch));
    const pgdg = indexBy(pgdgIndex.stanzas);
    const debian = indexBy(debianIndexes.flatMap((i) => i.stanzas));
    for (const major of MAJORS) {
      const { chosen, problems, prereleasesAvoided } = resolve(pgdg, debian, major);
      const all = [...chosen.values()];
      const pins = all.filter((s) => s.from.endsWith('-archive'));
      const deb = all.filter((s) => !s.from.endsWith('-archive'));
      const floor = deb.filter((s) => s.essential || s.priority === 'required');
      const beyondFloor = deb.filter((s) => !floor.includes(s));
      const notHere = installedOnSystem ? beyondFloor.filter((s) => !installedOnSystem.has(s.name)) : null;
      report.push({
        codename, arch, major, indexDate: pgdgIndex.date, problems, prereleasesAvoided,
        pgdg: pins.map(pickFields), debianBeyondFloor: beyondFloor.map(pickFields), debianFloor: floor.map(pickFields),
        totals: {
          pgdg: { count: pins.length, size: sum(pins, 'size'), installedKb: sum(pins, 'installedKb') },
          debianBeyondFloor: { count: beyondFloor.length, size: sum(beyondFloor, 'size'), installedKb: sum(beyondFloor, 'installedKb') },
          debianFloor: { count: floor.length, size: sum(floor, 'size') },
          ...(notHere ? { debianNotOnThisSystem: { count: notHere.length, size: sum(notHere, 'size'), names: notHere.map((s) => s.name) } } : {}),
        },
      });
      console.log(`${codename}/${arch}/pg${major}: PGDG ${pins.length} (${mb(sum(pins, 'size'))}) + Debian ${beyondFloor.length} beyond floor (${mb(sum(beyondFloor, 'size'))}), floor ${floor.length}; avoided prereleases: ${prereleasesAvoided.join(', ') || 'none'}; problems: ${problems.length}`);
      for (const p of problems) console.log(`  PROBLEM ${p}`);
      if (arch === DOWNLOAD_ARCH) for (const s of all) download(s, codename, arch, major);
    }
  }
}
writeFileSync(join(STATE, 'closure.json'), `${JSON.stringify(report, null, 1)}\n`);
