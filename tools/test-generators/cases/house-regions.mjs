// HOUSE REGIONS — in a file the house shares with a project, an upgrade rewrites the house's region and nothing else.
//
// Until 0.56.0 the design system's barrel and STRUCTURE.md and the Angular tab label were rewritten whole, so a project's
// own exports, docs and tokens went on every upgrade (the report: `DsMotion` and `dsToken` gone from the barrel). Each
// case gives the generator a file whose region has drifted beside the project's own half, and asserts the region is the
// house's again and the rest is byte for byte the project's; a file with no region is left alone entirely.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAYLOAD, requireFromRepo } from '../../test-support/payload.mjs';
import { workspace, angularApp, RESOLVED } from '../workspaces.mjs';

const { addProjectConfiguration, updateJson } = requireFromRepo('@nx/devkit');
const DS = `${RESOLVED.hybrid.libsDir}/design-system`;
const TAB = 'apps/shop/src/app/worktree-tab-label.ts';
const template = (path) => readFileSync(join(PAYLOAD, 'src', path), 'utf8');
const between = (text, name) => text.slice(text.indexOf(`@bespunky/${name}:start`), text.indexOf(`@bespunky/${name}:end`));

/** A neutral design system already on disk, so the generator syncs rather than creates. */
const neutralDesignSystem = () => {
  const tree = workspace();
  addProjectConfiguration(tree, 'design-system', { root: DS, projectType: 'library', tags: ['type:design-system'] });
  tree.write(`${DS}/package.json`, JSON.stringify({ name: '@acme/design-system' }));
  return tree;
};

const OURS_EXPORTS = "\nexport { DsMotion } from './lib/ds-motion';\nexport { dsToken } from './lib/ds-token';\n";
const OURS_DOC = '\n## Motion\n\nOurs, and staying.\n';

const angularShop = () => {
  const tree = workspace({ layout: 'apps-libs' });
  updateJson(tree, 'package.json', (json) => ({ ...json, dependencies: { ...json.dependencies, '@angular/core': '~21.0.0' } }));
  angularApp(tree, 'apps/shop');
  tree.write('apps/shop/src/app/app.config.ts', "import { ApplicationConfig } from '@angular/core';\nexport const appConfig: ApplicationConfig = { providers: [] };\n");
  return tree;
};
const TOKENISED = "function badgeStyle(hue: number) {\n  return { fill: `hsl(${hue}, 70%, 50%)`, text: token('--acme-on-primary'), font: token('--acme-font-badge') };\n}\n";
const tabLabelWith = (tamper) =>
  template('generators/worktree-tab-label/files/worktree-tab-label.ts.tpl')
    .split('{{mainTreeSlug}}')
    .join('acme')
    .replace(/\nfunction badgeStyle[\s\S]*$/, `\n${TOKENISED}`)
    .replace('const size = 32;', tamper ? 'const size = 64;' : 'const size = 32;');

export default {
  name: 'house regions · the house rewrites its region, never the project’s half',
  cases: [
    {
      // The dogfood's catch: @nx/angular's barrel re-exports its demo; it used to be overwritten, and with the barrel
      // seeded only when absent it would survive, pointing at the deleted demo (TS2307 in a fresh `new --preset=angular`).
      name: "the Angular binding's prune takes @nx/angular's demo barrel with the demo, so the house's is seeded",
      once: 'it runs the prune of a library being created, which happens once',
      setup: () => {
        const tree = workspace();
        addProjectConfiguration(tree, 'design-system', { root: DS, projectType: 'library', targets: {} });
        tree.write(`${DS}/src/index.ts`, "export * from './lib/design-system/design-system';\n");
        tree.write(`${DS}/src/lib/design-system/design-system.ts`, 'export class DesignSystem {}\n');
        return tree;
      },
      run: async (tree, ctx) => {
        ctx.load('adapters/angular/design-system').angularDesignSystem.pruneGenerated(tree, DS);
      },
      expect: (tree, t) => {
        t.ok(!tree.exists(`${DS}/src/index.ts`), 'the demo barrel is gone');
        t.ok(!tree.exists(`${DS}/src/lib/design-system/design-system.ts`), 'the demo is gone');
      },
    },
    {
      name: "the barrel: a drifted region is the house's again, the project's exports below it stay",
      setup: () => {
        const tree = neutralDesignSystem();
        const seeded = template('generators/design-system/neutral/src/index.ts.tpl').replaceAll('{{importPath}}', '@acme/design-system');
        tree.write(`${DS}/src/index.ts`, seeded.replace('resolvedMode, ', '') + OURS_EXPORTS);
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
      },
      expect: (tree, t) => {
        const after = t.read(`${DS}/src/index.ts`);
        t.ok(between(after, 'design-system-api').includes('resolvedMode'), `the region is restored:\n${after}`);
        t.ok(after.endsWith(OURS_EXPORTS), `DsMotion and dsToken stay, below it:\n${after}`);
      },
    },
    {
      name: "STRUCTURE.md: the house's conventions are restored, the project's own section stays",
      setup: () => {
        const tree = neutralDesignSystem();
        const seeded = template('generators/design-system/neutral/STRUCTURE.md.tpl');
        tree.write(`${DS}/STRUCTURE.md`, seeded.replace('## The rules', '## Rules we forgot') + OURS_DOC);
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
      },
      expect: (tree, t) => {
        const after = t.read(`${DS}/STRUCTURE.md`);
        t.ok(between(after, 'design-system-structure').includes('## The rules') && !after.includes('Rules we forgot'), 'the region is restored');
        t.ok(!/\{\{\w+\}\}/.test(between(after, 'design-system-structure')), 'rendered');
        t.ok(after.endsWith(OURS_DOC), `the project's section stays:\n${after.slice(-300)}`);
      },
    },
    {
      name: 'a shared file with no region is the project’s: never touched',
      setup: () => {
        const tree = neutralDesignSystem();
        tree.write(`${DS}/src/index.ts`, `export * from './lib/everything';\n`);
        tree.write(`${DS}/STRUCTURE.md`, '# Ours entirely\n');
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
      },
      expect: (tree, t) => {
        t.equal(t.read(`${DS}/src/index.ts`), `export * from './lib/everything';\n`, 'the barrel');
        t.equal(t.read(`${DS}/STRUCTURE.md`), '# Ours entirely\n', 'STRUCTURE.md');
      },
    },
    {
      name: 'a new design system is seeded with its regions',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        await ctx.load('generators/design-system/generator').default(tree, { skipFormat: true });
      },
      expect: (tree, t) => {
        t.has(`${DS}/src/index.ts`, '@bespunky/design-system-api:start');
        t.has(`${DS}/STRUCTURE.md`, '@bespunky/design-system-structure:start');
        t.has(`${DS}/STRUCTURE.md`, "## This project's design system");
      },
    },
    {
      name: "the tab label: the mechanism is the house's again, the project's tokenised badgeStyle stays",
      setup: () => {
        const tree = angularShop();
        tree.write(TAB, tabLabelWith(true));
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/worktree-tab-label/generator').default(tree, { project: 'shop', workspaceName: 'acme' });
      },
      expect: (tree, t) => {
        const after = t.read(TAB);
        t.ok(after.includes('const size = 32;') && !after.includes('const size = 64;'), 'the region is restored');
        t.ok(after.includes("token('--acme-on-primary')"), `badgeStyle stays the project's:\n${after.slice(-400)}`);
      },
    },
    {
      name: 'a tab label with no region is the project’s: never touched',
      setup: () => {
        const tree = angularShop();
        tree.write(TAB, 'export function provideWorktreeTabLabel() { return []; }\n');
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/worktree-tab-label/generator').default(tree, { project: 'shop', workspaceName: 'acme' });
      },
      expect: (tree, t) => t.equal(t.read(TAB), 'export function provideWorktreeTabLabel() { return []; }\n', 'untouched'),
    },
    {
      name: 'the marker grammar: a name ends at its edge, and every region a text declares is found',
      once: 'it asserts pure functions — there is no tree operation to repeat',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ctx.region = ctx.load('generators/_utils/house-region');
      },
      expect: (tree, t, ctx) => {
        const { markerLine, findRegion, regionNames } = ctx.region;
        t.ok(markerLine('// @bespunky/a:starting\n', 'a', 'start') === null, '`a:starting` is not `a:start`');
        t.ok(markerLine('/* @bespunky/a:b:start */', 'a', 'start') === null, '`a:b` is not `a`');
        t.ok(findRegion('<!-- @bespunky/x:end -->\n<!-- @bespunky/x:start -->\n', 'x') === null, 'out of order is no region');
        t.equal(regionNames('// @bespunky/one:start note\n// @bespunky/one:end\n/* @bespunky/two:x:start */\n/* @bespunky/two:x:end */\n').join(','), 'one,two:x', 'names');
        t.equal(regionNames('// @bespunky/lone:start\n').join(','), '', 'a start with no end declares no region');
      },
    },
    {
      name: 'the marker grammar: a MENTION of a marker is not one, and CRLF survives a sync',
      once: 'it asserts pure functions — there is no tree operation to repeat',
      setup: () => workspace(),
      run: async (tree, ctx) => {
        ctx.region = ctx.load('generators/_utils/house-region');
      },
      expect: (tree, t, ctx) => {
        const { findRegion, replaceRegion, regionState, syncHouseRegions } = ctx.region;
        const real = '<!-- @bespunky/p:start note -->\nhouse\n<!-- @bespunky/p:end -->\n';
        const proseEnd = 'Everything up to `@bespunky/p:end` is generated.\n\n';
        t.ok(findRegion(proseEnd + real, 'p')?.from === proseEnd.length, 'a quoted end marker above the region is prose');
        const proseStart = '- never edit after `@bespunky/p:start`\n- my rule\n\n';
        t.equal(replaceRegion(proseStart + real, 'p', 'NEW'), `${proseStart}NEW\n`, "a quoted start marker swallows none of the project's lines");
        t.ok(findRegion('// @bespunky/p:end\n// @bespunky/p:start\nx\n// @bespunky/p:end\n', 'p')?.from > 0, 'the end is the first one AFTER the start');
        t.equal(regionState('// @bespunky/p:start\nold\n', 'p'), 'damaged', 'a lone start is damaged');
        t.equal(regionState('nothing here\n', 'p'), 'absent', 'absent');
        tree.write('crlf.ts', '// @bespunky/p:start\r\nold\r\n// @bespunky/p:end\r\nmine\r\n');
        t.equal(syncHouseRegions(tree, 'crlf.ts', '// @bespunky/p:start\nnew\n// @bespunky/p:end\nseed\n'), 'refreshed', 'refreshed');
        t.equal(tree.read('crlf.ts', 'utf8'), '// @bespunky/p:start\r\nnew\r\n// @bespunky/p:end\r\nmine\r\n', 'the region is written in the file\'s line endings');
        tree.write('damaged.ts', '// @bespunky/p:start\nold\nmine\n');
        t.equal(syncHouseRegions(tree, 'damaged.ts', '// @bespunky/p:start\nnew\n// @bespunky/p:end\n'), 'damaged', 'a damaged region is reported as such');
        t.equal(tree.read('damaged.ts', 'utf8'), '// @bespunky/p:start\nold\nmine\n', 'and not touched');
      },
    },
    {
      name: 'a tab label whose region lost its end marker is left alone, and the generator says so',
      setup: () => {
        const tree = angularShop();
        tree.write(TAB, tabLabelWith(true).replace(/^.*@bespunky\/worktree-tab-label:end.*\n/m, ''));
        return tree;
      },
      run: async (tree, ctx) => {
        await ctx.load('generators/worktree-tab-label/generator').default(tree, { project: 'shop', workspaceName: 'acme' });
      },
      expect: (tree, t, ctx) => {
        t.ok(t.read(TAB).includes('const size = 64;'), 'untouched');
        t.ok(ctx.logs.some((l) => l.includes(TAB) && l.includes('damaged')), `reported: ${ctx.logs.join(' | ')}`);
      },
    },
    {
      name: "CLAUDE.md quoting the pointer's end marker in prose still has ONE pointer",
      setup: () => {
        const tree = workspace();
        tree.write('CLAUDE.md', '# App\n\nNote: everything up to `@bespunky/house-tooling:end` is generated.\n\n## Conventions\n\n- mine\n');
        return tree;
      },
      run: async (tree, ctx) => {
        const houseDoc = ctx.load('generators/house-doc/generator').default;
        await houseDoc(tree, { layers: 'nx,agent', nxToolsVersion: '9.9.9', pluginVersion: '1.0.0' });
        await houseDoc(tree, { layers: 'nx,agent', nxToolsVersion: '9.9.9', pluginVersion: '1.0.0' });
      },
      expect: (tree, t) => {
        const after = t.read('CLAUDE.md');
        t.equal((after.match(/<!-- @bespunky\/house-tooling:start/g) ?? []).length, 1, `one pointer:\n${after}`);
        t.ok(after.includes('Note: everything up to `@bespunky/house-tooling:end` is generated.') && after.includes('- mine'), "the project's lines stay");
      },
    },
  ],
};
