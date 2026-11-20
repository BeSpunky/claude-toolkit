// 0.56.0 — the files the house shares with a project get a house region; the project's half stops being rewritten.
//
// The shapes it meets: every stock revision of each shared file (the real ones, frozen from git beside the rung), one
// reformatted, the reporter's barrel (the house's exports plus `DsMotion` and `dsToken`), a barrel whose house statement
// the project edited, a customised STRUCTURE.md and tab label (the reporter's other two), the neutral binding, and a
// workspace with neither. The rung recognises stock by its text, so the fixtures are the shipped text, never invented.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PAYLOAD, requireFromRepo } from '../../test-support/payload.mjs';

const { addProjectConfiguration } = requireFromRepo('@nx/devkit');
const RUNG = join(PAYLOAD, 'src/migrations/0.56.0/house-regions');
const DS = 'packages/design-system';
const TAB = 'apps/shop/src/app/worktree-tab-label.ts';
const VALUES = { importPath: '@acme/design-system', root: DS, specifier: 'design-system/styles', tokenPrefix: 'acme', workspaceName: 'acme', mainTreeSlug: 'acme', designPhaseSkills: '' };
const fill = (text, values = VALUES) => text.replace(/\{\{(\w+)\}\}/g, (m, token) => values[token] ?? m);
const HERE = new URL('.', import.meta.url).pathname;
// The target as the rung renders it here: the stock file's own values, and the pointer as this fixture enables it (off).
const expected = (kind) => fill(readFileSync(join(RUNG, 'target', `${kind}.tpl`), 'utf8'), { ...VALUES, designPhaseSkills: '' });
const stocks = (kind) => readdirSync(join(RUNG, 'stock', kind)).sort().map((file) => ({ sha: file.replace('.tpl', ''), text: fill(readFileSync(join(RUNG, 'stock', kind, file), 'utf8')) }));

const designSystem = (tree) => {
  addProjectConfiguration(tree, 'design-system', { root: DS, projectType: 'library', tags: ['type:design-system'] });
  tree.write(`${DS}/package.json`, JSON.stringify({ name: '@acme/design-system' }));
};
const app = (tree) => addProjectConfiguration(tree, 'shop', { root: 'apps/shop', projectType: 'application' });

const START = (name) => `@bespunky/${name}:start`;
const END = (name) => `@bespunky/${name}:end`;
const hasRegion = (text, name) => text.includes(START(name)) && text.indexOf(END(name)) > text.indexOf(START(name));

const stockCases = [
  ...['angular-index', 'neutral-index'].flatMap((kind) => stocks(kind).map((s) => ({ kind, path: `${DS}/src/index.ts`, region: 'design-system-api', ...s }))),
  ...['angular-structure', 'neutral-structure'].flatMap((kind) => stocks(kind).map((s) => ({ kind, path: `${DS}/STRUCTURE.md`, region: 'design-system-structure', ...s }))),
  ...stocks('tab-label').map((s) => ({ kind: 'tab-label', path: TAB, region: 'worktree-tab-label', ...s })),
].map(({ kind, path, region, sha, text }) => ({
  name: `stock ${kind} @${sha} → the 0.56.0 shape, with its region`,
  setup: (tree) => {
    designSystem(tree);
    app(tree);
    tree.write(path, text);
  },
  expect: (tree, t) => {
    const after = t.read(path);
    t.ok(hasRegion(after, region), `has its region:\n${after.slice(0, 300)}`);
    t.ok(!/\{\{\w+\}\}/.test(after), `no unrendered token: ${after.match(/\{\{\w+\}\}/)?.[0]}`);
    t.ok(!/Rewritten on every run|do not edit by hand/.test(after), 'the false header is gone');
    if (kind === 'tab-label') t.ok(/function badgeStyle\(/.test(after) && after.indexOf('function badgeStyle(') > after.indexOf(END(region)), 'badgeStyle sits below the region');
    if (kind.endsWith('-index')) t.ok(after.includes('@acme/design-system'), 'the prose names the import path');
    if (kind !== 'tab-label') t.equal(after, expected(kind), "exactly the 0.56.0 shape, filled with the stock file's own values");
  },
}));

// The same stock shapes, each filled with VALUES (the real pointer text included) and formatted by prettier 3.6.2 with
// Nx's seeded `{ singleQuote: true }` — what every earlier run's formatFiles left on disk in a workspace with prettier
// (frozen in ../fixtures/0.56.0-prettier; the formatter rewrote the html fence's `<link>` as `<link />`, which no
// fixture showed until then). The harness's tree resolves no prettier, so these meet the rung's own folding alone.
const FORMATTED = join(HERE, '../fixtures/0.56.0-prettier');
const formattedCases = readdirSync(FORMATTED).sort().map((file) => {
  const kind = file.split('@')[0];
  const path = kind.endsWith('-index') ? `${DS}/src/index.ts` : kind.endsWith('-structure') ? `${DS}/STRUCTURE.md` : TAB;
  const region = kind.endsWith('-index') ? 'design-system-api' : kind.endsWith('-structure') ? 'design-system-structure' : 'worktree-tab-label';
  return {
    name: `stock ${file.replace(/\.\w+$/, '')}, prettier-formatted → still stock, the 0.56.0 shape`,
    setup: (tree) => {
      designSystem(tree);
      app(tree);
      tree.write(path, readFileSync(join(FORMATTED, file), 'utf8'));
    },
    expect: (tree, t) => {
      const after = t.read(path);
      t.ok(hasRegion(after, region), `has its region:\n${after.slice(0, 300)}`);
      if (kind !== 'tab-label') t.equal(after, expected(kind), 'exactly the 0.56.0 shape');
    },
  };
});

// A project's own text written right where a stock value sits must never be absorbed into that value: the file is not
// stock, so it is the project's.
const SWALLOW = [
  { name: 'a tab label with its own const after the main-tree slug', path: TAB, text: () => stocks('tab-label').at(-1).text.replace("const MAIN_TREE_SLUG = 'acme';", "const MAIN_TREE_SLUG = 'acme';\nconst LABEL_BG = 'var(--acme-color-accent)';"), keep: 'LABEL_BG' },
  { name: 'a STRUCTURE.md documenting its own @use beside the stock one', path: `${DS}/STRUCTURE.md`, text: () => stocks('angular-structure').at(-1).text.replace("@use 'design-system/styles' as ds;", "@use 'design-system/styles' as ds;\n@use 'my/mixins' as ds;"), keep: "@use 'my/mixins' as ds;" },
  { name: 'a STRUCTURE.md with its own sentence after "The design phase"', path: `${DS}/STRUCTURE.md`, text: () => stocks('neutral-structure').at(-1).text.replace('The design phase', 'The design phase — ours, run by the brand team — '), keep: 'ours, run by the brand team' },
].map(({ name, path, text, keep }) => ({
  name: `${name} is the project's, not stock`,
  setup: (tree) => {
    designSystem(tree);
    app(tree);
    tree.write(path, text());
  },
  expect: (tree, t, logs) => {
    t.ok(t.read(path).includes(keep), `the project's text survives:\n${t.read(path).slice(0, 600)}`);
    t.ok(logs.some((l) => l.includes(path) && l.includes('wholly the project')), `reported: ${logs.join(' | ')}`);
  },
}));

const ANGULAR_BARREL = stocks('angular-index').at(-1).text;
const REPORTED = `${ANGULAR_BARREL}\n// Motion: durations and easings as a typed API.\nexport { DsMotion } from './lib/ds-motion';\nexport { dsToken } from './lib/ds-token';\n`;

export default {
  name: '0.56.0 · mark-house-regions',
  ladder: ['0.56.0/mark-house-regions'],
  cases: [
    ...stockCases,
    ...formattedCases,
    ...SWALLOW,
    {
      name: 'a stock barrel reformatted (double quotes, wrapped) is still stock',
      setup: (tree) => {
        designSystem(tree);
        tree.write(`${DS}/src/index.ts`, ANGULAR_BARREL.replace(/'/g, '"').replace('export { DsTheme, type DsMode }', 'export {\n  DsTheme,\n  type DsMode,\n}'));
      },
      expect: (tree, t) => t.ok(hasRegion(t.read(`${DS}/src/index.ts`), 'design-system-api'), t.read(`${DS}/src/index.ts`)),
    },
    {
      name: "the reporter's barrel: the house's statements move into the region, DsMotion and dsToken stay outside it",
      setup: (tree) => {
        designSystem(tree);
        tree.write(`${DS}/src/index.ts`, REPORTED);
      },
      expect: (tree, t, logs) => {
        const after = t.read(`${DS}/src/index.ts`);
        const end = after.indexOf(END('design-system-api'));
        t.ok(hasRegion(after, 'design-system-api'), `has its region:\n${after}`);
        for (const name of ['provideDesignSystem', 'DsTheme', 'DsRuntimeTheme']) {
          t.ok((after.match(new RegExp(`export \\{[^}]*\\b${name}\\b`, 'g')) ?? []).length === 1, `${name} exported once:\n${after}`);
          t.ok(after.indexOf(name, after.indexOf(START('design-system-api'))) < end, `${name} inside the region`);
        }
        for (const name of ['DsMotion', 'dsToken']) t.ok(after.indexOf(`export { ${name} }`) > end, `${name} below the region:\n${after}`);
        t.ok(after.includes('// Motion: durations and easings as a typed API.'), "the project's comment stays");
        t.ok(logs.some((l) => l.includes('moved into its house region')), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: "the reporter's barrel: the house's comments move with their statements, the header becomes 0.56.0's",
      setup: (tree) => {
        designSystem(tree);
        tree.write(`${DS}/src/index.ts`, REPORTED);
      },
      expect: (tree, t) => {
        t.equal(
          t.read(`${DS}/src/index.ts`),
          `${expected('angular-index')}\n// Motion: durations and easings as a typed API.\nexport { DsMotion } from './lib/ds-motion';\nexport { dsToken } from './lib/ds-token';\n`,
          'the 0.56.0 barrel, then the project\'s own lines',
        );
      },
    },
    {
      name: 'a CRLF barrel keeps CRLF',
      setup: (tree) => {
        designSystem(tree);
        tree.write(`${DS}/src/index.ts`, REPORTED.replace(/\n/g, '\r\n'));
      },
      expect: (tree, t) => {
        const after = t.read(`${DS}/src/index.ts`);
        t.ok(hasRegion(after, 'design-system-api'), after);
        t.ok(!/[^\r]\n/.test(after), 'no bare LF');
      },
    },
    {
      name: 'a project export between the house statements stays where it was',
      setup: (tree) => {
        designSystem(tree);
        tree.write(`${DS}/src/index.ts`, ANGULAR_BARREL.replace('\n// Mode:', "\nexport { DsMotion } from './lib/ds-motion';\n\n// Mode:"));
      },
      expect: (tree, t) => {
        const after = t.read(`${DS}/src/index.ts`);
        t.ok(after.indexOf("export { DsMotion }") > after.indexOf(END('design-system-api')), `below the region:\n${after}`);
        t.equal((after.match(/\/\/ Mode:/g) ?? []).length, 1, 'the house comment once');
      },
    },
    {
      name: 'a barrel that dropped a house export gets it back with the region, and is told so',
      setup: (tree) => {
        designSystem(tree);
        tree.write(`${DS}/src/index.ts`, ANGULAR_BARREL.replace(/\n\/\/ Runtime theming[\s\S]*$/, "\nexport { DsMotion } from './lib/ds-motion';\n"));
      },
      expect: (tree, t, logs) => {
        t.ok(hasRegion(t.read(`${DS}/src/index.ts`), 'design-system-api'), t.read(`${DS}/src/index.ts`));
        t.ok(logs.some((l) => l.includes('`DsRuntimeTheme`') && l.includes('stopped exporting')), `reported: ${logs.join(' | ')}`);
      },
    },
    ...[
      ['a trailing comment on a house statement', (b) => b.replace("from './lib/ds-runtime-theme.service';", "from './lib/ds-runtime-theme.service'; // ours now")],
      ['its own class under a house name', (b) => b.replace("export { DsRuntimeTheme, type DsTokenOverrides } from './lib/ds-runtime-theme.service';", 'export class DsRuntimeTheme {}\nexport type DsTokenOverrides = Record<string, string>;')],
      ['a local re-export of a house name', (b) => b.replace("export { DsTheme, type DsMode } from './lib/ds-theme.service';", "import { DsTheme as T, type DsMode as M } from './lib/ds-theme.service';\nexport { T as DsTheme, type M as DsMode };")],
    ].map(([what, edit]) => ({
      name: `a barrel with ${what} is left whole: the region would export a name twice`,
      setup: (tree) => {
        designSystem(tree);
        tree.write(`${DS}/src/index.ts`, edit(ANGULAR_BARREL) + "export { DsMotion } from './lib/ds-motion';\n");
      },
      expect: (tree, t, logs) => {
        t.equal(t.read(`${DS}/src/index.ts`), edit(ANGULAR_BARREL) + "export { DsMotion } from './lib/ds-motion';\n", 'byte-identical');
        t.ok(logs.some((l) => l.includes('not moved')), `reported: ${logs.join(' | ')}`);
      },
    })),
    {
      name: 'a tab label carrying only a start marker is damaged: left alone, and reported',
      setup: (tree) => {
        app(tree);
        tree.write(TAB, `// @bespunky/worktree-tab-label:start\n${stocks('tab-label').at(-1).text}`);
      },
      expect: (tree, t, logs) => {
        t.equal(t.read(TAB), `// @bespunky/worktree-tab-label:start\n${stocks('tab-label').at(-1).text}`, 'untouched');
        t.ok(logs.some((l) => l.includes(TAB) && l.includes('damaged')), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'a barrel whose house statement the project edited is left whole, and reported',
      setup: (tree) => {
        designSystem(tree);
        tree.write(`${DS}/src/index.ts`, ANGULAR_BARREL.replace('export { DsTheme, type DsMode }', 'export { DsTheme, type DsMode, DsMotion }'));
      },
      expect: (tree, t, logs) => {
        t.ok(t.read(`${DS}/src/index.ts`) === ANGULAR_BARREL.replace('export { DsTheme, type DsMode }', 'export { DsTheme, type DsMode, DsMotion }'), 'byte-identical');
        t.ok(logs.some((l) => l.includes('DsTheme') && l.includes('not moved')), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'a customised STRUCTURE.md stays the project’s: only the false header goes, and it is reported',
      setup: (tree) => {
        designSystem(tree);
        tree.write(`${DS}/STRUCTURE.md`, stocks('angular-structure').at(-1).text + '\n## Motion\n\nOurs.\n');
      },
      expect: (tree, t, logs) => {
        const after = t.read(`${DS}/STRUCTURE.md`);
        t.ok(after === (stocks('angular-structure').at(-1).text + '\n## Motion\n\nOurs.\n').replace(/^<!-- Generated by[^\n]*\n/, ''), `only the header removed:\n${after.slice(0, 200)}`);
        t.ok(!hasRegion(after, 'design-system-structure'), 'no region invented');
        t.ok(logs.some((l) => l.includes('STRUCTURE.md') && l.includes('wholly the project')), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: "the reporter's tokenised tab label stays theirs",
      setup: (tree) => {
        app(tree);
        tree.write(TAB, stocks('tab-label').at(-1).text.replace("ctx.fillStyle = '#ffffff';", "ctx.fillStyle = token('--acme-color-on-primary');"));
      },
      expect: (tree, t, logs) => {
        const after = t.read(TAB);
        t.ok(after.includes("token('--acme-color-on-primary')") && !after.includes('do not edit by hand'), after.slice(0, 900));
        t.ok(!hasRegion(after, 'worktree-tab-label'), 'no region invented');
        t.ok(logs.some((l) => l.includes(TAB)), `reported: ${logs.join(' | ')}`);
      },
    },
    {
      name: 'nothing shared: nothing written',
      setup: (tree) => app(tree),
      expect: (tree, t) => t.ok(!tree.exists(TAB) && !tree.exists(`${DS}/src/index.ts`), 'nothing written'),
    },
  ],
};
