// 0.50.0 — an Angular design system stops peering the @angular/* packages only its pruned demo used. The shapes: the
// manifest @nx/angular wrote (common + core peers) with the house runtime (imports @angular/core only) — common goes,
// core stays, nothing else moves; a design system whose own code DOES import @angular/common (kept); no design system.
const MANIFEST = `{
  "name": "@shop/design-system",
  "version": "0.0.1",
  "peerDependencies": {
    "@angular/common": "^20.3.0",
    "@angular/core": "^20.3.0"
  },
  "sideEffects": false
}
`;
const ds = (tree, files) => {
  tree.write('packages/design-system/project.json', JSON.stringify({ name: 'design-system', root: 'packages/design-system', projectType: 'library', tags: ['type:design-system'] }));
  tree.write('packages/design-system/package.json', MANIFEST);
  for (const [file, text] of Object.entries(files)) tree.write(`packages/design-system/${file}`, text);
};
const RUNTIME = "import { DOCUMENT, Injectable, inject, signal } from '@angular/core';\nexport class DsTheme {}\n";

export default {
  name: '0.50.0 · prune-design-system-peers',
  ladder: ['0.50.0/prune-design-system-peers'],
  cases: [
    {
      name: 'the house runtime imports @angular/core only: @angular/common goes, core and everything else stay byte-identical',
      setup: (tree) => ds(tree, { 'src/lib/ds-theme.service.ts': RUNTIME, 'src/index.ts': "export * from './lib/ds-theme.service';\n" }),
      expect: (tree, t) =>
        t.ok(
          t.read('packages/design-system/package.json') === MANIFEST.replace('    "@angular/common": "^20.3.0",\n', ''),
          `got:\n${t.read('packages/design-system/package.json')}`,
        ),
    },
    {
      name: 'a component of the project\'s own imports @angular/common: kept',
      setup: (tree) => ds(tree, { 'src/lib/ds-theme.service.ts': RUNTIME, 'button/src/button.ts': "import { NgClass } from '@angular/common';\n" }),
      expect: (tree, t) => t.ok(t.read('packages/design-system/package.json') === MANIFEST, 'a used peer was removed'),
    },
    {
      name: 'no design system: a no-op',
      setup: () => {},
      expect: (tree, t) => t.missing('packages/design-system/package.json'),
    },
  ],
};
