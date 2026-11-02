// 0.51.2 — a house Angular design system is born with no spec, so `nx test` on it exits 1.
//
// WHY IT FAILS. @nx/angular's library generator wrote a demo component and its spec; the design-system generator pruned
// both, because the library ships no components. The target it left is @nx/angular:unit-test, which throws "No tests
// found" on a library with no spec and has no passWithNoTests option (the schema refuses it: verified on @nx/angular
// 24.0.3 / @angular/build 22.2.5). Jest, the runner below Angular 21, passes on no specs, so its libraries never owed this.
//
// WHAT THIS DOES. The generator now seeds a real spec of DsTheme on creation; this rung gives it to the libraries already
// on disk. It adds a TEST, so it must not swap one red target for another: it adds only what it can tell will run and
// pass, and everything else is left and reported with its reason. Every house DsTheme ever shipped (ed399a8d, a4ca72cb,
// 94f13d27) passes the shape check below and this spec.
//
// SKIPPED, WITH A REPORT:
//   - no test target, or one with another executor: nothing fails for this reason;
//   - the target declares its own include/exclude: the project chose what is tested, so a spec may not even be picked up;
//   - any spec anywhere in the library: the target is not failing for this reason, and the file is never overwritten;
//   - no src/lib/ds-theme.service.ts, or a DsTheme reshaped past what the spec tests (the mode signal, the attribute it
//     writes and removes, the 'dark' and 'system' modes, no dependency TestBed would have to provide).
// Those last two leave the target red, which is why they warn and say what to do.
//
// SELF-CONTAINED by the migration contract: the tag and the spec are frozen copies, not imports from the generators.
import { type ProjectConfiguration, type Tree, getProjects, logger } from '@nx/devkit';

const TAG = '[migrate 0.51.2 seed-design-system-spec]';
const DESIGN_SYSTEM_TAG = 'type:design-system';
const EXECUTOR = '@nx/angular:unit-test';
const THEME = 'src/lib/ds-theme.service.ts';
const SPEC = 'src/lib/ds-theme.service.spec.ts';
/** The one thing a project's own spec could be called, whatever its extension. */
const ANY_SPEC = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
/** Never walked: an install or build output is not the library's own spec. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist']);
/** What DsTheme may inject and still construct in a bare TestBed. */
const PROVIDED_BY_TESTBED = new Set(['DOCUMENT', 'DestroyRef']);

export default function update(tree: Tree): void {
  for (const [name, project] of getProjects(tree)) {
    if (project.tags?.includes(DESIGN_SYSTEM_TAG)) seedSpec(tree, name, project);
  }
}

function seedSpec(tree: Tree, name: string, project: ProjectConfiguration): void {
  const target = project.targets?.test;
  if (!target) return logger.info(`${TAG} Left ${name}: it has no test target, so nothing fails on a missing spec.`);
  if (target.executor !== EXECUTOR) {
    return logger.info(`${TAG} Left ${name}: its test target uses ${target.executor ?? 'a command'}, not ${EXECUTOR}, the executor that fails with no spec.`);
  }
  if (target.options?.include || target.options?.exclude) {
    return logger.warn(`${TAG} Left ${name}: its test target declares its own include/exclude, so a seeded spec might not run. If \`nx test ${name}\` reports "No tests found", add a spec it matches.`);
  }
  const found = firstSpec(tree, project.root);
  if (found) return logger.info(`${TAG} Left ${name}: it already has a spec (${found}).`);

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

/** The first spec under the library, or null. */
function firstSpec(tree: Tree, dir: string): string | null {
  for (const child of tree.children(dir)) {
    const path = `${dir}/${child}`;
    if (tree.isFile(path)) {
      if (ANY_SPEC.test(child)) return path;
    } else if (!SKIPPED_DIRS.has(child) && !child.startsWith('.')) {
      const found = firstSpec(tree, path);
      if (found) return found;
    }
  }
  return null;
}

/** The attribute this DsTheme writes, when it still has everything the spec relies on; otherwise null. */
function modeAttribute(source: string): string | null {
  const attribute = /const MODE_ATTRIBUTE = '(data-[\w-]+-mode)'/.exec(source)?.[1];
  const modes = /export type DsMode\s*=([^;]*);/.exec(source)?.[1] ?? '';
  const holds =
    /@Injectable\(\{ providedIn: 'root' \}\)\s*export class DsTheme\b/.test(source) &&
    /readonly mode = signal<DsMode>\(/.test(source) &&
    /setAttribute\(MODE_ATTRIBUTE, mode\)/.test(source) &&
    /removeAttribute\(MODE_ATTRIBUTE\)/.test(source) &&
    modes.includes("'dark'") &&
    modes.includes("'system'") &&
    [...source.matchAll(/\binject\((\w+)/g)].every(([, token]) => PROVIDED_BY_TESTBED.has(token));
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
