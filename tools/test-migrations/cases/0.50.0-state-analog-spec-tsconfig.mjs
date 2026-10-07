// 0.50.0 — an Angular library's Analog test config names tsconfig.spec.json.
//
// The shapes it meets: the vite.config.mts @nx/vitest writes for a `vitest-analog` library (bare `angular()`), an
// application (its tsconfig.app.json is the right default — untouched), a config already naming a tsconfig, a config
// that also builds (reported, untouched), and a library without a spec tsconfig.
const CONFIG = (call, extra = '') => `/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  plugins: [${call}, nxViteTsPaths()],${extra}
  test: { name: 'lib', environment: 'jsdom' },
}));
`;
const project = (tree, root, type, files) => {
  tree.write(`${root}/project.json`, JSON.stringify({ name: root.split('/').pop(), root, projectType: type }));
  for (const [file, text] of Object.entries(files)) tree.write(`${root}/${file}`, text);
};
const STATED = "angular({ tsconfig: './tsconfig.spec.json' })";

export default {
  name: '0.50.0 · state-analog-spec-tsconfig',
  ladder: ['0.50.0/state-analog-spec-tsconfig'],
  cases: [
    {
      name: 'a vitest-analog library: angular() names tsconfig.spec.json, nothing else in the file moves',
      setup: (tree) => project(tree, 'libs/navigation-core', 'library', { 'vite.config.mts': CONFIG('angular()'), 'tsconfig.spec.json': '{}' }),
      expect: (tree, t) => t.ok(t.read('libs/navigation-core/vite.config.mts') === CONFIG(STATED), `got:\n${t.read('libs/navigation-core/vite.config.mts')}`),
    },
    {
      name: 'an application (tsconfig.app.json present): untouched',
      setup: (tree) => project(tree, 'apps/web', 'application', { 'vite.config.mts': CONFIG('angular()'), 'tsconfig.spec.json': '{}', 'tsconfig.app.json': '{}' }),
      expect: (tree, t) => t.ok(t.read('apps/web/vite.config.mts') === CONFIG('angular()'), 'an app config was rewritten'),
    },
    {
      name: 'a config that already names a tsconfig: untouched',
      setup: (tree) => project(tree, 'libs/a', 'library', { 'vitest.config.mts': CONFIG("angular({ tsconfig: 'x.json' })"), 'tsconfig.spec.json': '{}' }),
      expect: (tree, t) => t.ok(t.read('libs/a/vitest.config.mts') === CONFIG("angular({ tsconfig: 'x.json' })"), 'rewritten'),
    },
    {
      name: 'a config that also builds: untouched (reported)',
      setup: (tree) => project(tree, 'libs/b', 'library', { 'vite.config.mts': CONFIG('angular()', "\n  build: { lib: { entry: 'src/index.ts' } },"), 'tsconfig.spec.json': '{}' }),
      expect: (tree, t) => t.has('libs/b/vite.config.mts', 'plugins: [angular(),'),
    },
    {
      name: 'no tsconfig.spec.json: untouched',
      setup: (tree) => project(tree, 'libs/c', 'library', { 'vite.config.mts': CONFIG('angular()') }),
      expect: (tree, t) => t.has('libs/c/vite.config.mts', 'plugins: [angular(),'),
    },
  ],
};
