// 0.51.2 — what `nx test` says about a house Angular design system is the truth: it exits 1 on a library with no spec, and
// exits 0 past a failing spec in an entry point.
//
// WHY. @nx/angular's library generator wrote a demo component and its spec; the design-system generator pruned both,
// because the library ships no components. The target it left is @nx/angular:unit-test, which throws "No tests found" on a
// library with no spec and has no passWithNoTests option (the schema refuses it: verified on @nx/angular 24.0.3 /
// @angular/build 22.2.5). It looks only under the project's source root (<library>/src), and a ds-component's spec is at
// <library>/<entry>/src: never run, so a failing one exits 0 beside a passing DsTheme spec.
//
// WHAT THIS DOES, as the generator now does on creation:
//   1. gives the target an include and exclude that reach every spec in the library. The include holds both halves: the
//      builder's glob reports a file under its cwd (the source root) by its cwd-relative path, which a `../` pattern never
//      matches, so `../**` alone finds the entry points and silently drops src. The exclude is needed because the
//      builder's own node_modules ignore does not match above its cwd either;
//   2. seeds a real spec of DsTheme where the library has none at all. That adds a TEST, so it must not swap one red
//      target for another: it adds only what it can tell will run and pass. Every house DsTheme ever shipped (ed399a8d,
//      a4ca72cb, 94f13d27) passes the shape check below and this spec.
//
// LEFT, WITH A REPORT:
//   - no test target, or one with another executor: neither change is known to be what that runner lacks (jest also exits
//     1 on no tests unless told otherwise, and Nx 24 infers its target, so no project config shows it);
//   - the target declares an include/exclude other than the above, in any configuration: the project chose what is
//     tested, so a seeded spec may not even be picked up, and an entry's spec may not either;
//   - a source root outside the library: `..` from there is not the library;
//   - any spec already in the library, and the file is never overwritten. One the runner matches is what the target runs;
//     one it does not leaves the target red, so that one warns;
//   - no src/lib/ds-theme.service.ts, or a DsTheme reshaped past what the spec tests (the mode signal, the root element
//     it writes the attribute to and removes it from, the 'dark' and 'system' modes, no dependency TestBed would have
//     to provide).
// What can leave the target red warns and says what to do.
//
// REPORTED, NEVER REPAIRED: `<entry>/src.ts` beside `<entry>/src/`, what ds-component wrote before 0.51.2 (it handed
// @nx/angular a directory where it reads a file). The barrel it wrote exports a file that does not exist, so that entry
// never built as generated; one that builds was fixed by hand, in a shape only its project knows.
//
// SELF-CONTAINED by the migration contract: the tag, the globs and the spec are frozen copies, not imports from the generators.
import { type ProjectConfiguration, type Tree, getProjects, logger, updateProjectConfiguration } from '@nx/devkit';

const TAG = '[migrate 0.51.2 seed-design-system-spec]';
const DESIGN_SYSTEM_TAG = 'type:design-system';
/** The name a hand-made or pre-tag design system goes by: a generator finds it by this, and tags it after this rung ran. */
const DESIGN_SYSTEM_NAME = 'design-system';
const EXECUTOR = '@nx/angular:unit-test';
const THEME = 'src/lib/ds-theme.service.ts';
const SPEC = 'src/lib/ds-theme.service.spec.ts';
/** The one thing a project's own spec could be called, whatever its extension. */
const ANY_SPEC = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
/** What the include below finds. */
const RUNNABLE_SPEC = /\.(?:spec|test)\.ts$/;
/** What the target is given: every spec in a library whose source root is `up` levels below its root. */
const includeFrom = (up: string) => ['**/*.spec.ts', '**/*.test.ts', `${up}**/*.spec.ts`, `${up}**/*.test.ts`];
const excludeFrom = (up: string) => [`${up}**/node_modules/**`, `${up}**/dist/**`];
/** Never walked: an install or build output is not the library's own spec. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist']);
/** What DsTheme may inject and still construct in a bare TestBed. */
const PROVIDED_BY_TESTBED = new Set(['DOCUMENT', 'DestroyRef']);

export default function update(tree: Tree): void {
  const projects = getProjects(tree);
  const tagged = [...projects].filter(([, project]) => project.tags?.includes(DESIGN_SYSTEM_TAG));
  const byName = projects.get(DESIGN_SYSTEM_NAME);
  const found = tagged.length || !byName || byName.projectType === 'application' ? tagged : [[DESIGN_SYSTEM_NAME, byName] as const];
  for (const [name, project] of found) {
    if (reachWholeLibrary(tree, name, project)) seedSpec(tree, name, project);
    reportStrayComponents(tree, name, project);
  }
}

/** Aims the target at every spec in the library. False when it is left as it is, and what it finds is not this rung's to judge. */
function reachWholeLibrary(tree: Tree, name: string, project: ProjectConfiguration): boolean {
  const target = project.targets?.test;
  if (!target) {
    logger.info(`${TAG} Left ${name}: its project config has no test target, and this is for ${EXECUTOR}. If an inferred runner reports no tests, add a spec.`);
    return false;
  }
  if (target.executor !== EXECUTOR) {
    logger.info(`${TAG} Left ${name}: its test target uses ${target.executor ?? 'a command'}, and this is for ${EXECUTOR}. If \`nx test ${name}\` reports no tests, add a spec.`);
    return false;
  }
  const sourceRoot = project.sourceRoot ?? `${project.root}/src`;
  const inside = sourceRoot === project.root || sourceRoot.startsWith(`${project.root}/`);
  if (!inside) {
    logger.warn(`${TAG} Left ${name}: its source root ${sourceRoot} is outside the library, so \`nx test ${name}\` may not run the specs of its entry points. Check that it does.`);
    return false;
  }
  const up = '../'.repeat(sourceRoot === project.root ? 0 : sourceRoot.slice(project.root.length + 1).split('/').length);
  const include = includeFrom(up);
  const exclude = excludeFrom(up);
  const ours = same(target.options?.include, include) && same(target.options?.exclude, exclude);
  const declared = [ours ? undefined : target.options, ...Object.values(target.configurations ?? {})].some((options) => options?.include || options?.exclude);
  if (declared) {
    logger.warn(
      `${TAG} Left ${name}: its test target declares its own include/exclude, so a seeded spec might not run, and neither might the specs of its entry points (at <library>/<entry>/src). ` +
        `If \`nx test ${name}\` reports "No tests found", add a spec it matches; to run every spec in the library, its include is ${JSON.stringify(include)}.`,
    );
    return false;
  }
  // A source root that IS the library: the runner's default already walks everything in it.
  if (up && !ours) {
    target.options = { ...target.options, include, exclude };
    updateProjectConfiguration(tree, name, project);
    logger.info(`${TAG} ${name}: its test target now runs every spec in the library. It looked only under ${sourceRoot}, so a failing spec in an entry point exited 0.`);
  }
  return true;
}

function same(actual: unknown, expected: string[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/** Says what ds-component left in an entry before 0.51.2; see REPORTED, NEVER REPAIRED above. */
function reportStrayComponents(tree: Tree, name: string, project: ProjectConfiguration): void {
  for (const child of tree.children(project.root)) {
    const entry = `${project.root}/${child}`;
    if (tree.isFile(entry) || SKIPPED_DIRS.has(child) || !tree.exists(`${entry}/src.ts`) || !tree.exists(`${entry}/src/index.ts`)) continue;
    logger.warn(
      `${TAG} ${name}: ${entry}/src.ts is what ds-component wrote before 0.51.2, beside the folder its barrel is in. If ${entry}/src/index.ts exports a file that does not exist, ` +
        `\`nx build ${name}\` fails on it: delete ${entry} and run \`nx g @bespunky/nx-tools:ds-component ${child}\`. If you fixed it by hand, its spec (${entry}/src.spec.ts) now runs too.`,
    );
  }
}

function seedSpec(tree: Tree, name: string, project: ProjectConfiguration): void {
  const runnable = firstSpec(tree, project.root, RUNNABLE_SPEC);
  if (runnable) return logger.info(`${TAG} Left ${name}: it already has a spec (${runnable}).`);
  const unmatched = firstSpec(tree, project.root, ANY_SPEC);
  if (unmatched) {
    return logger.warn(`${TAG} Left ${name}: it already has a spec (${unmatched}), but ${EXECUTOR} runs only *.spec.ts and *.test.ts, so \`nx test ${name}\` still fails with "No tests found". Add a spec it matches.`);
  }

  const themePath = `${project.root}/${THEME}`;
  if (!tree.exists(themePath)) {
    return logger.warn(`${TAG} Left ${name}: there is no ${themePath} to test, so \`nx test ${name}\` still fails with "No tests found". Add a spec of your own.`);
  }
  const attribute = modeAttribute(tree.read(themePath, 'utf8') ?? '');
  if (!attribute) {
    return logger.warn(`${TAG} Left ${name}: ${themePath} no longer has the shape the house spec tests, so \`nx test ${name}\` still fails with "No tests found". Add a spec of your own.`);
  }

  const specPath = `${project.root}/${SPEC}`;
  tree.write(specPath, spec(attribute));
  logger.info(`${TAG} wrote ${specPath}: \`nx test ${name}\` failed with "No tests found", and this is a real spec of the DsTheme the library ships.`);
}

/** The first file under `dir` `matching` accepts, or null. */
function firstSpec(tree: Tree, dir: string, matching: RegExp): string | null {
  for (const child of tree.children(dir)) {
    const path = `${dir}/${child}`;
    if (tree.isFile(path)) {
      if (matching.test(child)) return path;
    } else if (!SKIPPED_DIRS.has(child) && !child.startsWith('.')) {
      const found = firstSpec(tree, path, matching);
      if (found) return found;
    }
  }
  return null;
}

/** The attribute this DsTheme writes, when it still has everything the spec relies on; otherwise null. */
function modeAttribute(file: string): string | null {
  const source = file.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const attribute = /const MODE_ATTRIBUTE\s*=\s*['"](data-[^'"]+-mode)['"]/.exec(source)?.[1];
  const modes = /export type DsMode\s*=([^;]*);/.exec(source)?.[1] ?? '';
  const holds =
    /@Injectable\(\{\s*providedIn:\s*['"]root['"],?\s*\}\)\s*export class DsTheme\b/.test(source) &&
    /readonly mode = signal<DsMode>\(/.test(source) &&
    /const root = this\.document\.documentElement\b/.test(source) &&
    /root\.setAttribute\(MODE_ATTRIBUTE, mode\)/.test(source) &&
    /root\.removeAttribute\(MODE_ATTRIBUTE\)/.test(source) &&
    /['"]dark['"]/.test(modes) &&
    /['"]system['"]/.test(modes) &&
    !/\bconstructor\s*\(\s*[^)\s]/.test(source) &&
    [...source.matchAll(/\binject(?:<[^>]*>)?\(\s*(\w+)/g)].every(([, token]) => PROVIDED_BY_TESTBED.has(token));
  return attribute && holds ? attribute : null;
}

function spec(attribute: string): string {
  return `import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DsTheme } from './ds-theme.service';

describe('DsTheme', () => {
  const MODE_ATTRIBUTE = '${attribute}';

  const root = () => TestBed.inject(DOCUMENT).documentElement;

  afterEach(() => root().removeAttribute(MODE_ATTRIBUTE));

  it('writes the chosen mode to the document', () => {
    const theme = TestBed.inject(DsTheme);

    theme.mode.set('dark');
    TestBed.tick();

    expect(root().getAttribute(MODE_ATTRIBUTE)).toBe('dark');
  });

  it("removes the attribute for 'system', so the design system's default takes over", () => {
    const theme = TestBed.inject(DsTheme);

    theme.mode.set('dark');
    TestBed.tick();
    theme.mode.set('system');
    TestBed.tick();

    expect(root().hasAttribute(MODE_ATTRIBUTE)).toBe(false);
  });
});
`;
}
