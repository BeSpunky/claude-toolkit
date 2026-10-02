// HOUSE DOCS — HOUSE.md, HOUSE.rules.md and the CLAUDE.md seed describe the workspace's layout and linking from the
// SAME resolvers the generators place things with, so what the docs say and where things land cannot disagree. Two
// ways that breaks silently: a template token nobody renders (a literal `{{APPS_DIR}}` in a consumer's docs), and a
// section that describes the other linking model (telling a TS-solution workspace to add a path alias).
import { requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, MATRIX, RESOLVED, LINKINGS } from '../workspaces.mjs';

const { updateJson } = requireFromRepo('@nx/devkit');
const DOCS = ['HOUSE.md', 'HOUSE.rules.md', 'CLAUDE.md'];
const LAYERS = ['nx', 'agent', 'node', 'js', 'web', 'angular', 'design-system', 'firebase'];

/** The `## Workspace layout & linking` section of HOUSE.md. */
const section = (doc) => {
  const at = doc.indexOf('## Workspace layout & linking');
  if (at < 0) return '';
  const next = doc.indexOf('\n## ', at + 1);
  return doc.slice(at, next < 0 ? undefined : next);
};

export default {
  name: 'house-doc · renders the workspace it is in',
  cases: MATRIX.map((m) => ({
    name: `${m.label}: the layout and the linking model, no unrendered token`,
    setup: () => {
      const tree = workspace(m);
      updateJson(tree, 'package.json', (json) => ({ ...json, devDependencies: { ...json.devDependencies, '@nx/angular': '23.1.0', '@nx/js': '23.1.0' } }));
      tree.write('firebase.json', '{}');
      return tree;
    },
    run: async (tree, ctx) => {
      await ctx.load('generators/house-doc/generator').default(tree, {
        layers: LAYERS.join(','),
        firebase: true,
        packageManager: LINKINGS[m.link].pm,
        nxToolsVersion: '9.9.9',
        pluginVersion: '1.0.0',
      });
    },
    expect: (tree, t) => {
      const { appsDir, libsDir } = RESOLVED[m.layout];
      for (const doc of DOCS) {
        t.exists(doc);
        const leftovers = t.read(doc).match(/\{\{[^}]*\}\}/g);
        t.ok(!leftovers, `${doc} has unrendered tokens: ${leftovers?.join(' ')}`);
      }
      const house = section(t.read('HOUSE.md'));
      t.ok(house.length > 0, 'HOUSE.md has the "Workspace layout & linking" section');
      if (appsDir === libsDir) t.ok(house.includes(`Apps and libraries alike: **\`${appsDir}/\`**`), `shared layout: ${house.slice(0, 400)}`);
      else t.ok(house.includes(`Apps: **\`${appsDir}/\`**. Libraries: **\`${libsDir}/\`**`), `split layout: ${house.slice(0, 400)}`);
      t.ok(house.includes(`--name=<app>\` → \`${appsDir}/<app>\``), 'the app generator lands in appsDir');
      const workspaces = LINKINGS[m.link].linking === 'workspaces';
      t.ok(house.includes('**Linking — `workspaces`') === workspaces, 'the workspaces paragraph iff workspaces-linked');
      t.ok(house.includes('**Linking — `paths`.**') === !workspaces, 'the paths paragraph iff paths-linked');
      t.ok(house.includes('honest hybrid') === workspaces, 'the Angular TS-solution caveat iff workspaces + angular');
      t.has('CLAUDE.md', workspaces ? 'linked by package-manager workspaces' : 'linked by tsconfig `paths` aliases');
    },
  })),
};
