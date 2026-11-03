// 0.51.2 — what `nx test` says about a house Angular library is the truth: it exits 1 on a design system with no spec, and
// on any library with entry points it exits 0 past a failing spec in one of them. A library with none today is the same
// the day someone adds one, by hand or through @nx/angular, where no house generator is there to say anything.
//
// WHY. @nx/angular:unit-test looks only under the project's source root (<library>/src), and a secondary entry point lives
// beside it, at <library>/<entry>, where `secondary-entrypoint --component=standalone` and ds-component write a spec. So
// that spec never runs: a failing one exits 0 beside any passing spec in src. Separately, @nx/angular's library generator
// wrote a demo component and its spec, and the design-system generator pruned both, because the library ships no
// components; the executor throws "No tests found" on a library with no spec and has no passWithNoTests option (the schema
// refuses it: verified on @nx/angular 24.0.3 / @angular/build 22.2.5).
//
// WHAT THIS DOES, for every library on this executor, entry points or not, and for every design system:
//   1. gives the target an include and exclude that reach every spec in the library. The include holds both halves: the
//      builder's glob reports a file under its cwd (the source root) by its cwd-relative path, which a `../` pattern never
//      matches, so `../**` alone finds the entry points and silently drops src. The exclude is needed because the
//      builder's own node_modules ignore does not match above its cwd either. That can turn a green target red, truthfully,
//      so the specs that start running are named. The Angular library port now states the same at birth. With no entry and no
//      spec it changes nothing: src is still in the include, and the target still throws "No tests found" (verified). Whatever the
//      target now reaches also goes in the include of tsconfig.spec.json, if it states one: every entry's src, not only
//      its specs, because a composite project (a TS-solution workspace) must list what they import or typecheck fails
//      TS6307. The runner does not need that (it hands the compiler the specs it found, and type-checks them either way:
//      verified); the editor and `tsc` do, because tsconfig.lib.json excludes specs, which leaves an entry's in no project
//      of the library. A spec with a type error fails `nx test` already, so typecheck only agrees with it;
//   2. for a design system only, seeds a real spec of DsTheme where the library has none at all. That adds a TEST, so it
//      must not swap one red target for another: it adds only what it can tell will run and pass. Every house DsTheme ever
//      shipped (ed399a8d, a4ca72cb, 94f13d27) passes the shape check below and this spec.
//
// LEFT, WITH A REPORT:
//   - no test target, or one with another executor (a library that is not a design system is only mentioned when it has entry points): neither change is known to be what that runner lacks (jest also exits
//     1 on no tests unless told otherwise, and Nx 24 infers its target, so no project config shows it);
//     pass-libraries-with-no-specs, the next rung, tells those runners what they can be told. A library with entry points
//     on anything but Jest, whose root is the library, is told that its entry points' specs may not run;
//   - the target declares an include/exclude other than the above, in any configuration: the project chose what is
//     tested, so a seeded spec may not even be picked up, and an entry's spec may not either;
//   - a source root outside the library: `..` from there is not the library;
//   - a library with no entry point and another project inside it (one at the workspace root holds them all): the include
//     would run that project's specs as well, on the wrong runner, for an entry point that does not exist yet;
//   - any spec already in the library, and the file is never overwritten. One the runner matches is what the target runs;
//     one it does not leaves the target red, so that one warns;
//   - no src/lib/ds-theme.service.ts, or a DsTheme reshaped past what the spec tests (the mode signal, the root element
//     it writes the attribute to and removes it from, the 'dark' and 'system' modes, no dependency TestBed would have
//     to provide).
// What can leave the target red warns and says what to do.
//
// NOT THIS RUNG'S: an application (it has no entry points; a library's beside it is the library's), and what lies inside
// another project's root, which is that project's, on its own runner.
//
// REPORTED, NEVER REPAIRED: `<entry>/src.ts` beside `<entry>/src/`, what secondary-entrypoint and ds-component wrote before
// 0.51.2 (they handed @nx/angular a directory where it reads a file). The barrel they wrote exports a file that does not exist, so that entry
// never built as generated; one that builds was fixed by hand, in a shape only its project knows.
//
// FROZEN by the migration contract: the tag, the globs and the spec are copies, not imports from the generators. What it
// shares with them is the pure mechanics that take those values as parameters, and the question of what a project is.
import { type ProjectConfiguration, type TargetConfiguration, type Tree, getProjects, logger } from '@nx/devkit';
import { type SpecTsconfig, holdEntrySources, judgeEntryPointReach } from '../../adapters/angular/entry-point-reach';
import { projectRole } from '../../adapters/registry';
import { filesOfLibrary, firstMatching, normalizedPath, otherProjectRoots, under } from '../../generators/_utils/library-files';
import { updateJsonInPlace } from '../../generators/_utils/json-edits';
import { updateProjectConfigInPlace } from '../../generators/_utils/project-files';

const TAG = '[migrate 0.51.2 truthful-angular-library-tests]';
const DESIGN_SYSTEM_TAG = 'type:design-system';
/** The name a hand-made or pre-tag design system goes by: a generator finds it by this, and tags it after this rung ran. */
const DESIGN_SYSTEM_NAME = 'design-system';
const EXECUTOR = '@nx/angular:unit-test';
/** The same builder, under the name an Angular CLI library brings. */
const UNIT_TEST_EXECUTORS = new Set([EXECUTOR, '@angular/build:unit-test']);
/** Walks the whole library, so entry points are nothing to it. */
const WALKS_THE_LIBRARY = new Set(['@nx/jest:jest']);
const ENTRY_POINT = 'ng-package.json';
const THEME = 'src/lib/ds-theme.service.ts';
const SPEC = 'src/lib/ds-theme.service.spec.ts';
/** The one thing a project's own spec could be called, whatever its extension. */
const ANY_SPEC = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
/** What the include below finds. */
const RUNNABLE_SPEC = /\.(?:spec|test)\.ts$/;
/** What the target is given: every spec in a library whose source root `up` climbs out of. */
const includeFrom = (up: string) => ['**/*.spec.ts', '**/*.test.ts', `${up}**/*.spec.ts`, `${up}**/*.test.ts`];
const excludeFrom = (up: string) => [`${up}**/node_modules/**`, `${up}dist/**`];
/** For tsconfig.spec.json, which is relative to the library. */
const ENTRY_SOURCES = '**/src/**/*.ts';
const SPEC_TSCONFIG = 'tsconfig.spec.json';
/** ENTRY_SOURCES also matches a build output at the library's root. Only there: a folder of that name inside an entry may hold a source. */
const NOT_SOURCES = 'dist/**';
/** What DsTheme may inject and still construct in a bare TestBed. */
const PROVIDED_BY_TESTBED = new Set(['DOCUMENT', 'DestroyRef']);

export default function update(tree: Tree): void {
  const projects = getProjects(tree);
  const tagged = [...projects.keys()].filter((name) => projects.get(name)?.tags?.includes(DESIGN_SYSTEM_TAG));
  const designSystems = new Set(tagged.length || projectRole(tree, DESIGN_SYSTEM_NAME) !== 'library' ? tagged : [DESIGN_SYSTEM_NAME]);
  for (const [name, project] of projects) {
    const stops = otherProjectRoots(projects.values(), project.root);
    if (designSystems.has(name)) {
      if (reachDesignSystem(tree, name, project, stops)) seedSpec(tree, name, project, stops);
      reportStrayComponents(tree, name, project, true);
    } else if (project.targets && projectRole(tree, name) !== 'application') {
      const entries = hasEntryPoints(tree, project, stops);
      if (!entries && projectRole(tree, name) !== 'library') continue;
      const runners = unitTestTargets(project);
      const nested = entries ? [] : projectsInside(project, stops);
      if (runners.length && nested.length) reportNested(name, nested);
      else for (const [targetName, target] of runners) reachWholeLibrary(tree, name, project, targetName, target, stops);
      if (entries) {
        if (runners.length === 0) reportOtherRunner(name, project);
        reportStrayComponents(tree, name, project, false);
      }
    }
  }
}

function sourceRootOf(project: ProjectConfiguration): string {
  return normalizedPath(project.sourceRoot ?? under(normalizedPath(project.root), 'src'));
}

function unitTestTargets(project: ProjectConfiguration): [string, TargetConfiguration][] {
  return Object.entries(project.targets ?? {}).filter(([, target]) => UNIT_TEST_EXECUTORS.has(target.executor ?? ''));
}

/** A secondary entry point: an ng-package.json below the library's own, outside what the runner already walks. */
function hasEntryPoints(tree: Tree, project: ProjectConfiguration, stops: ReadonlySet<string>): boolean {
  const own = under(normalizedPath(project.root), ENTRY_POINT);
  for (const file of filesOfLibrary(tree, project.root, new Set([...stops, sourceRootOf(project)]))) {
    if (file !== own && file.endsWith(`/${ENTRY_POINT}`)) return true;
  }
  return false;
}

/** The projects whose roots lie inside this one's. */
function projectsInside(project: ProjectConfiguration, stops: ReadonlySet<string>): string[] {
  const root = normalizedPath(project.root);
  return [...stops].filter((other) => !root || other.startsWith(`${root}/`));
}

function reportNested(name: string, nested: string[]): void {
  logger.warn(`${TAG} Left ${name}: other projects live inside it (${nested.join(', ')}), and reaching every spec in the library would run theirs too. It has no entry point today; if it gains one, \`nx g @bespunky/nx-tools:secondary-entrypoint\` or an include of your own is what runs that entry's specs.`);
}

function reportOtherRunner(name: string, project: ProjectConfiguration): void {
  const test = project.targets?.test;
  if (!test || WALKS_THE_LIBRARY.has(test.executor ?? '')) return;
  logger.warn(`${TAG} Left ${name}: its test target uses ${test.executor ?? 'a command'}, so \`nx test ${name}\` may not run the specs of its entry points (at <library>/<entry>). Check that it does.`);
}

/** The design system's test targets decide whether a spec can be seeded. False when none is aimed, and what they find is not this rung's to judge. */
function reachDesignSystem(tree: Tree, name: string, project: ProjectConfiguration, stops: ReadonlySet<string>): boolean {
  const runners = unitTestTargets(project);
  if (runners.length) return runners.map(([targetName, target]) => reachWholeLibrary(tree, name, project, targetName, target, stops)).some(Boolean);
  const target = project.targets?.test;
  if (!target) {
    logger.info(`${TAG} Left ${name}: its project config has no test target, and this is for ${EXECUTOR}. An inferred runner that can pass on no tests is told to by pass-libraries-with-no-specs, in this same upgrade.`);
  } else {
    logger.info(`${TAG} Left ${name}: its test target uses ${target.executor ?? 'a command'}, and this is for ${EXECUTOR}. pass-libraries-with-no-specs, in this same upgrade, tells a runner that can pass on no tests to, and says so where it cannot.`);
  }
  return false;
}

/** Aims the target at every spec in the library. False when it is left as it is. */
function reachWholeLibrary(tree: Tree, name: string, project: ProjectConfiguration, targetName: string, target: TargetConfiguration, stops: ReadonlySet<string>): boolean {
  const command = `nx ${targetName} ${name}`;
  const reach = judgeEntryPointReach(project, target, includeFrom, excludeFrom);
  if (reach.kind === 'outside') {
    logger.warn(`${TAG} Left ${name}: its source root ${reach.sourceRoot} is outside the library, so \`${command}\` may not run the specs of its entry points. Check that it does.`);
    return false;
  }
  if (reach.kind === 'declared') {
    logger.warn(
      `${TAG} Left ${name}: its ${targetName} target declares its own include/exclude, so it may not run every spec in the library, the specs of its entry points (at <library>/<entry>/src) among them. ` +
        `If \`${command}\` reports "No tests found", add a spec it matches; to run every spec, its include is ${JSON.stringify(reach.include)} and its exclude ${JSON.stringify(reach.exclude)}.`,
    );
    return false;
  }
  if (reach.kind === 'aim') {
    updateProjectConfigInPlace(tree, project.root, (config) => {
      config.targets = { ...config.targets, [targetName]: { ...config.targets?.[targetName], options: { ...target.options, include: reach.include, exclude: reach.exclude } } };
    });
    const sourceRoot = sourceRootOf(project);
    const started = specsOutside(tree, project.root, new Set([...stops, sourceRoot]));
    const log = started.length ? logger.warn : logger.info;
    log(
      `${TAG} ${name}: \`${command}\` now runs every spec in the library. It looked only under ${sourceRoot}, where an entry point's specs are not, so a failing one exited 0.` +
        (started.length ? ` These start running now, and it is the truth if one fails: ${started.join(', ')}.` : ''),
    );
  }
  includeEntrySourcesInSpecTsconfig(tree, project.root);
  return true;
}

/** In place, because it may hold comments. */
function includeEntrySourcesInSpecTsconfig(tree: Tree, root: string): void {
  const file = under(normalizedPath(root), SPEC_TSCONFIG);
  if (!tree.exists(file)) return;
  const wrote = updateJsonInPlace<SpecTsconfig>(tree, file, (json) => holdEntrySources(json, ENTRY_SOURCES, NOT_SOURCES));
  if (wrote) logger.info(`${TAG} ${file}: its include now holds the entry points' sources, so \`tsc\` and the editor see their specs. In a TS-solution workspace, \`nx typecheck\` checks them too.`);
}

/** Every spec the target's default did not reach: under the library, outside its source root and other projects. */
function specsOutside(tree: Tree, root: string, stops: ReadonlySet<string>): string[] {
  return [...filesOfLibrary(tree, root, stops)].filter((file) => RUNNABLE_SPEC.test(file));
}

/** Says what an earlier generator left in an entry; see REPORTED, NEVER REPAIRED above. */
function reportStrayComponents(tree: Tree, name: string, project: ProjectConfiguration, designSystem: boolean): void {
  const root = normalizedPath(project.root);
  for (const child of tree.children(root || '.')) {
    const entry = under(root, child);
    if (tree.isFile(entry) || child === 'node_modules' || child === 'dist' || !tree.exists(`${entry}/src.ts`) || !tree.exists(`${entry}/src/index.ts`)) continue;
    const remake = designSystem ? `nx g @bespunky/nx-tools:ds-component ${child}` : `nx g @bespunky/nx-tools:secondary-entrypoint --library=${name} --name=${child} --component=standalone`;
    logger.warn(
      `${TAG} ${name}: ${entry}/src.ts is what ${designSystem ? 'ds-component' : 'secondary-entrypoint'} wrote before 0.51.2, beside the folder its barrel is in. If ${entry}/src/index.ts exports a file that does not exist, ` +
        `\`nx build ${name}\` fails on it: delete ${entry} and run \`${remake}\`. If you fixed it by hand, its spec (${entry}/src.spec.ts) runs once the test target reaches it.`,
    );
  }
}

function seedSpec(tree: Tree, name: string, project: ProjectConfiguration, stops: ReadonlySet<string>): void {
  const root = normalizedPath(project.root);
  const files = [...filesOfLibrary(tree, root, stops)];
  const runnable = firstMatching(files, RUNNABLE_SPEC);
  if (runnable) return logger.info(`${TAG} Left ${name}: it already has a spec (${runnable}).`);
  const unmatched = firstMatching(files, ANY_SPEC);
  if (unmatched) {
    return logger.warn(`${TAG} Left ${name}: it already has a spec (${unmatched}), but ${EXECUTOR} runs only *.spec.ts and *.test.ts, so \`nx test ${name}\` still fails with "No tests found". Add a spec it matches.`);
  }

  const themePath = under(root, THEME);
  if (!tree.exists(themePath)) {
    return logger.warn(`${TAG} Left ${name}: there is no ${themePath} to test, so \`nx test ${name}\` still fails with "No tests found". Add a spec of your own.`);
  }
  const attribute = modeAttribute(tree.read(themePath, 'utf8') ?? '');
  if (!attribute) {
    return logger.warn(`${TAG} Left ${name}: ${themePath} no longer has the shape the house spec tests, so \`nx test ${name}\` still fails with "No tests found". Add a spec of your own.`);
  }

  const specPath = under(root, SPEC);
  tree.write(specPath, spec(attribute));
  logger.info(`${TAG} wrote ${specPath}: \`nx test ${name}\` failed with "No tests found", and this is a real spec of the DsTheme the library ships.`);
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
