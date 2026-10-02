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
  ],
};
