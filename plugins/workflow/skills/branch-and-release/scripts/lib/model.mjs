// The branch model: a closed vocabulary of line KINDS (integration · stage · release · hotfix · work) whose flow
// rules are built in. This module owns the declaration's shape — presets, validation, the derived projection —
// and nothing else. See docs/features/2026-10-03-branch-model/CONTRACT.md §1–§2.
import { isWellFormed, placeholders, overlaps, match, toGlob, fill } from './patterns.mjs';

export const SCHEMA = 1;
export const PROJECTION_SCHEMA = 1;
export const FILE = '.bespunky/branches.json';

export const PROMOTE = ['ff', 'merge', 'pr'];
export const FIX_FLOWS = ['merge-forward', 'upstream-first'];
export const LANDING = ['merge', 'pr'];
export const PR_STYLES = ['merge', 'squash', 'rebase'];
export const ALLOW_DIRECT = ['version-bump'];
export const WORK_TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor'];

/** Names the toolkit ever forced, plus gitflow's — protected (never promoted) while the model is undeclared. */
export const UNDECLARED_PROTECTED = ['main', 'master', 'development', 'develop', 'staging'];

// ---- presets: data, each a full declaration (no baselines, no projection) ----------------------------

const base = (over) => ({
  schema: SCHEMA,
  derivedFrom: null,
  remote: 'origin',
  integration: { branch: 'development', baseline: null },
  stages: [],
  releases: null,
  hotfixes: null,
  work: { pattern: '{type}/{slug}', types: [...WORK_TYPES] },
  fixFlow: null,
  landing: { via: 'merge', prStyle: null },
  tags: [],
  ...over,
});
const stage = (branch, promote = 'ff') => ({ branch, promote, baseline: null, deploys: null });

export const PRESETS = {
  trunk: {
    description: 'One line: integration is production (`main`); a release is a tag.',
    build: () => base({ derivedFrom: 'trunk', integration: { branch: 'main', baseline: null } }),
  },
  'two-line': {
    description: '`development` → `main`: work lands on development, production fast-forwards from it.',
    build: () => base({ derivedFrom: 'two-line', stages: [stage('main')] }),
  },
  'three-line': {
    description: '`development` → `staging` → `main`, each stage fast-forwarded from its predecessor.',
    build: () => base({ derivedFrom: 'three-line', stages: [stage('staging'), stage('main')] }),
  },
  gitflow: {
    description: '`develop`; `release/{version}` cut from develop, merged into `main`; hotfixes off main; merge-forward; tags `v{version}` on main.',
    build: () =>
      base({
        derivedFrom: 'gitflow',
        integration: { branch: 'develop', baseline: null },
        stages: [stage('main', 'merge')],
        releases: { pattern: 'release/{version}', cutFrom: 'develop', shipsTo: 'main', maintained: false, allowDirect: ['version-bump'], deploys: null, baselines: {} },
        hotfixes: { pattern: 'hotfix/{line}/{slug}' },
        fixFlow: 'merge-forward',
        tags: [{ pattern: 'v{version}', on: 'main', deploys: null }],
      }),
  },
  'maintained-releases': {
    description: '`main` as integration; maintained `release/{version}` lines cut from it, each its own production; fixes land upstream first, then cherry-pick -x back.',
    build: () =>
      base({
        derivedFrom: 'maintained-releases',
        integration: { branch: 'main', baseline: null },
        releases: { pattern: 'release/{version}', cutFrom: 'main', shipsTo: null, maintained: true, allowDirect: ['version-bump'], deploys: null, baselines: {} },
        hotfixes: { pattern: 'hotfix/{line}/{slug}' },
        fixFlow: 'upstream-first',
        tags: [{ pattern: 'v{version}', on: 'release/{version}', deploys: null }],
      }),
  },
};

/** A preset, with the expand options applied. Throws (usage) on an unknown preset. */
export function expand(id, opts = {}) {
  const preset = PRESETS[id];
  if (!preset) throw usage(`unknown preset "${id}" (known: ${Object.keys(PRESETS).join(', ')})`);
  const m = preset.build();
  const renames = new Map();
  if (opts.integration) {
    renames.set(m.integration.branch, opts.integration);
    m.integration.branch = opts.integration;
  }
  if (opts.stages !== undefined) {
    const names = opts.stages.split(',').map((s) => s.trim()).filter(Boolean);
    const old = m.stages;
    const fedIndex = old.findIndex((s) => s.branch === m.releases?.shipsTo);
    old.forEach((s, i) => names[i] && renames.set(s.branch, names[i]));
    m.stages = names.map((name, i) => stage(name, old[i]?.promote ?? 'ff'));
    // A release-fed stage keeps its position; if that position is gone, the last stage is fed.
    if (m.releases && fedIndex >= 0) m.releases.shipsTo = names[fedIndex] ?? names.at(-1) ?? null;
  }
  const rename = (n) => renames.get(n) ?? n;
  if (m.releases) m.releases.cutFrom = rename(m.releases.cutFrom);
  for (const t of m.tags) t.on = rename(t.on);
  if (opts.releasePattern) {
    const old = m.releases?.pattern;
    if (!m.releases) m.releases = { pattern: opts.releasePattern, cutFrom: m.integration.branch, shipsTo: m.stages.at(-1)?.branch ?? null, maintained: !m.stages.length, allowDirect: ['version-bump'], deploys: null, baselines: {} };
    m.releases.pattern = opts.releasePattern;
    for (const t of m.tags) if (t.on === old) t.on = opts.releasePattern;
  }
  if (opts.maintained) {
    if (!m.releases) throw usage('--maintained needs release lines (a preset that has them, or --release-pattern)');
    m.releases.maintained = true;
  }
  if (m.releases && !m.fixFlow && !opts.fixFlow) m.fixFlow = m.releases.maintained ? 'upstream-first' : 'merge-forward';
  if (opts.fixFlow) m.fixFlow = opts.fixFlow;
  if (opts.landing) m.landing.via = opts.landing;
  if (opts.prStyle) m.landing.prStyle = opts.prStyle;
  return m;
}

export class UsageError extends Error {}
const usage = (msg) => new UsageError(msg);

// ---- validation ------------------------------------------------------------------------------------------

const TOP_KEYS = ['schema', 'derivedFrom', 'remote', 'integration', 'stages', 'releases', 'hotfixes', 'work', 'fixFlow', 'landing', 'tags', 'projection'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isName = (v) => typeof v === 'string' && /^[A-Za-z0-9._\-/]+$/.test(v) && !v.startsWith('/') && !v.endsWith('/') && !v.includes('..') && !v.includes('//');
const isSha = (v) => v === null || v === undefined || (typeof v === 'string' && /^[0-9a-f]{7,64}$/.test(v));

/** Every problem with a declaration, as `field: message` strings. Empty = valid. */
export function validate(m) {
  const errors = [];
  const err = (field, msg) => errors.push(`${field}: ${msg}`);
  if (!isObj(m)) return ['(root): the declaration must be a JSON object'];

  for (const k of Object.keys(m)) if (!TOP_KEYS.includes(k)) err(k, 'unknown field (the vocabulary is closed)');
  if (m.schema !== SCHEMA) err('schema', `must be ${SCHEMA}`);
  if (m.derivedFrom !== undefined && m.derivedFrom !== null && typeof m.derivedFrom !== 'string') err('derivedFrom', 'must be a preset id or null');
  if (m.remote !== undefined && !isName(m.remote)) err('remote', 'must be a remote name');

  // integration
  if (!isObj(m.integration)) err('integration', 'must be { branch, baseline }');
  else {
    if (!isName(m.integration.branch)) err('integration.branch', 'must be a branch name');
    if (!isSha(m.integration.baseline)) err('integration.baseline', 'must be a commit SHA or null');
  }
  const integration = m.integration?.branch;

  // stages
  const stageNames = [];
  if (!Array.isArray(m.stages)) err('stages', 'must be an array (empty = trunk)');
  else
    m.stages.forEach((s, i) => {
      const f = `stages[${i}]`;
      if (!isObj(s)) return err(f, 'must be { branch, promote, baseline, deploys }');
      for (const k of Object.keys(s)) if (!['branch', 'promote', 'baseline', 'deploys'].includes(k)) err(`${f}.${k}`, 'unknown field');
      if (!isName(s.branch)) err(`${f}.branch`, 'must be a branch name');
      else if (s.branch === integration || stageNames.includes(s.branch)) err(`${f}.branch`, `"${s.branch}" is already a declared line`);
      else stageNames.push(s.branch);
      if (!PROMOTE.includes(s.promote)) err(`${f}.promote`, `must be one of ${PROMOTE.join(' | ')}`);
      if (s.promote === 'pr' && !PR_STYLES.includes(m.landing?.prStyle)) err(`${f}.promote`, '"pr" promotion needs landing.prStyle (the style the PR merges with)');
      if (!isSha(s.baseline)) err(`${f}.baseline`, 'must be a commit SHA or null');
      if (s.deploys !== undefined && s.deploys !== null && typeof s.deploys !== 'string') err(`${f}.deploys`, 'must be a string or null');
    });
  const named = [integration, ...stageNames].filter(Boolean);

  // landing
  if (!isObj(m.landing)) err('landing', 'must be { via, prStyle }');
  else {
    if (!LANDING.includes(m.landing.via)) err('landing.via', `must be one of ${LANDING.join(' | ')}`);
    if (m.landing.prStyle !== null && m.landing.prStyle !== undefined && !PR_STYLES.includes(m.landing.prStyle)) err('landing.prStyle', `must be one of ${PR_STYLES.join(' | ')} or null`);
    if (m.landing.via === 'pr' && !PR_STYLES.includes(m.landing.prStyle)) err('landing.prStyle', 'is required when landing.via = "pr"');
  }

  // work
  const patterns = []; // [field, pattern, constraints]
  if (!isObj(m.work)) err('work', 'must be { pattern, types }');
  else {
    const p = m.work.pattern;
    if (!isWellFormed(p)) err('work.pattern', 'must be a pattern like "{type}/{slug}"');
    else {
      if (!placeholders(p).includes('slug')) err('work.pattern', 'must contain {slug}');
      if (placeholders(p).includes('type') && (!Array.isArray(m.work.types) || !m.work.types.length)) err('work.types', 'must list the allowed {type} values');
      if (m.work.types !== undefined && (!Array.isArray(m.work.types) || m.work.types.some((t) => !/^[A-Za-z0-9._-]+$/.test(t)))) err('work.types', 'must be an array of single-segment names');
      patterns.push(['work.pattern', p, Array.isArray(m.work.types) && m.work.types.length ? { type: m.work.types } : {}]);
    }
  }

  // releases
  const r = m.releases;
  if (r !== null && r !== undefined) {
    if (!isObj(r)) err('releases', 'must be an object or null');
    else {
      for (const k of Object.keys(r)) if (!['pattern', 'cutFrom', 'shipsTo', 'maintained', 'allowDirect', 'deploys', 'baselines'].includes(k)) err(`releases.${k}`, 'unknown field');
      if (!isWellFormed(r.pattern)) err('releases.pattern', 'must be a pattern like "release/{version}"');
      else {
        if (!placeholders(r.pattern).includes('version')) err('releases.pattern', 'must contain {version}');
        patterns.push(['releases.pattern', r.pattern, {}]);
      }
      if (!named.includes(r.cutFrom)) err('releases.cutFrom', `must name integration or a stage (${named.join(', ')})`);
      if (typeof r.maintained !== 'boolean') err('releases.maintained', 'must be true or false');
      if (r.shipsTo === null || r.shipsTo === undefined) {
        if (r.maintained !== true) err('releases.shipsTo', 'null requires releases.maintained = true (a line that ships nowhere is its own production)');
      } else if (!stageNames.includes(r.shipsTo)) err('releases.shipsTo', `must name a stage (${stageNames.join(', ') || 'none declared'}) or be null`);
      if (r.allowDirect !== undefined && (!Array.isArray(r.allowDirect) || r.allowDirect.some((a) => !ALLOW_DIRECT.includes(a)))) err('releases.allowDirect', `may only contain ${ALLOW_DIRECT.join(', ')}`);
      if (r.baselines !== undefined && (!isObj(r.baselines) || Object.values(r.baselines).some((v) => !isSha(v)))) err('releases.baselines', 'must map release-line names to SHAs or null');
    }
  }

  // hotfixes
  const h = m.hotfixes;
  if (h !== null && h !== undefined) {
    if (!isObj(h)) err('hotfixes', 'must be { pattern } or null');
    else {
      for (const k of Object.keys(h)) if (!['pattern', 'deploys'].includes(k)) err(`hotfixes.${k}`, 'unknown field');
      if (!isWellFormed(h.pattern)) err('hotfixes.pattern', 'must be a pattern like "hotfix/{line}/{slug}"');
      else {
        const ph = placeholders(h.pattern);
        if (!ph.includes('line') || !ph.includes('slug')) err('hotfixes.pattern', 'must contain {line} (the production line it targets) and {slug}');
        patterns.push(['hotfixes.pattern', h.pattern, {}]);
      }
    }
  }

  // fix flow
  const needsFlow = (r !== null && r !== undefined) || (h !== null && h !== undefined);
  if (m.fixFlow !== null && m.fixFlow !== undefined && !FIX_FLOWS.includes(m.fixFlow)) err('fixFlow', `must be one of ${FIX_FLOWS.join(' | ')}`);
  else if (needsFlow && !m.fixFlow) err('fixFlow', `is required when releases or hotfixes are declared (${FIX_FLOWS.join(' | ')})`);

  // tags
  if (!Array.isArray(m.tags)) err('tags', 'must be an array');
  else
    m.tags.forEach((t, i) => {
      const f = `tags[${i}]`;
      if (!isObj(t)) return err(f, 'must be { pattern, on, deploys }');
      if (!isWellFormed(t.pattern)) err(`${f}.pattern`, 'must be a tag pattern like "v{version}"');
      const lines = [...named, ...(isObj(r) && r.pattern ? [r.pattern] : [])];
      if (!lines.includes(t.on)) err(`${f}.on`, `must name a declared line or the release pattern (${lines.join(', ')})`);
    });

  // patterns: no overlap with each other, never match a named line
  for (let i = 0; i < patterns.length; i++) {
    const [fi, pi, ci] = patterns[i];
    for (const n of named) if (match(pi, n, ci)) err(fi, `"${pi}" matches the named line "${n}"`);
    for (let j = i + 1; j < patterns.length; j++) {
      const [fj, pj, cj] = patterns[j];
      if (overlaps(pi, pj, ci, cj)) err(fj, `"${pj}" overlaps ${fi} "${pi}" (some branch name would match both)`);
    }
  }

  return errors;
}

// ---- derived facts ------------------------------------------------------------------------------------

export const chainOf = (m) => [m.integration.branch, ...m.stages.map((s) => s.branch)];
export const productionLine = (m) => chainOf(m).at(-1);
export const releaseFedStage = (m) => m.releases?.shipsTo ?? null;

/** How a stage advances: from its predecessor (chain-fed) or by merging release lines (release-fed). */
export function feederOf(m, stageName) {
  if (stageName === releaseFedStage(m)) return { kind: 'releases' };
  const chain = chainOf(m);
  return { kind: 'chain', predecessor: chain[chain.indexOf(stageName) - 1] };
}

export function project(m) {
  const chain = chainOf(m);
  const r = m.releases;
  let summary = m.stages.length ? chain.join(' → ') : `${chain[0]} (trunk)`;
  if (r) summary += r.maintained ? ` · maintained ${toGlob(r.pattern)} cut from ${r.cutFrom}` : ` · ${toGlob(r.pattern)} cut from ${r.cutFrom}, shipped to ${r.shipsTo}`;
  if (m.hotfixes) summary += ` · hotfixes ${toGlob(m.hotfixes.pattern)}`;
  return {
    schema: PROJECTION_SCHEMA,
    remote: m.remote || 'origin',
    integration: chain[0],
    production: [productionLine(m)],
    productionPatterns: r?.maintained ? [toGlob(r.pattern)] : [],
    chain,
    protected: [...chain],
    protectedPatterns: r ? [toGlob(r.pattern)] : [],
    workBase: chain[0],
    summary,
  };
}

/** Canonical JSON (sorted keys) for comparisons that must ignore key order. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Release-line names among existing branches. */
export const releaseLines = (m, branches) => (m.releases ? branches.filter((b) => match(m.releases.pattern, b)) : []);

/** Resolve a hotfix's `{line}` value to a line name: a named line, or a release version filled into the pattern. */
export function resolveLine(m, value) {
  if (chainOf(m).includes(value)) return value;
  if (m.releases && placeholders(m.releases.pattern).length === 1) {
    if (match(m.releases.pattern, value)) return value;
    return fill(m.releases.pattern, { [placeholders(m.releases.pattern)[0]]: value });
  }
  return null;
}

export const productionLines = (m, branches) => [productionLine(m), ...(m.releases?.maintained ? releaseLines(m, branches) : [])];
