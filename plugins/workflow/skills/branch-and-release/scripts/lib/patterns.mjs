// Branch-name patterns: `release/{version}`, `hotfix/{line}/{slug}`, `{type}/{slug}`.
//
// A `{placeholder}` matches one path segment (`[^/]+`), except `{slug}`, which matches the rest (`.+`). A
// placeholder may be CONSTRAINED to a closed set of values (the work pattern's `{type}` → `types`). Overlap
// between two patterns is decided exactly — a product walk over the two patterns' automata — not by sampling,
// because "these two kinds never claim the same branch" is what every reader downstream relies on.

const TOKEN = /\{([a-z]+)\}/g;

export function placeholders(pattern) {
  return [...pattern.matchAll(TOKEN)].map((m) => m[1]);
}

export function isWellFormed(pattern) {
  return typeof pattern === 'string' && pattern.length > 0 && !/[{}]/.test(pattern.replace(TOKEN, '')) && !/\s/.test(pattern);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The anchored RegExp for a pattern, with named groups per placeholder. */
export function toRegExp(pattern, constraints = {}) {
  let source = '';
  let last = 0;
  for (const m of pattern.matchAll(TOKEN)) {
    source += escape(pattern.slice(last, m.index));
    const name = m[1];
    const body = constraints[name]?.length ? constraints[name].map(escape).join('|') : name === 'slug' ? '.+' : '[^/]+';
    source += `(?<${name}>${body})`;
    last = m.index + m[0].length;
  }
  source += escape(pattern.slice(last));
  return new RegExp(`^${source}$`);
}

export function match(pattern, name, constraints = {}) {
  const m = toRegExp(pattern, constraints).exec(name);
  return m ? { ...m.groups } : null;
}

/** The shell glob for a pattern: each `{x}` → `*`. */
export function toGlob(pattern) {
  return pattern.replace(TOKEN, '*');
}

/** Substitute values into a pattern; throws naming any placeholder left without a value. */
export function fill(pattern, values) {
  return pattern.replace(TOKEN, (_, name) => {
    if (values[name] === undefined || values[name] === '') throw new Error(`pattern "${pattern}" needs a value for {${name}}`);
    return values[name];
  });
}

// ---- exact overlap -------------------------------------------------------------------------------------
// A pattern is expanded into variants (one per constrained-value combination), each a token list of
// { lit: char } | { seg: true } (one-or-more non-slash) | { any: true } (one-or-more anything).

function variants(pattern, constraints) {
  let out = [[]];
  let last = 0;
  const pushLit = (text) => {
    for (const list of out) for (const ch of text) list.push({ lit: ch });
  };
  for (const m of pattern.matchAll(TOKEN)) {
    pushLit(pattern.slice(last, m.index));
    const name = m[1];
    if (constraints[name]?.length) {
      const next = [];
      for (const list of out) for (const value of constraints[name]) next.push([...list, ...[...value].map((ch) => ({ lit: ch }))]);
      out = next;
    } else {
      for (const list of out) list.push(name === 'slug' ? { any: true } : { seg: true });
    }
    last = m.index + m[0].length;
  }
  pushLit(pattern.slice(last));
  return out;
}

// NFA state: [index, inside] — `inside` means a one-or-more token at `index` has consumed at least one char.
function step(tokens, states, ch) {
  const next = new Map();
  const add = (i, inside) => next.set(`${i}:${inside}`, [i, inside]);
  for (const [i, inside] of states) {
    const t = tokens[i];
    if (inside) {
      // Either keep consuming the same token, or (epsilon) move past it and let the next token consume.
      if (t.any || (t.seg && ch !== '/')) add(i, true);
      const after = tokens[i + 1];
      if (after) consume(after, i + 1, ch, add);
    } else if (t) consume(t, i, ch, add);
  }
  return [...next.values()];
}

function consume(t, i, ch, add) {
  if (t.lit !== undefined) {
    if (t.lit === ch) add(i + 1, false);
  } else if (t.any || (t.seg && ch !== '/')) add(i, true);
}

const accepts = (tokens, states) => states.some(([i, inside]) => (inside ? i === tokens.length - 1 : i === tokens.length));

function intersects(a, b) {
  const alphabet = new Set(['/', '\u0001']);
  for (const t of [...a, ...b]) if (t.lit !== undefined) alphabet.add(t.lit);
  const key = (sa, sb) => `${sa.map((s) => s.join(':')).sort().join(',')}|${sb.map((s) => s.join(':')).sort().join(',')}`;
  const queue = [[[[0, false]], [[0, false]]]];
  const seen = new Set([key(...queue[0])]);
  while (queue.length) {
    const [sa, sb] = queue.shift();
    if (accepts(a, sa) && accepts(b, sb)) return true;
    for (const ch of alphabet) {
      const na = step(a, sa, ch);
      const nb = step(b, sb, ch);
      if (!na.length || !nb.length) continue;
      const k = key(na, nb);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push([na, nb]);
      }
    }
  }
  return false;
}

/** True when some branch name matches both patterns. */
export function overlaps(p, q, cp = {}, cq = {}) {
  for (const a of variants(p, cp)) for (const b of variants(q, cq)) if (intersects(a, b)) return true;
  return false;
}
