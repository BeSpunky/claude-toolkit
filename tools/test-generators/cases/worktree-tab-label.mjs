// THE WORKTREE TAB LABEL — its main-tree sentinel is the host the dev engine ACTUALLY serves the main tree at.
//
// The label leaves the main tree alone by comparing the hostname's sub-label to a baked-in slug. It used to bake
// the raw workspace name and compare it lowercased, while the dev engine serves the main tree at
// `toDnsLabel(<name>)` — so a project called `My_App` (served at `my-app.localhost`) had its MAIN tree labelled
// as though it were a worktree. The generator now bakes the DNS label, and the generator-side rule is asserted
// to agree with the dev engine's own copy (which cannot import the payload) over the inputs that differ.
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { workspace, angularApp } from '../workspaces.mjs';
import { PAYLOAD, requireFromRepo } from '../../test-support/payload.mjs';

const { updateJson } = requireFromRepo('@nx/devkit');
const generator = (ctx) => ctx.load('generators/worktree-tab-label/generator').default;
const NAMES = ['backitup', 'My_App', 'acme.site', '@scope/web', '--odd--', '___'];

const angularShop = () => {
  const tree = workspace({ layout: 'apps-libs' });
  updateJson(tree, 'package.json', (json) => ({ ...json, dependencies: { ...json.dependencies, '@angular/core': '~21.0.0' } }));
  angularApp(tree, 'apps/shop');
  tree.write('apps/shop/src/app/app.config.ts', "import { ApplicationConfig } from '@angular/core';\nexport const appConfig: ApplicationConfig = { providers: [] };\n");
  return tree;
};
const sentinel = (tree) => /const MAIN_TREE_SLUG = '([^']*)';/.exec(tree.read('apps/shop/src/app/worktree-tab-label.ts', 'utf8') ?? '')?.[1];

export default {
  name: 'worktree-tab-label · the main-tree sentinel',
  cases: [
    {
      name: "a name the dev engine normalises (My_App) is baked as the host it is served at (my-app)",
      setup: angularShop,
      run: async (tree, ctx) => {
        await generator(ctx)(tree, { project: 'shop', workspaceName: 'My_App' });
      },
      expect: (tree, t) => {
        t.equal(sentinel(tree), 'my-app', 'the baked slug');
      },
    },
    {
      name: "the generator's DNS rule and the dev engine's agree",
      once: 'it asserts two pure functions — there is no tree operation to repeat',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        const dir = mkdtempSync(join(tmpdir(), 'dns-label-'));
        try {
          // The engine's file is a .tpl in the payload; a project receives it as worktrees.mjs. Load it as one.
          const lib = join(dir, 'worktrees.mjs');
          copyFileSync(join(PAYLOAD, 'src/generators/dev/files/lib/worktrees.mjs.tpl'), lib);
          const engine = (await import(pathToFileURL(lib).href)).toDnsLabel;
          const payload = ctx.load('generators/_utils/dns-label').toDnsLabel;
          ctx.pairs = NAMES.map((name) => [name, payload(name), engine(name)]);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      expect: (tree, t, ctx) => {
        for (const [name, payload, engine] of ctx.pairs) t.equal(payload, engine, `toDnsLabel(${JSON.stringify(name)})`);
      },
    },
  ],
};
