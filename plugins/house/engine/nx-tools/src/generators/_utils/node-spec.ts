// HOW A PROJECT SAYS WHICH NODE IT RUNS — read the way the tools that already read it do, resolved to a major.
//
// PURE AND IMPORT-FREE (type imports only, which every loader erases), with the upstream facts passed in: three readers
// share it and must never disagree —
//   - the generators (./node-version.ts), with the live projected facts (./node-facts.ts);
//   - the 0.50.0 `declare-node-version` migration, with its FROZEN copy of those facts (a migration freezes the values
//     it writes; it may share the mechanics that take them as parameters);
//   - house.sh's probe (engine/house-probe.mts), which loads this file directly, before anything is installed, so a
//     Node the house cannot resolve is refused before anything is written — not mid-generate.
//
// THE GRAMMARS, as their owners define them:
//   - `.nvmrc` (nvm's spec, github.com/nvm-sh/nvmrc): `#` starts a comment, blank lines are ignored, ONE value remains:
//     a version (`22`, `v22`, `22.11`, `22.11.0`; `22.x` as setup-node reads it), `lts/*`, `lts/-<n>`, `lts/<codename>`,
//     `node` / `stable` (newest), or a user's own nvm alias / `system` / `iojs` (which no file can resolve: unknown);
//   - `.node-version` (nodenv, fnm, setup-node): the same values;
//   - package.json `volta.node`: an exact version;
//   - package.json `engines.node`: a RANGE — what the project accepts, not what it runs — so it is never a source, only
//     checked against the one that is;
//   - an image reference: `typescript-node` / `javascript-node` tags are `[<image version>-]<major>[-<distro>]` (the
//     `1` in `typescript-node:1-22-bookworm` is the IMAGE's version, not Node's); the official `node` image tags lead
//     with the version or an alias (`22-bookworm`, `22.11.0-alpine`, `lts-slim`, `jod`).
import type * as NodeFacts from './node-facts';

/** The facts this module resolves aliases and validates images with — the live table, or a migration's frozen copy. */
export interface NodeFactsTable {
  asOf: string;
  ltsCodenames: Readonly<Record<string, number>>;
  newestLtsMajor: number;
  newestMajor: number;
  imageMajors: readonly number[];
}

/** The live facts as one table (a reader passes `factsOf(await import('./node-facts'))` or its frozen copy). */
export function factsOf(facts: typeof NodeFacts): NodeFactsTable {
  return {
    asOf: facts.NODE_FACTS_AS_OF,
    ltsCodenames: facts.NODE_LTS_CODENAMES,
    newestLtsMajor: facts.NODE_NEWEST_LTS_MAJOR,
    newestMajor: facts.NODE_NEWEST_MAJOR,
    imageMajors: facts.TYPESCRIPT_NODE_IMAGE_MAJORS,
  };
}

/** A resolved major — `alias` set when it came from a name whose meaning MOVES (`lts/*`, `node`), stamped with the date. */
export type NodeMajor = { major: number; alias?: string };
export type Resolved = NodeMajor | { unknown: string };

export const isUnknown = (value: Resolved): value is { unknown: string } => 'unknown' in value;

/** One value of the nvm / .node-version grammar → a major, or why it names none. */
export function resolveNodeValue(raw: string, facts: NodeFactsTable): Resolved {
  const value = raw.trim().toLowerCase();
  const version = /^v?(\d+)(?:\.(?:\d+|x|\*)){0,2}$/.exec(value);
  if (version) return { major: Number(version[1]) };
  if (value === 'lts/*' || value === 'lts') return moving(facts.newestLtsMajor, raw.trim(), facts);
  const back = /^lts\/-(\d+)$/.exec(value);
  if (back) {
    const lines = [...new Set(Object.values(facts.ltsCodenames))].sort((a, b) => b - a);
    const major = lines[Number(back[1])];
    return major ? moving(major, raw.trim(), facts) : { unknown: `"${raw.trim()}" reaches past the oldest LTS line` };
  }
  const codename = /^lts\/([a-z]+)$/.exec(value)?.[1] ?? (value in facts.ltsCodenames ? value : undefined);
  if (codename) {
    const major = facts.ltsCodenames[codename];
    return major ? { major } : { unknown: `"${raw.trim()}" is no LTS line known as of ${facts.asOf}` };
  }
  if (['node', 'stable', 'current', 'latest'].includes(value)) return moving(facts.newestMajor, raw.trim(), facts);
  return { unknown: `"${raw.trim()}" is not a Node version or an alias nvm defines for everyone (a personal nvm alias, \`system\` and \`iojs\` mean something different on each machine)` };
}

function moving(major: number, alias: string, facts: NodeFactsTable): NodeMajor {
  return { major, alias: `${alias} (Node ${major} as of ${facts.asOf})` };
}

/** A whole version FILE (`.nvmrc` / `.node-version`): comments and blanks dropped, exactly one value. */
export function resolveVersionFile(text: string, facts: NodeFactsTable): Resolved {
  const values = text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
  if (values.length !== 1) {
    return { unknown: values.length ? `it holds ${values.length} values (${values.join(', ')}) — nvm reads exactly one` : 'it is empty' };
  }
  return resolveNodeValue(values[0], facts);
}

/** An image reference's Node major (typescript-node / javascript-node / node), or why it names none. */
export function resolveImage(ref: string, facts: NodeFactsTable): Resolved {
  const match = /(?:^|\/)(typescript-node|javascript-node|node):([\w.-]+)(?:@sha256:\w+)?$/.exec(ref.trim());
  if (!match) return { unknown: `"${ref}" is not a Node image the house can read a version from` };
  const [, image, tag] = match;
  if (image === 'node') {
    return resolveNodeValue(tag.split('-')[0], facts);
  }
  // [dev-][<image version>-]<major>[-<distro>]
  const parts = tag.split('-').filter((part) => part !== 'dev' && /^\d+(?:\.\d+)*$/.test(part));
  const candidate = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
  // A lone number is Node's major only when it is one this image publishes (the image's own versions are 0…5 and
  // `4-bookworm` means "image 4, its default Node"); two numbers are always <image version>-<major>.
  if (candidate && !candidate.includes('.') && (parts.length >= 2 || facts.imageMajors.includes(Number(candidate)))) {
    return { major: Number(candidate) };
  }
  return { unknown: `${image}:${tag} pins the image's own version, not Node's — its Node is whatever that image defaults to` };
}

/** The Node devcontainer feature's `version` option (`22`, `22.11`, `lts`, `latest`), or why it names none. */
export function resolveFeatureVersion(version: string, facts: NodeFactsTable): Resolved {
  const value = version.trim().toLowerCase();
  if (value === 'lts') return moving(facts.newestLtsMajor, version, facts);
  if (value === 'latest' || value === 'current') return moving(facts.newestMajor, version, facts);
  return resolveNodeValue(value, facts);
}

/** A Dockerfile's FINAL stage base image (the `FROM` that builds the container), `ARG` defaults substituted. */
export function dockerfileBaseImage(text: string): string | undefined {
  const args: Record<string, string> = {};
  let base: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const arg = /^\s*ARG\s+(\w+)=(\S+)/i.exec(line);
    if (arg) args[arg[1]] = arg[2].replace(/^["']|["']$/g, '');
    const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)/i.exec(line);
    if (from) base = from[1].replace(/\$\{?(\w+)\}?/g, (_, name) => args[name] ?? `$${name}`);
  }
  return base;
}

/**
 * Whether an `engines.node` RANGE admits a major — `22`, `22.x`, `^22.11.0`, `~22`, `>=20`, `>=20 <23`, `20 || 22`.
 * undefined when the range uses syntax this small reader does not know (it then judges nothing).
 */
export function rangeAdmitsMajor(range: string, major: number): boolean | undefined {
  const sets = range.split('||').map((set) => set.trim()).filter(Boolean);
  if (!sets.length) return undefined;
  let admits = false;
  for (const set of sets) {
    if (set === '*' || set === 'x') return true;
    let low = -Infinity;
    let high = Infinity;
    for (const comparator of set.split(/\s+/)) {
      const parsed = /^(>=|<=|>|<|\^|~|=)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(comparator);
      if (!parsed) return undefined;
      const [, op = '', majorText, minor = 'x', patch = 'x'] = parsed;
      const m = Number(majorText);
      // Does the comparator name a point INSIDE major m (22.11.0), or the major's edge (22 / 22.x / 22.0.0)?
      const inside = /^\d+$/.test(minor) && (Number(minor) > 0 || (/^\d+$/.test(patch) && Number(patch) > 0));
      if (op === '>=') low = Math.max(low, m);
      else if (op === '>') low = Math.max(low, inside || /^\d+$/.test(minor) ? m : m + 1); // >22 = 23+; >22.0.0 admits 22.x
      else if (op === '<') high = Math.min(high, inside ? m : m - 1); // <23 / <23.0.0 = up to 22
      else if (op === '<=') high = Math.min(high, m);
      else {
        low = Math.max(low, m); // 22, 22.x, ^22.11.0, ~22, =22.11.0: within major m
        high = Math.min(high, m);
      }
    }
    if (major >= low && major <= high) admits = true;
  }
  return admits;
}

/** Where a project declares its Node — each source as found, before resolution. */
export interface NodeSources {
  nvmrc?: string;
  nodeVersion?: string;
  volta?: string;
  engines?: string;
}

export const NODE_SOURCE_FILES = { nvmrc: '.nvmrc', nodeVersion: '.node-version' } as const;

/** The project's Node: the ONE source it declares (`.nvmrc` first, then `.node-version`, then Volta), cross-checked. */
export type ProjectNode =
  | { state: 'declared'; major: number; from: string; alias?: string; disagreements: string[] }
  | { state: 'undeclared'; disagreements: string[] }
  | { state: 'unknown'; from: string; why: string };

export function resolveProjectNode(sources: NodeSources, facts: NodeFactsTable): ProjectNode {
  const read: Array<{ from: string; value: Resolved }> = [];
  if (sources.nvmrc !== undefined) read.push({ from: '.nvmrc', value: resolveVersionFile(sources.nvmrc, facts) });
  if (sources.nodeVersion !== undefined) read.push({ from: '.node-version', value: resolveVersionFile(sources.nodeVersion, facts) });
  if (sources.volta !== undefined) read.push({ from: 'package.json volta.node', value: resolveNodeValue(sources.volta, facts) });
  const [primary, ...others] = read;
  const disagreements: string[] = [];
  if (primary && isUnknown(primary.value)) return { state: 'unknown', from: primary.from, why: primary.value.unknown };
  const major = primary && !isUnknown(primary.value) ? primary.value.major : undefined;
  for (const other of others) {
    if (!isUnknown(other.value) && major !== undefined && other.value.major !== major) {
      disagreements.push(`${other.from} says Node ${other.value.major}, but ${primary!.from} (which the house reads) says ${major}`);
    }
  }
  if (sources.engines !== undefined && major !== undefined && rangeAdmitsMajor(sources.engines, major) === false) {
    disagreements.push(`package.json engines.node "${sources.engines}" does not admit Node ${major} (${primary!.from})`);
  }
  if (major === undefined) return { state: 'undeclared', disagreements };
  return { state: 'declared', major, from: primary!.from, alias: (primary!.value as NodeMajor).alias, disagreements };
}

/** Why the house's image cannot be built on this major (undefined when it can). */
export function imageGap(major: number, facts: NodeFactsTable): string | undefined {
  if (facts.imageMajors.includes(major)) return undefined;
  const nearest = [...facts.imageMajors].filter((m) => m <= major).pop() ?? facts.imageMajors[0];
  return (
    `mcr.microsoft.com/devcontainers/typescript-node publishes no Node ${major} image (it publishes ` +
    `${facts.imageMajors.join(', ')} as of ${facts.asOf} — even, LTS-line majors), so the house devcontainer could not ` +
    `be built. Declare an LTS-line major (e.g. ${nearest}).`
  );
}

/**
 * The Node a DEVCONTAINER runs, from what the project has on disk — the evidence a project with no version file is read
 * from (the 0.50.0 migration seeds `.nvmrc` with it; the generators seed from it too, so a house upgrade never moves the
 * Node a container already runs to the house default). In the order the container gets its Node:
 *   1. the Node FEATURE's `version` (installed on top of the image, first on PATH);
 *   2. the image: `build.dockerfile`'s final `FROM` (house.Dockerfile included), else `image`.
 * undefined: the devcontainer has no Node at all (or there is none) — nothing to keep, the house default is a choice.
 * `unknown`: it HAS a Node the house cannot read (a Dockerfile on a non-Node base, `version: none` …) — never guessed.
 */
export function devcontainerNode(
  read: (path: string) => string | undefined,
  facts: NodeFactsTable,
): { major: number; from: string; alias?: string } | { unknown: string; from: string } | undefined {
  const path = '.devcontainer/devcontainer.json';
  const text = read(path);
  if (text === undefined) return undefined;
  let json: { image?: unknown; build?: { dockerfile?: unknown }; dockerFile?: unknown; features?: Record<string, { version?: unknown } | string> };
  try {
    json = JSON.parse(stripJsonc(text));
  } catch {
    return { unknown: 'it is not valid JSON(C)', from: path };
  }
  for (const [id, options] of Object.entries(json.features ?? {})) {
    if (!/^ghcr\.io\/devcontainers\/features\/node(?::[\w.-]+)?$/.test(id)) continue;
    const version = typeof options === 'string' ? options : options?.version;
    if (String(version).toLowerCase() === 'none') continue; // the feature installs no Node: the image decides
    const resolved = resolveFeatureVersion(version === undefined ? 'lts' : String(version), facts); // the feature defaults to lts
    const from = `${path} Node feature version "${version ?? 'lts (its default)'}"`;
    return isUnknown(resolved) ? { unknown: resolved.unknown, from } : { ...resolved, from };
  }
  const dockerfile = typeof json.build?.dockerfile === 'string' ? json.build.dockerfile : typeof json.dockerFile === 'string' ? json.dockerFile : undefined;
  if (dockerfile) {
    const file = `.devcontainer/${dockerfile}`.replace(/\/\.\//g, '/');
    const base = dockerfileBaseImage(read(file) ?? '');
    if (!base) return { unknown: 'it has no readable FROM', from: file };
    const resolved = resolveImage(base, facts);
    return isUnknown(resolved) ? { unknown: resolved.unknown, from: `${file} FROM ${base}` } : { ...resolved, from: `${file} FROM ${base}` };
  }
  if (typeof json.image === 'string') {
    const resolved = resolveImage(json.image, facts);
    if (!isUnknown(resolved)) return { ...resolved, from: `${path} image ${json.image}` };
    // A non-Node image with no Node feature: the container has no Node of its own to keep.
    return /(?:typescript-node|javascript-node|(?:^|\/)node):/.test(json.image) ? { unknown: resolved.unknown, from: `${path} image ${json.image}` } : undefined;
  }
  return undefined;
}

/** JSONC → JSON: comments and trailing commas removed, strings (URLs included) untouched. */
export function stripJsonc(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i += 1; i < text.length && text[i] !== '"'; i += 1) if (text[i] === '\\') i += 1;
      out += text.slice(start, i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i += 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
