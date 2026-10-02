// 0.35.0 — `"@playwright/test": "latest"` → a pin, to what the project already runs.
import { createRequire } from 'node:module';

const { writeJson, readJson } = createRequire(import.meta.url)('@nx/devkit');

const pkg = (tree, deps) => writeJson(tree, 'package.json', { name: 'p', devDependencies: deps });

export default {
  name: '0.35.0 · pin-playwright',
  ladder: ['0.35.0/pin-playwright'],
  cases: [
    {
      name: 'latest + installed: pinned to the installed version (no upgrade, no downgrade)',
      setup: (tree) => {
        pkg(tree, { '@playwright/test': 'latest', nx: '23.1.0' });
        writeJson(tree, 'node_modules/@playwright/test/package.json', { name: '@playwright/test', version: '1.55.1' });
      },
      expect: (tree, t) => {
        const d = readJson(tree, 'package.json').devDependencies;
        t.ok(d['@playwright/test'] === '1.55.1', `got ${d['@playwright/test']}`);
        t.ok(d.nx === '23.1.0', 'other deps untouched');
      },
    },
    {
      name: 'latest, nothing installed: the house version',
      setup: (tree) => pkg(tree, { '@playwright/test': 'latest' }),
      expect: (tree, t) => t.ok(/^\d+\.\d+\.\d+$/.test(readJson(tree, 'package.json').devDependencies['@playwright/test']), 'an exact version'),
    },
    {
      name: 'a project-chosen range is the project’s own — untouched',
      setup: (tree) => pkg(tree, { '@playwright/test': '^1.40.0' }),
      expect: (tree, t) => t.ok(readJson(tree, 'package.json').devDependencies['@playwright/test'] === '^1.40.0', 'kept'),
    },
    {
      name: 'no package.json (a wrapper-hosted repo): a no-op',
      setup: (tree) => tree.delete('package.json'),
      expect: (tree, t) => t.missing('package.json'),
    },
  ],
};
