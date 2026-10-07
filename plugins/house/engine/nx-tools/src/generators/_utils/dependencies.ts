// THE ONE WAY A HOUSE GENERATOR DECLARES A DEPENDENCY.
//
// Two rules every call site used to restate (and one of them, three sites forgot):
//   1. BASELINE ONLY — a package the project already declares (in either block) is never touched: a dependency is
//      project state, and moving an existing pin is a migration's job.
//   2. NEVER A FLOATING SPEC — `latest`, `next`, any dist-tag, `*`, `x`, an unbounded `>=`: a version nobody chose,
//      which moves with no commit behind it (0.50.0 — see ./versions.ts). Refused HERE, loudly, at the one seam,
//      so a new call site cannot reintroduce the class; tools/test-generators fails on any generator that calls
//      devkit's `addDependenciesToPackageJson` around it.
//
// Versions come from ./versions.ts (the house's pins) or ./firebase-compat.ts (derived from npm) — or, for an
// Nx-family package, from the version of Nx the workspace itself declares (they move in lockstep).
import { type GeneratorCallback, type Tree, addDependenciesToPackageJson, readJson } from '@nx/devkit';

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

/**
 * A spec that names a version (or a bounded line of one): `1.2.3`, `1.2.3-rc.1`, `^1.2.3`, `~1.2.3`. Anything
 * else — a dist-tag, `*`, `x`, a bare major, an open `>=` — floats. (A workspace link spec is not a version at all;
 * the linking port writes those, never this seam.)
 */
const PINNED = /^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isPinnedSpec(spec: string): boolean {
  return PINNED.test(spec.trim());
}

/** The package's declared spec in the root manifest (either block), or undefined. */
export function declaredSpec(tree: Tree, name: string): string | undefined {
  if (!tree.exists('package.json')) return undefined;
  const pkg = readJson<Manifest>(tree, 'package.json');
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
}

/**
 * Declare what the root manifest LACKS of `dependencies` / `devDependencies` (rule 1), refusing a floating spec
 * (rule 2). `by` names the generator for the error. Returns the install callback (a no-op when nothing was added).
 */
export function declareDependencies(
  tree: Tree,
  by: string,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string> = {},
): GeneratorCallback {
  const floating = Object.entries({ ...dependencies, ...devDependencies }).filter(([, spec]) => !isPinnedSpec(spec));
  if (floating.length) {
    throw new Error(
      `[${by}] refusing to write a floating dependency version: ${floating.map(([name, spec]) => `${name}@"${spec}"`).join(', ')}. ` +
        `A house generator writes only pinned versions (exact, ^x.y.z or ~x.y.z) — take it from ` +
        `generators/_utils/versions.ts, never a dist-tag like latest.`,
    );
  }
  const missing = (deps: Record<string, string>) =>
    Object.fromEntries(Object.entries(deps).filter(([name]) => declaredSpec(tree, name) === undefined));
  const deps = missing(dependencies);
  const devDeps = missing(devDependencies);
  if (!Object.keys(deps).length && !Object.keys(devDeps).length) return () => undefined;
  return addDependenciesToPackageJson(tree, deps, devDeps);
}
