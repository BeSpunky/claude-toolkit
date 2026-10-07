// GLOBS, MATCHED BY THE MATCHER THE TOOLS THEMSELVES USE.
//
// Two of the house's questions are really "would this tool match this path?": does an nx.json plugin entry's
// `include`/`exclude` cover a project (Nx: `findMatchingConfigFiles`, minimatch with `dot: true`), and does an ESLint
// flat-config block's `files` cover a source file (ESLint: minimatch, `dot: true`, paths relative to the config). A
// hand-rolled glob-to-regex would answer a slightly different question in the corners (braces, `**` at the ends,
// negation) — and the corners are where a project silently loses its lint. So the matcher is minimatch itself,
// resolved THROUGH @nx/devkit (a peer of this package, which depends on it): the same copy Nx loads, without this
// package claiming a dependency it would then have to keep in step with Nx's.
import { createRequire } from 'node:module';

type Minimatch = (path: string, pattern: string, options?: { dot?: boolean }) => boolean;

let cached: Minimatch | undefined;
function minimatch(): Minimatch {
  if (!cached) {
    const fromDevkit = createRequire(require.resolve('@nx/devkit/package.json'));
    const loaded = fromDevkit('minimatch') as Minimatch | { minimatch: Minimatch };
    cached = typeof loaded === 'function' ? loaded : loaded.minimatch;
  }
  return cached;
}

/** Does `path` (workspace-relative, `/`-separated) match `pattern`, the way Nx and ESLint match it? */
export const matchesGlob = (path: string, pattern: string): boolean => minimatch()(path, pattern, { dot: true });

export const matchesAnyGlob = (path: string, patterns: readonly string[]): boolean => patterns.some((pattern) => matchesGlob(path, pattern));

/**
 * Nx's plugin-entry filter (`createMatcher` + `findMatchingConfigFiles`, nx 23): an empty `include` takes every file,
 * an empty `exclude` drops none; a list with a `!pattern` is evaluated in order, later matches overriding earlier
 * ones, starting from "matched" when the first pattern is a negation.
 */
export function pluginEntryMatches(file: string, include: readonly string[] | undefined, exclude: readonly string[] | undefined): boolean {
  return orderedMatch(file, include, true) && !orderedMatch(file, exclude, false);
}

function orderedMatch(file: string, patterns: readonly string[] | undefined, empty: boolean): boolean {
  if (!patterns?.length) return empty;
  if (!patterns.some((pattern) => pattern.startsWith('!'))) return matchesAnyGlob(file, patterns);
  let matched = patterns[0].startsWith('!');
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    if (matchesGlob(file, negated ? pattern.slice(1) : pattern)) matched = !negated;
  }
  return matched;
}
