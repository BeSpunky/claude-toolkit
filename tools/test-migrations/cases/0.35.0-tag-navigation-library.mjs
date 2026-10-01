// 0.35.0 — tag the navigation kernel's library `type:navigation` (the layer's new detection key).
//
// The shapes it meets: a project named `navigation-core` (what the old detector keyed on), the kernel inside a
// project under ANOTHER name (found by the vendored file), a package.json-defined project, the kernel as loose
// files with no project (the old generator's default output — reported, never invented), and a kernel inside
// another git worktree (must not be touched).
import { createRequire } from 'node:module';

const devkit = createRequire(import.meta.url)('@nx/devkit');
const KERNEL = 'lib/navigation-x.providers.ts';

const project = (tree, root, json) => tree.write(`${root}/project.json`, JSON.stringify({ root, ...json }, null, 2));
const tags = (tree, path) => JSON.parse(tree.read(path, 'utf8')).tags ?? JSON.parse(tree.read(path, 'utf8')).nx?.tags ?? [];

let warnings = [];
function captureWarnings() {
  warnings = [];
  const through = devkit.logger.warn;
  devkit.logger.warn = (...args) => {
    warnings.push(args.join(' '));
    return through(...args);
  };
}

export default {
  name: '0.35.0 · tag-navigation-library',
  ladder: ['0.35.0/tag-navigation-library'],
  cases: [
    {
      name: 'a project named navigation-core is tagged, its own tags kept',
      setup: (tree) => project(tree, 'libs/navigation-core', { name: 'navigation-core', projectType: 'library', tags: ['scope:shared'] }),
      expect: (tree) => {
        const got = tags(tree, 'libs/navigation-core/project.json');
        if (!got.includes('type:navigation') || !got.includes('scope:shared')) throw new Error(`tags: ${got}`);
      },
    },
    {
      name: 'the kernel under another project name is found by the vendored file',
      setup: (tree) => {
        project(tree, 'packages/routing', { name: 'routing', projectType: 'library' });
        tree.write(`packages/routing/src/${KERNEL}`, 'export {};\n');
      },
      expect: (tree) => {
        if (!tags(tree, 'packages/routing/project.json').includes('type:navigation')) throw new Error('not tagged');
      },
    },
    {
      name: 'a package.json-defined project is tagged in its nx block',
      setup: (tree) => {
        tree.write('libs/nav/package.json', JSON.stringify({ name: '@acme/nav', nx: { name: 'nav' } }));
        tree.write(`libs/nav/src/${KERNEL}`, 'export {};\n');
      },
      expect: (tree) => {
        const pkg = JSON.parse(tree.read('libs/nav/package.json', 'utf8'));
        if (!pkg.nx?.tags?.includes('type:navigation')) throw new Error(`nx block: ${JSON.stringify(pkg.nx)}`);
        if (tree.exists('libs/nav/project.json')) throw new Error('a project.json was invented beside package.json');
      },
    },
    {
      name: 'loose kernel files with no project: reported, nothing invented',
      setup: (tree) => {
        captureWarnings();
        tree.write(`libs/navigation-core/src/${KERNEL}`, 'export {};\n');
        tree.write('libs/navigation-core/src/index.ts', 'export {};\n');
      },
      expect: (tree) => {
        if (tree.exists('libs/navigation-core/project.json')) throw new Error('invented a project');
        if (!warnings.some((w) => w.includes('libs/navigation-core/src') && w.includes('no Nx project owns it'))) {
          throw new Error(`not reported: ${warnings.join(' | ')}`);
        }
      },
    },
    {
      name: 'a kernel inside another worktree is not touched',
      setup: (tree) => {
        project(tree, '.claude/worktrees/x/libs/navigation-core', { name: 'wt-nav', projectType: 'library' });
        tree.write(`.claude/worktrees/x/libs/navigation-core/src/${KERNEL}`, 'export {};\n');
      },
      expect: (tree) => {
        if (tags(tree, '.claude/worktrees/x/libs/navigation-core/project.json').includes('type:navigation')) throw new Error('edited another worktree');
      },
    },
    {
      name: 'no navigation anywhere: no-op',
      setup: (tree) => project(tree, 'apps/shop', { name: 'shop', projectType: 'application' }),
      expect: (tree) => {
        if (tags(tree, 'apps/shop/project.json').length) throw new Error('tagged an unrelated project');
      },
    },
  ],
};
