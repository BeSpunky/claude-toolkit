// AN ANGULAR LIBRARY PEERS WHAT IT USES — @nx/angular writes a fixed @angular/common + @angular/core pair whatever the
// library holds, and an unused peer fails the library's own lint (@nx/dependency-checks). The judgement is pure Tree
// work (adapters/angular/library-peers); the library port applying it at creation, in both linkings, needs @nx/angular.
import { workspace, angularWorkspace, MATRIX, RESOLVED } from '../workspaces.mjs';

const ROOT = 'packages/ui';
const manifest = (peerDependencies) => JSON.stringify({ name: '@shop/ui', version: '0.0.1', peerDependencies }, null, 2) + '\n';
const PAIR = { '@angular/common': '^21.0.0', '@angular/core': '^21.0.0' };
const prune = (tree, ctx) => ctx.load('adapters/angular/library-peers').pruneUnusedPeers(tree, ROOT);
const library = (peers, files = {}) => () => {
  const tree = workspace();
  tree.write(`${ROOT}/package.json`, manifest(peers));
  for (const [file, text] of Object.entries({ 'src/index.ts': "import { Component } from '@angular/core';\n", ...files })) tree.write(`${ROOT}/${file}`, text);
  return tree;
};
const peersOf = (t, root = ROOT) => t.json(`${root}/package.json`)?.peerDependencies ?? {};

export default {
  name: 'angular · a library peers what it uses',
  cases: [
    {
      name: 'nothing imports @angular/common: it goes, core stays, and the removal is named',
      setup: library({ ...PAIR, vitest: '^4.0.0' }),
      run: prune,
      expect: (tree, t, ctx) => {
        t.equal(peersOf(t), { '@angular/core': '^21.0.0', vitest: '^4.0.0' }, 'the peers');
        t.ok(ctx.logs.some((line) => line.includes('@angular/common')), `reported: ${ctx.logs.join(' | ')}`);
      },
    },
    {
      name: 'a file imports a subpath of it: kept',
      setup: library(PAIR, { 'src/lib/http.ts': "import { HttpClient } from '@angular/common/http';\n" }),
      run: prune,
      expect: (tree, t) => t.equal(peersOf(t), PAIR, 'the peers'),
    },
    {
      name: 'a library with no manifest (a non-buildable one): a no-op',
      setup: () => workspace(),
      run: prune,
      expect: (tree, t) => t.missing(`${ROOT}/package.json`),
    },
    {
      name: 'the design system prunes a demo that was the only importer: the peer goes with it',
      setup: library(PAIR, { 'src/lib/demo/demo.ts': "import { CommonModule } from '@angular/common';\n" }),
      run: (tree, ctx) => ctx.load('adapters/angular/design-system').angularDesignSystem.pruneGenerated(tree, ROOT),
      expect: (tree, t) => {
        t.missing(`${ROOT}/src/lib/demo/demo.ts`);
        t.equal(peersOf(t), { '@angular/core': '^21.0.0' }, 'the peers');
      },
    },
    ...MATRIX.filter((m) => m.layout === 'apps-libs').map((m) => ({
      name: `publishable-lib, ${m.label}: born without the unused peer, @angular/core kept`,
      needs: ['@nx/angular', '@nx/js'],
      once: 'it CREATES a library — the stack refuses a second create, by design',
      setup: () => angularWorkspace(m),
      run: async (tree, ctx) => {
        await ctx.load('generators/publishable-lib/generator').default(tree, { name: 'widgets', skipFormat: true });
      },
      expect: (tree, t) => {
        const peers = peersOf(t, `${RESOLVED[m.layout].libsDir}/widgets`);
        t.ok('@angular/core' in peers, `core stays: ${JSON.stringify(peers)}`);
        t.ok(!('@angular/common' in peers), `common goes: ${JSON.stringify(peers)}`);
      },
    })),
  ],
};
