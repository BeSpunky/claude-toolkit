// THE PURE HALF of the Postgres closure projection: dpkg's version order, index parsing, which packages are pinned, what
// is left for Debian to supply, the generated file. No network, no filesystem — so tools/test-layers can run the selection
// rules against fixture indexes and prove the committed table is exactly what `render` writes. The network half is project.mjs.
import { createHash } from 'node:crypto';

/**
 * Did gpg's `--status-fd` output report a good signature by the key whose PRIMARY fingerprint is `fingerprint`? GOODSIG alone
 * says only that some key in the keyring signed; VALIDSIG's last field names the primary key of the one that did.
 */
export function signedBy(status, fingerprint) {
  const valid = /^\[GNUPG:\] VALIDSIG (.+)$/m.exec(status);
  return /^\[GNUPG:\] GOODSIG/m.test(status) && valid?.[1].trim().split(/\s+/).at(-1) === fingerprint;
}

// ── dpkg version order (Debian Policy 5.6.12) ────────────────────────────────────────────────────────────────────────
const order = (c) => (c === '~' ? -1 : c === undefined || c === '' ? 0 : /[A-Za-z]/.test(c) ? c.charCodeAt(0) : c.charCodeAt(0) + 256);
function comparePart(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    while ((i < a.length && !/\d/.test(a[i])) || (j < b.length && !/\d/.test(b[j]))) {
      const difference = order(/\d/.test(a[i] ?? '') ? '' : a[i]) - order(/\d/.test(b[j] ?? '') ? '' : b[j]);
      if (difference) return difference;
      if (i < a.length && !/\d/.test(a[i])) i++;
      if (j < b.length && !/\d/.test(b[j])) j++;
    }
    let x = '';
    let y = '';
    while (/\d/.test(a[i] ?? '')) x += a[i++];
    while (/\d/.test(b[j] ?? '')) y += b[j++];
    const difference = Number(x || 0) - Number(y || 0);
    if (difference) return difference;
  }
  return 0;
}
function versionParts(version) {
  const colon = version.indexOf(':');
  const rest = colon < 0 ? version : version.slice(colon + 1);
  const hyphen = rest.lastIndexOf('-');
  return { epoch: colon < 0 ? 0 : Number(version.slice(0, colon)), upstream: hyphen < 0 ? rest : rest.slice(0, hyphen), revision: hyphen < 0 ? '' : rest.slice(hyphen + 1) };
}
export function compareVersions(a, b) {
  const [x, y] = [versionParts(a), versionParts(b)];
  return x.epoch - y.epoch || comparePart(x.upstream, y.upstream) || comparePart(x.revision, y.revision);
}
const holds = (version, op, want) => {
  if (!op) return true;
  const c = compareVersions(version, want);
  return { '=': c === 0, '>=': c >= 0, '<=': c <= 0, '>>': c > 0, '<<': c < 0 }[op];
};

// ── indexes ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A Debian `Packages` index, keeping only the fields this projection reads. */
export function parsePackages(text) {
  const stanzas = [];
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    const fields = {};
    for (const line of block.split('\n')) {
      const match = /^([A-Za-z0-9-]+): (.*)$/.exec(line);
      if (match) fields[match[1]] = match[2];
    }
    stanzas.push({
      name: fields.Package,
      version: fields.Version,
      depends: [fields['Pre-Depends'], fields.Depends].filter(Boolean).join(', '),
      provides: fields.Provides ?? '',
      filename: fields.Filename,
      sha256: fields.SHA256,
    });
  }
  return stanzas;
}

/** `a (>= 1) | b, c` → `[[{name:'a',op:'>=',want:'1'},{name:'b'}],[{name:'c'}]]`. An architecture qualifier is dropped. */
export function parseRelations(text) {
  return text
    .split(',')
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map((clause) =>
      clause.split('|').map((alternative) => {
        const match = /^([^\s(:]+)(?::\S+)?(?:\s*\(\s*(<<|<=|=|>=|>>)\s*([^)\s]+)\s*\))?/.exec(alternative.trim());
        return { name: match[1], op: match[2], want: match[3] };
      }),
    );
}

// ── THE RULES ────────────────────────────────────────────────────────────────────────────────────────────────────────
const isStable = (stanza) => !stanza.version.includes('~');
const upstreamMajor = (version) => versionParts(version).upstream.split(/[.~]/)[0];
const newest = (list) => [...list].sort((a, b) => compareVersions(b.version, a.version))[0];

/**
 * Debian's packaging around a server the closure runs on its own: the cluster manager, its debconf and locale questions,
 * the snakeoil certificate. A closure unpacks files and runs no scripts, so nothing in it reads them. Everything NOT
 * named here is left in `systemDepends`, on purpose: an unexpected new dependency should reach apt, not vanish.
 */
const PACKAGING_ONLY = new Set(['postgresql-common', 'postgresql-client-common', 'ssl-cert', 'debconf', 'debconf-2.0', 'locales', 'locales-all', 'sensible-utils']);

/**
 * The packages pinned for one major, from one codename × architecture's archive index: the server, its client, its
 * extensions and libpq — each the newest stable build.
 *
 * `libpq5` is selected BY MAJOR. The package has one name and every major builds it, so "the newest" is whichever major
 * is newest in the suite: a prerelease today, and a real release once 19 is GA (2026-11-19) — at which point a "no tilde"
 * rule would quietly pair Postgres 18 with libpq 19.
 */
export function selectPackages(stanzas, major, extensions) {
  const pick = (name, accepts = () => true) => {
    const found = newest(stanzas.filter((stanza) => stanza.name === name && isStable(stanza) && accepts(stanza)));
    if (!found) throw new Error(`no stable ${name} for Postgres ${major} in the index`);
    return found;
  };
  const sameMajor = (stanza) => upstreamMajor(stanza.version) === major;
  const selected = [
    pick(`postgresql-${major}`, sameMajor),
    pick(`postgresql-client-${major}`, sameMajor),
    pick('libpq5', sameMajor),
    ...extensions.map((extension) => pick(`postgresql-${major}-${extension}`)),
  ];
  // What the pinned packages say of each other must hold: `psql` 18 against an older libpq dies on a missing symbol.
  const byName = new Map(selected.map((stanza) => [stanza.name, stanza]));
  for (const stanza of selected) {
    for (const clause of parseRelations(stanza.depends)) {
      const pinned = clause.find(({ name }) => byName.has(name));
      if (pinned && !holds(byName.get(pinned.name).version, pinned.op, pinned.want)) {
        throw new Error(`${stanza.name} ${stanza.version} wants ${pinned.name} ${pinned.op} ${pinned.want}, the closure has ${byName.get(pinned.name).version}`);
      }
    }
  }
  return selected;
}

/**
 * The relations the selected packages leave for Debian to supply: their Depends, minus each other and PACKAGING_ONLY,
 * one clause per name with the highest minimum any of them asks for. Relations are sorted, so the string moves only when
 * the facts do. Handed to `apt-get satisfy`; a clause with a pinned or packaging alternative needs nothing at all.
 */
export function systemDependsClauses(selected) {
  const names = new Set(selected.map((stanza) => stanza.name));
  const clauses = new Map();
  for (const stanza of selected) {
    for (const clause of parseRelations(stanza.depends)) {
      if (clause.some(({ name }) => names.has(name) || PACKAGING_ONLY.has(name))) continue;
      const simple = clause.length === 1 && (!clause[0].op || clause[0].op === '>=');
      const key = simple ? clause[0].name : clause.map(renderRelation).join(' | ');
      const held = clauses.get(key)?.[0].want;
      const asksMore = simple && clause[0].want !== undefined && (held === undefined || compareVersions(clause[0].want, held) > 0);
      if (!clauses.has(key) || asksMore) clauses.set(key, clause);
    }
  }
  return clauses;
}
const renderRelation = ({ name, op, want }) => (op ? `${name} (${op} ${want})` : name);
const renderClauses = (clauses) => [...clauses.keys()].sort().map((key) => clauses.get(key).map(renderRelation).join(' | ')).join(', ');

/**
 * One codename's closure, from what each architecture selected. `systemDepends` is one string per codename, so an
 * architecture that needs different NAMES is refused here rather than handed to the other one's apt; different minimums
 * merge to the higher.
 */
export function buildClosure(perArch, poolRoot) {
  const architectures = Object.keys(perArch);
  const clausesPerArch = architectures.map((arch) => systemDependsClauses(perArch[arch]));
  const [first, ...others] = clausesPerArch;
  for (const [index, other] of others.entries()) {
    const [a, b] = [[...first.keys()].sort().join(), [...other.keys()].sort().join()];
    if (a !== b) throw new Error(`${architectures[0]} and ${architectures[index + 1]} need different Debian packages: ${a} / ${b}`);
  }
  const merged = systemDependsClauses(architectures.flatMap((arch) => perArch[arch]));
  const packages = Object.fromEntries(architectures.map((arch) => [arch, perArch[arch].map(({ filename, sha256 }) => ({ url: `${poolRoot}/${filename}`, sha256 }))]));
  // The directory's name: the server's upstream version, readable, and a fingerprint of EVERY file — so an extension or
  // a rebuild that moves without the server moving still installs.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(architectures.flatMap((arch) => packages[arch])))
    .digest('hex')
    .slice(0, 8);
  return { version: `${versionParts(perArch[architectures[0]][0].version).upstream}-${fingerprint}`, systemDepends: renderClauses(merged), packages };
}

/** Does this relation hold against a Debian index (a real package, or one that provides the name)? */
export function debianSupplies(stanzas, relation) {
  return stanzas.some(
    (stanza) =>
      (stanza.name === relation.name && holds(stanza.version, relation.op, relation.want)) ||
      (stanza.provides && parseRelations(stanza.provides).some(([provided]) => provided.name === relation.name && (!relation.op || (provided.want && holds(provided.want, relation.op, relation.want))))),
  );
}

// ── THE GENERATED FILE ───────────────────────────────────────────────────────────────────────────────────────────────
const quote = (text) => `'${text}'`;
/** `postgres-closures.ts` — a pure function of the table and its date, so a hand-edit shows as a difference. */
export function render(table, asOf) {
  const lines = [
    '// GENERATED by tools/postgres-debs/project.mjs from the signed <codename>-pgdg-archive indexes of apt-archive.postgresql.org — never',
    '// hand-edit; change the POSTGRES_* pins (versions.ts) or re-run it with --write. It is a frozen copy in every project',
    '// that installs this payload: what it says is true as of the date below.',
    '//',
    '// Import-free on purpose, like the other projected tables. See DebClosureTool (layers/descriptor.ts) for what each field means.',
    '',
    `export const POSTGRES_CLOSURES_AS_OF = ${quote(asOf)};`,
    '',
    '/** Per Postgres major, per Debian codename: the closure an `archives` entry of format `deb` installs. */',
    'export const POSTGRES_CLOSURES = {',
  ];
  for (const [major, codenames] of Object.entries(table).sort(([a], [b]) => Number(b) - Number(a))) {
    lines.push(`  ${quote(major)}: {`);
    for (const [codename, closure] of Object.entries(codenames)) {
      lines.push(`    ${codename}: {`, `      version: ${quote(closure.version)},`, `      systemDepends:`, `        ${quote(closure.systemDepends)},`, `      packages: {`);
      for (const [arch, debs] of Object.entries(closure.packages)) {
        lines.push(`        ${arch}: [`);
        for (const { url, sha256 } of debs) lines.push(`          { url: ${quote(url)}, sha256: ${quote(sha256)} },`);
        lines.push('        ],');
      }
      lines.push('      },', '    },');
    }
    lines.push('  },');
  }
  lines.push('} as const;', '');
  return lines.join('\n');
}
