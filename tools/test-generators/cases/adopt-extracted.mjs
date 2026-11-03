// ADOPT-EXTRACTED — a local library is replaced by its published package. Under `workspaces` that crosses the link:
// the consumers' workspace range (`*` / `workspace:*`) must become the PUBLISHED range, `--finalize` must refuse while
// only the link stands behind the name (it would delete the only thing that resolves it), and finalizing must leave
// no link range behind — which, once the local package is gone, would silently ask the registry instead.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, LINK_RANGE, aliases, references, SCOPE } from '../workspaces.mjs';

const { updateJson, writeJson } = requireFromRepo('@nx/devkit');
const CORE = `@${SCOPE}/core`;
const adopt = (ctx) => ctx.load('generators/adopt-extracted/generator').default;

/** A js-layer workspace with a local `core` library linked into a sibling library and an app. */
function linkedCore(link, ctx) {
  const tree = workspace({ link });
  updateJson(tree, 'package.json', (json) => ({ ...json, devDependencies: { ...json.devDependencies, '@nx/js': '23.1.0' } }));
  const linking = ctx.load('generators/_utils/linking').workspaceLinking(tree);
  if (linking.kind === 'workspaces') {
    writeJson(tree, 'packages/core/package.json', { name: CORE, version: '0.0.1', nx: { name: 'core' } });
    writeJson(tree, 'packages/ui/package.json', { name: `@${SCOPE}/ui`, version: '0.0.1' });
  } else {
    writeJson(tree, 'packages/core/project.json', { name: 'core', root: 'packages/core', projectType: 'library', targets: {} });
    writeJson(tree, 'packages/ui/project.json', { name: 'ui', root: 'packages/ui', projectType: 'library', targets: {} });
  }
  writeJson(tree, 'packages/core/tsconfig.lib.json', {});
  tree.write('packages/core/src/index.ts', 'export const core = 1;\n');
  tree.write('packages/ui/src/index.ts', `import { core } from '${CORE}';\nexport const ui = core;\n`);
  writeJson(tree, 'apps/shop/project.json', { name: 'shop', root: 'apps/shop', projectType: 'application', targets: {} });
  linking.link(tree, { importPath: CORE, libRoot: 'packages/core', consumerRoot: 'packages/ui' });
  linking.link(tree, { importPath: CORE, libRoot: 'packages/core', consumerRoot: 'apps/shop' });
  return tree;
}

/** The library's only spec is under src/lib, which --keepShim deletes. */
function unitTestShim(ctx, executor, targetName = 'test') {
  const tree = linkedCore('paths', ctx);
  updateJson(tree, 'packages/core/project.json', (json) => ({ ...json, targets: { build: { executor: '@nx/angular:package' }, [targetName]: { executor } } }));
  tree.write('packages/core/src/lib/core.spec.ts', "it('x', () => {});\n");
  return tree;
}

export default {
  name: 'adopt-extracted · link range → published range',
  cases: [
    ...['workspaces-npm', 'workspaces-pnpm'].flatMap((link) => [
      {
        name: `${link}: adopting swaps the link range for the published one`,
        setup: (ctx) => linkedCore(link, ctx),
        run: async (tree, ctx) => adopt(ctx)(tree, { lib: 'core', package: CORE, version: '^1.2.0' }),
        expect: (tree, t) => t.equal(t.json('package.json').dependencies?.[CORE], '^1.2.0', 'root (the app\'s governing manifest)'),
      },
      {
        name: `${link}: --finalize refuses while only the workspace link stands behind the name`,
        once: 'the operation throws by design',
        setup: (ctx) => linkedCore(link, ctx),
        run: async (tree, ctx) => {
          try {
            await adopt(ctx)(tree, { lib: 'core', package: CORE, finalize: true });
          } catch (error) {
            ctx.error = error.message;
          }
        },
        expect: (tree, t, ctx) => {
          t.ok(/only the local workspace link/.test(ctx.error ?? ''), `did not refuse: ${ctx.error}`);
          t.exists('packages/core/src/index.ts');
          t.equal(t.json('package.json').dependencies?.[CORE], LINK_RANGE[link], 'nothing changed');
        },
      },
      {
        name: `${link}: --finalize removes the library and every link range, keeps the published range`,
        once: 'finalizing DELETES the library — there is nothing left for a second run to act on',
        setup: async (ctx) => {
          const tree = linkedCore(link, ctx);
          await adopt(ctx)(tree, { lib: 'core', package: CORE, version: '^1.2.0' });
          return tree;
        },
        run: async (tree, ctx) => adopt(ctx)(tree, { lib: 'core', package: CORE, finalize: true }),
        expect: (tree, t) => {
          t.missing('packages/core/package.json');
          t.equal(t.json('package.json').dependencies?.[CORE], '^1.2.0', 'the published range stays');
          t.equal(t.json('packages/ui/package.json').dependencies?.[CORE], undefined, 'no stale link range');
          t.ok(!references(tree).includes('./packages/core'), 'the solution reference is gone');
        },
      },
    ]),
    {
      name: 'paths: --finalize removes the library and its alias',
      once: 'finalizing DELETES the library — there is nothing left for a second run to act on',
      setup: async (ctx) => {
        const tree = linkedCore('paths', ctx);
        await adopt(ctx)(tree, { lib: 'core', package: CORE, version: '^1.2.0' });
        updateJson(tree, 'package.json', (json) => ({ ...json, dependencies: { ...json.dependencies, [CORE]: '^1.2.0' } }));
        return tree;
      },
      run: async (tree, ctx) => adopt(ctx)(tree, { lib: 'core', package: CORE, finalize: true }),
      expect: (tree, t) => {
        t.missing('packages/core/project.json');
        t.ok(!aliases(tree)[CORE], `alias left: ${JSON.stringify(aliases(tree))}`);
        t.equal(t.json('package.json').dependencies?.[CORE], '^1.2.0', 'the published range stays');
      },
    },
    {
      name: '--keepShim: the implementation and its spec go, so the runner is told none is not a failure',
      setup: (ctx) => {
        const tree = linkedCore('paths', ctx);
        tree.write('packages/core/src/lib/core.ts', 'export const core = 1;\n');
        tree.write('packages/core/src/lib/core.spec.ts', "it('x', () => {});\n");
        tree.write('packages/core/vite.config.mts', 'export default {\n  test: {\n    watch: false,\n  },\n};\n');
        return tree;
      },
      run: async (tree, ctx) => adopt(ctx)(tree, { lib: 'core', package: CORE, version: '^1.2.0', keepShim: true }),
      expect: (tree, t) => {
        t.missing('packages/core/src/lib/core.spec.ts');
        t.has('packages/core/vite.config.mts', 'passWithNoTests: true,');
        t.equal(t.json('packages/core/extraction.json').status, 'adopted-shim', 'status');
      },
    },
    {
      name: '--keepShim: a spec the library keeps outside src/lib still counts, so nothing is stated',
      setup: (ctx) => {
        const tree = linkedCore('paths', ctx);
        tree.write('packages/core/tests/keep.spec.ts', "it('x', () => {});\n");
        tree.write('packages/core/vite.config.mts', 'export default {\n  test: {\n    watch: false,\n  },\n};\n');
        return tree;
      },
      run: async (tree, ctx) => adopt(ctx)(tree, { lib: 'core', package: CORE, version: '^1.2.0', keepShim: true }),
      expect: (tree, t) => t.ok(!t.read('packages/core/vite.config.mts').includes('passWithNoTests'), 'stated over a spec'),
    },
    ...['@nx/angular:unit-test', '@angular/build:unit-test'].map((executor) => ({
      name: `--keepShim on ${executor}, no spec left: it cannot pass on no tests, so its target goes, and why is said`,
      setup: (ctx) => unitTestShim(ctx, executor),
      run: async (tree, ctx) => adopt(ctx)(tree, { lib: 'core', package: CORE, version: '^1.2.0', keepShim: true }),
      expect: (tree, t, ctx) => {
        t.equal(Object.keys(t.json('packages/core/project.json').targets), ['build'], 'only the test target went');
        t.ok(ctx.logs.some((line) => line.includes('Removed the test target of "core"') && line.includes('No tests found')), `said: ${ctx.logs.join(' | ')}`);
        t.ok(!ctx.logs.some((line) => line.includes('Could not set passWithNoTests')), `nothing left to warn of: ${ctx.logs.join(' | ')}`);
      },
    })),
    {
      name: '--keepShim: the same runner under another name goes too',
      setup: (ctx) => unitTestShim(ctx, '@nx/angular:unit-test', 'unit'),
      run: async (tree, ctx) => adopt(ctx)(tree, { lib: 'core', package: CORE, version: '^1.2.0', keepShim: true }),
      expect: (tree, t) => t.equal(Object.keys(t.json('packages/core/project.json').targets), ['build'], 'only that target went'),
    },
    {
      name: '--keepShim on the unit-test builder, a spec kept outside src/lib: the target stays, it has something to run',
      setup: (ctx) => {
        const tree = unitTestShim(ctx, '@nx/angular:unit-test');
        tree.write('packages/core/testing/src/keep.spec.ts', "it('x', () => {});\n");
        return tree;
      },
      run: async (tree, ctx) => adopt(ctx)(tree, { lib: 'core', package: CORE, version: '^1.2.0', keepShim: true }),
      expect: (tree, t) => t.equal(t.json('packages/core/project.json').targets.test.executor, '@nx/angular:unit-test', 'kept'),
    },
    {
      name: '--keepShim on another command: it may read neither, so it stays, and the warning stands',
      setup: (ctx) => unitTestShim(ctx, 'nx:run-commands'),
      run: async (tree, ctx) => adopt(ctx)(tree, { lib: 'core', package: CORE, version: '^1.2.0', keepShim: true }),
      expect: (tree, t, ctx) => {
        t.equal(t.json('packages/core/project.json').targets.test.executor, 'nx:run-commands', 'kept');
        t.ok(ctx.logs.some((line) => line.includes('Could not set passWithNoTests')), `warned: ${ctx.logs.join(' | ')}`);
      },
    },
  ],
};
