// THE LINKING PORT — link / resolve / importPathOf / isLinkRange / unlink, in every layout × linking cell.
//
// What "linked" means differs completely between the two strategies, and the port's promise is that a generator
// never has to know which one it is in:
//   paths       one alias per specifier in the root tsconfig (subpaths get their own);
//   workspaces  membership (a glob covers the library) + identity (its package.json name and `exports`, the source
//               under the workspace's custom condition) + a solution reference + the consumer's DEPENDENCY on it.
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, MATRIX, RESOLVED, LINKINGS, LINK_RANGE, workspaceGlobs, references, aliases, SCOPE } from '../workspaces.mjs';

const { writeJson, readJson } = requireFromRepo('@nx/devkit');
const UI = `@${SCOPE}/ui`;

/**
 * A source library and the app that consumes it, in the cell's own directories. Under `workspaces` the app is a
 * package that has JOINED the workspace — what the app generator does for every app it creates (`joinWorkspace`);
 * a package.json outside every glob is not a project Nx (or `unlink`'s project scan) can see at all.
 */
function cell({ layout, link }, ctx) {
  const tree = workspace({ layout, link });
  const lib = `${RESOLVED[layout].libsDir}/ui`;
  const app = `${RESOLVED[layout].appsDir}/web`;
  tree.write(`${lib}/src/index.ts`, 'export const ui = 1;\n');
  tree.write(`${lib}/testing/src/index.ts`, 'export const fake = 1;\n');
  if (LINKINGS[link].linking === 'paths') {
    writeJson(tree, `${lib}/project.json`, { name: 'ui', root: lib, projectType: 'library', targets: {} });
    writeJson(tree, `${app}/project.json`, { name: 'web', root: app, projectType: 'application', targets: {} });
  } else {
    writeJson(tree, `${app}/package.json`, { name: `@${SCOPE}/web`, version: '0.0.0' });
    ctx.load('generators/_utils/project-files').joinWorkspace(tree, app);
  }
  return { tree, lib, app };
}

const port = (ctx, tree) => ctx.load('generators/_utils/linking').workspaceLinking(tree);

const linkCases = MATRIX.map((m) => ({
  name: `${m.label}: link (+ subpath) makes the specifier resolve, both ways`,
  setup: (ctx) => {
    const { tree, lib, app } = cell(m, ctx);
    Object.assign(ctx, { lib, app });
    return tree;
  },
  run: (tree, ctx) => {
    const linking = port(ctx, tree);
    linking.link(tree, { importPath: UI, libRoot: ctx.lib, consumerRoot: ctx.app });
    linking.link(tree, { importPath: UI, libRoot: ctx.lib, subpath: 'testing' });
    ctx.kind = linking.kind;
    ctx.resolved = linking.resolve(tree, UI);
    ctx.importPath = linking.importPathOf(tree, ctx.lib);
    ctx.linkRange = LINK_RANGE[m.link] ? linking.isLinkRange(tree, LINK_RANGE[m.link]) : undefined;
    ctx.starIsLink = linking.isLinkRange(tree, '*');
  },
  expect: (tree, t, ctx) => {
    const { lib, app } = ctx;
    t.equal(ctx.kind, LINKINGS[m.link].linking, 'strategy');
    t.equal(ctx.resolved, lib, 'resolve(specifier)');
    t.equal(ctx.importPath, UI, 'importPathOf(root)');
    if (ctx.kind === 'paths') {
      t.equal(aliases(tree)[UI], [`${lib}/src/index.ts`], 'the package alias');
      t.equal(aliases(tree)[`${UI}/testing`], [`${lib}/testing/src/index.ts`], 'the subpath alias');
      t.missing(`${lib}/package.json`);
      t.ok(!tree.exists(`${app}/package.json`), 'paths writes nothing per consumer');
      t.ok(ctx.starIsLink === false, 'paths declares no dependencies, so no range is a link range');
    } else {
      const manifest = t.json(`${lib}/package.json`);
      t.equal(manifest.name, UI, 'the package name IS the import path');
      t.equal(manifest.exports['.'], { [`@${SCOPE}/source`]: './src/index.ts', types: './src/index.ts', default: './src/index.ts' }, 'exports["."]');
      t.equal(Object.keys(manifest.exports['./testing'] ?? {})[0], `@${SCOPE}/source`, 'the subpath export, source condition first');
      t.equal(manifest.exports['./testing']?.[`@${SCOPE}/source`], './testing/src/index.ts', 'exports["./testing"]');
      t.ok(workspaceGlobs(tree).some((g) => lib.startsWith(g.replace(/\*$/, '')) || g === lib), `${lib} is a member: ${workspaceGlobs(tree)}`);
      t.ok(references(tree).includes(`./${lib}`), `solution references ./${lib}: ${references(tree)}`);
      t.equal(t.json(`${app}/package.json`).dependencies, { [UI]: LINK_RANGE[m.link] }, 'the consumer depends on it');
      t.ok(ctx.linkRange === true, `${LINK_RANGE[m.link]} is this package manager's link range`);
      t.ok(ctx.starIsLink === (m.link === 'workspaces-npm'), `"*" is a link range only where it is the spec (${m.link})`);
      t.ok(!Object.keys(aliases(tree)).includes(UI), 'no path alias under workspaces');
    }
  },
}));

const unlinkCases = MATRIX.map((m) => ({
  name: `${m.label}: unlink removes exactly what link wrote`,
  setup: (ctx) => {
    const { tree, lib, app } = cell(m, ctx);
    Object.assign(ctx, { lib, app });
    const linking = port(ctx, tree);
    linking.link(tree, { importPath: UI, libRoot: lib, consumerRoot: app });
    linking.link(tree, { importPath: UI, libRoot: lib, subpath: 'testing' });
    // A registry range somebody else declared on the same name — not ours to remove.
    if (linking.kind === 'workspaces') {
      writeJson(tree, 'packages/other/package.json', { name: `@${SCOPE}/other`, dependencies: { [UI]: '^2.0.0' } });
    }
    return tree;
  },
  run: (tree, ctx) => port(ctx, tree).unlink(tree, { importPath: UI, libRoot: ctx.lib }),
  expect: (tree, t, ctx) => {
    const { lib, app } = ctx;
    t.ok(!Object.keys(aliases(tree)).some((a) => a === UI || a.startsWith(`${UI}/`)), `aliases left: ${Object.keys(aliases(tree))}`);
    if (LINKINGS[m.link].linking === 'workspaces') {
      t.ok(!references(tree).includes(`./${lib}`), 'reference removed');
      t.equal(t.json(`${app}/package.json`).dependencies, {}, 'the link range is gone');
      t.equal(t.json('packages/other/package.json').dependencies, { [UI]: '^2.0.0' }, 'a registry range stays');
      t.ok(ctx.logs.some((l) => l.includes('Kept packages/other/package.json')), `the kept range is reported: ${ctx.logs.join(' | ')}`);
    }
  },
}));

export default {
  name: 'linking · the port',
  cases: [
    ...linkCases,
    ...unlinkCases,
    {
      name: 'paths: an existing alias spelled `./packages/x/…` is the same target — no false "kept the existing alias"',
      setup: () => {
        const tree = workspace();
        const json = readJson(tree, 'tsconfig.base.json');
        json.compilerOptions.paths = { '@acme/x': ['./packages/x/src/index.ts'] };
        writeJson(tree, 'tsconfig.base.json', json);
        return tree;
      },
      run: (tree, ctx) => port(ctx, tree).link(tree, { importPath: '@acme/x', libRoot: 'packages/x' }),
      expect: (tree, t, ctx) => {
        t.ok(!ctx.logs.some((l) => l.includes('Kept the existing')), `false warning: ${ctx.logs.join(' | ')}`);
        t.equal(aliases(tree)['@acme/x'], ['./packages/x/src/index.ts'], 'the alias is untouched');
      },
    },
    {
      name: 'paths: an alias that points ELSEWHERE is kept, and said out loud',
      setup: () => {
        const tree = workspace();
        const json = readJson(tree, 'tsconfig.base.json');
        json.compilerOptions.paths = { '@acme/x': ['packages/x/src/index.ts'] };
        writeJson(tree, 'tsconfig.base.json', json);
        return tree;
      },
      run: (tree, ctx) => port(ctx, tree).link(tree, { importPath: '@acme/x', libRoot: 'packages/y' }),
      expect: (tree, t, ctx) => {
        t.ok(ctx.logs.some((l) => l.includes('Kept the existing path alias "@acme/x"')), `not reported: ${ctx.logs.join(' | ')}`);
        t.equal(aliases(tree)['@acme/x'], ['packages/x/src/index.ts'], 'never silently replaced');
      },
    },
    {
      name: 'workspaces: a dist-pointing `exports` gets the source condition FIRST (conditions match in key order)',
      setup: () => {
        const tree = workspace({ link: 'workspaces-npm' });
        writeJson(tree, 'packages/ui/package.json', { name: UI, exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } });
        return tree;
      },
      run: (tree, ctx) => port(ctx, tree).link(tree, { importPath: UI, libRoot: 'packages/ui' }),
      expect: (tree, t) => {
        const entry = t.json('packages/ui/package.json').exports['.'];
        t.equal(Object.keys(entry), [`@${SCOPE}/source`, 'types', 'default'], 'condition order');
        t.equal(entry.default, './dist/index.js', 'the built entry is kept as the fallback');
      },
    },
    {
      name: 'workspaces: linking under a name the package does not have refuses (the name IS the public contract)',
      once: 'the operation throws by design',
      setup: () => {
        const tree = workspace({ link: 'workspaces-npm' });
        writeJson(tree, 'packages/ui/package.json', { name: '@other/ui' });
        return tree;
      },
      run: (tree, ctx) => {
        try {
          port(ctx, tree).link(tree, { importPath: UI, libRoot: 'packages/ui' });
        } catch (error) {
          ctx.error = error.message;
        }
      },
      expect: (tree, t, ctx) => {
        t.ok(/package\.json is named "@other\/ui"/.test(ctx.error ?? ''), `did not refuse: ${ctx.error}`);
        t.equal(t.json('packages/ui/package.json'), { name: '@other/ui' }, 'nothing written');
      },
    },
    {
      name: 'workspaces (yarn berry): the link range is `workspace:*`',
      setup: () => workspace({ link: 'workspaces-npm', pm: 'yarn-berry' }),
      run: (tree, ctx) => (ctx.spec = ctx.load('generators/_utils/linking').workspaceDependencySpec(tree)),
      expect: (tree, t, ctx) => t.equal(ctx.spec, 'workspace:*', 'yarn berry spec'),
    },
    {
      name: 'workspaces (pnpm): a member outside every glob gets the narrowest honest glob, written as Nx writes the file',
      setup: () => workspace({ link: 'workspaces-pnpm' }),
      run: (tree, ctx) => ctx.load('generators/_utils/linking').ensureWorkspaceMember(tree, 'libs/ui'),
      expect: (tree, t) => {
        t.equal(workspaceGlobs(tree), ['packages/*', 'libs/*'], 'globs');
        t.has('pnpm-workspace.yaml', '- "libs/*"');
      },
    },
  ],
};
