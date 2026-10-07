// WHAT A DEPENDENCY SPEC IS — pinned, floating, or not a version at all. ONE rule, import-free, read by every judge:
// the dependency seam that refuses to write a floating spec (./dependencies.ts), the generators' manifest guard, the
// 0.50.0 migration that reports the floating specs already on disk, and the Angular pairing's judge (which house.sh's
// probe loads before anything is installed). They once each carried their own regex and disagreed: `^1`, `>=1` and
// `1.x` were refused by the seam and never reported by the migration.

/**
 * A spec that names a version (or a bounded line of one): `1.2.3`, `1.2.3-rc.1`, `^1.2.3`, `~1.2.3`. Anything else —
 * a dist-tag, `*`, `x`, a bare major, an open `>=` — floats, or is not a registry version at all.
 */
const PINNED = /^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isPinnedSpec(spec: string): boolean {
  return PINNED.test(spec.trim());
}

/**
 * Specs that are not registry versions: a workspace or path link, a git/URL source, a patch. They neither float nor
 * pin — the linking port writes the workspace ones, and the rest are the project's own sources.
 */
const NOT_A_VERSION = /^(?:workspace:|file:|link:|portal:|patch:|exec:|git(?:\+[a-z]+)?:|github:|gitlab:|bitbucket:|https?:|[\w.-]+\/[\w.-]+(?:#.*)?$)/;

/** A registry version that nobody chose: a dist-tag, `*`, `x`, a bare major, `1.x`, an open `>=` … (an `npm:` alias judged by its range). */
export function isFloatingSpec(spec: string): boolean {
  const value = spec.trim();
  const alias = /^npm:(?:@[^/@]+\/)?[^@]+@(.*)$/.exec(value);
  if (alias) return isFloatingSpec(alias[1]);
  if (NOT_A_VERSION.test(value)) return false;
  return !isPinnedSpec(value);
}
