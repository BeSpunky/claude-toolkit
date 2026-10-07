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
//   3. KEEP THE FILE'S ORDER — a block the project keeps sorted gets a new name at its sorted place; a block it keeps
//      in its own order gets the name appended, and nothing already there moves. (devkit's writer re-sorts the whole
//      block, and a hand-rolled one appends: one churns an unsorted file, the other breaks a sorted one — 0.50.0's
//      firebase-tools landed after `vitest`.) `placeDependency` is the rule; migrations that write a manifest by hand
//      use it too.
//
// Versions come from ./versions.ts (the house's pins) or ./firebase-compat.ts (derived from npm) — or, for an
// Nx-family package, from the version of Nx the workspace itself declares (they move in lockstep).
import { type GeneratorCallback, type Tree, addDependenciesToPackageJson, readJson, writeJson } from '@nx/devkit';

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
  const before = readJson<Manifest>(tree, 'package.json');
  const install = addDependenciesToPackageJson(tree, deps, devDeps);
  const after = readJson<Manifest>(tree, 'package.json');
  for (const block of ['dependencies', 'devDependencies'] as const) {
    if (after[block]) after[block] = keepOrder(before[block], after[block]!);
  }
  writeJson(tree, 'package.json', after);
  return install;
}

/** `block` with `name` set to `spec`: in place when present; else at its sorted place in a sorted block, else last. */
export function placeDependency(block: Record<string, string> | undefined, name: string, spec: string): Record<string, string> {
  const entries = Object.entries(block ?? {});
  const at = entries.findIndex(([key]) => key === name);
  if (at >= 0) entries[at] = [name, spec];
  else {
    const keys = entries.map(([key]) => key);
    const sorted = keys.every((key, i) => i === 0 || keys[i - 1] <= key);
    const index = sorted ? entries.findIndex(([key]) => key > name) : -1;
    entries.splice(index < 0 ? entries.length : index, 0, [name, spec]);
  }
  return Object.fromEntries(entries);
}

/** `after`'s entries in `before`'s order, every name `before` lacked placed by `placeDependency`. */
function keepOrder(before: Record<string, string> | undefined, after: Record<string, string>): Record<string, string> {
  let block = Object.fromEntries(Object.keys(before ?? {}).filter((key) => key in after).map((key) => [key, after[key]]));
  for (const [name, spec] of Object.entries(after)) if (!(name in block)) block = placeDependency(block, name, spec);
  return block;
}
