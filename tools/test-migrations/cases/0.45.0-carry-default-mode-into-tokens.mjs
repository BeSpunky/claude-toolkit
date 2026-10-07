// 0.45.0 — the design system's default mode moves out of the app's generator-owned theme block, into the tokens.
//
// The shapes it meets: a stock project (nothing to carry — 'system', today's behaviour), a project that hand-wrote
// `ds.theme('dark')` into the owned block (the reporter's), two apps that disagree, a customised seeded file (left,
// reported), the neutral binding, and no design system at all. The stock 0.44 files are the real ones, kept beside
// this case in `0.45.0-stock-0.44/` — the migration recognises them by fingerprint, so a fixture that invented them
// would test nothing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYLOAD, requireFromRepo } from '../../test-support/payload.mjs';

const { addProjectConfiguration } = requireFromRepo('@nx/devkit');
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(PAYLOAD, 'src');
const PREFIX = 'acme';
const DS = 'packages/design-system';
const START = '/* @bespunky/design-system:theme:start — generator-owned. */';
const END = '/* @bespunky/design-system:theme:end */';

const stock = (name) => readFileSync(join(HERE, '0.45.0-stock-0.44', `${name}.tpl`), 'utf8').replaceAll('{{tokenPrefix}}', PREFIX);
const current = (template) => readFileSync(join(SRC, template), 'utf8').replaceAll('{{tokenPrefix}}', PREFIX);

/** A 0.44 design system as the generator seeded it, for the Angular binding (or the neutral one). */
function designSystem(tree, { binding = 'angular' } = {}) {
  addProjectConfiguration(tree, 'design-system', { root: DS, projectType: 'library', tags: ['type:design-system'] });
  tree.write(`${DS}/styles/_core/_tokens.scss`, stock('_tokens.scss'));
  tree.write(`${DS}/styles/_core/_theme.scss`, stock('_theme.scss'));
  if (binding === 'angular') {
    tree.write(`${DS}/src/lib/ds-theme.service.ts`, stock('ds-theme.service.ts'));
    tree.write(`${DS}/src/lib/ds-runtime-theme.service.ts`, stock('ds-runtime-theme.service.ts'));
  } else {
    tree.write(`${DS}/src/lib/ds-mode.ts`, stock('ds-mode.ts'));
  }
}

/** An Angular app whose global stylesheet carries the owned theme block, calling `ds.theme(<call>)`. */
function app(tree, name, call = '') {
  const styles = `apps/${name}/src/styles.scss`;
  addProjectConfiguration(tree, name, {
    root: `apps/${name}`,
    projectType: 'application',
    targets: { build: { executor: '@angular/build:application', options: { styles: [styles] } } },
  });
  tree.write(styles, `body { margin: 0; }\n\n${START}\n/* Emits the design tokens. */\n@include ds.theme(${call});\n${END}\n`);
  return styles;
}

const tokens = (tree) => tree.read(`${DS}/styles/_core/_tokens.scss`, 'utf8');
const declared = (tree) => /^\$default-mode: '([\w-]+)';$/m.exec(tokens(tree))?.[1];

export default {
  name: '0.45.0 · carry-default-mode-into-tokens',
  ladder: ['0.45.0/carry-default-mode-into-tokens'],
  cases: [
    {
      name: 'stock project: $default-mode is system, and every stock file becomes exactly what 0.45.0 seeds',
      setup: (tree) => {
        designSystem(tree);
        app(tree, 'web');
      },
      expect: (tree, t) => {
        t.equal(declared(tree), 'system', '$default-mode');
        t.ok(tokens(tree).indexOf('$default-mode') > tokens(tree).indexOf('$prefix:'), 'declared after $prefix, as the seed does');
        // Today's template minus what LATER releases added to it (0.50.0: the z-skip-link layer, added by its own rung).
        const seeded045 = current('generators/design-system/files/styles/_core/_tokens.scss.tpl').replace(/  \/\/ The skip link: above everything[^\n]*\n  'z-skip-link'[^\n]*\n/, '');
        t.ok(tokens(tree) === seeded045, '_tokens.scss is not what 0.45.0 seeds');
        for (const [file, template] of [
          ['styles/_core/_theme.scss', 'generators/design-system/files/styles/_core/_theme.scss.tpl'],
          ['src/lib/ds-theme.service.ts', 'adapters/angular/design-system-files/src/lib/ds-theme.service.ts.tpl'],
          ['src/lib/ds-runtime-theme.service.ts', 'adapters/angular/design-system-files/src/lib/ds-runtime-theme.service.ts.tpl'],
          ['src/lib/ds-default-mode.ts', 'adapters/angular/design-system-files/src/lib/ds-default-mode.ts.tpl'],
        ]) {
          t.ok(t.read(`${DS}/${file}`) === current(template), `${file} is not the 0.45.0 seed`);
        }
        t.has('apps/web/src/styles.scss', '@include ds.theme();');
      },
    },
    {
      name: "the reporter's shape: a hand-written ds.theme('dark') is carried into the tokens and cleared from the block",
      setup: (tree) => {
        designSystem(tree);
        app(tree, 'web', "'dark'");
      },
      expect: (tree, t) => {
        t.equal(declared(tree), 'dark', '$default-mode');
        t.has('apps/web/src/styles.scss', '@include ds.theme();');
        t.hasNot('apps/web/src/styles.scss', "'dark'");
        t.has('apps/web/src/styles.scss', 'body { margin: 0; }');
      },
    },
    {
      name: 'a stylesheet already formatted (double quotes, reflowed) still counts as stock',
      setup: (tree) => {
        designSystem(tree);
        const theme = `${DS}/styles/_core/_theme.scss`;
        tree.write(theme, tree.read(theme, 'utf8').replaceAll("'", '"').replaceAll('  ', '    '));
        app(tree, 'web');
      },
      expect: (tree, t) => t.ok(t.read(`${DS}/styles/_core/_theme.scss`).includes('tokens.$default-mode'), '_theme.scss was not upgraded'),
    },
    {
      name: 'apps that disagree: reported, system written, every argument cleared',
      setup: (tree) => {
        designSystem(tree);
        app(tree, 'one', "'dark'");
        app(tree, 'two');
      },
      expect: (tree, t) => {
        t.equal(declared(tree), 'system', '$default-mode');
        t.has('apps/one/src/styles.scss', '@include ds.theme();');
      },
    },
    {
      name: 'a customised _theme.scss is left exactly as it was; its mixin default is still carried',
      setup: (tree) => {
        designSystem(tree);
        const theme = `${DS}/styles/_core/_theme.scss`;
        tree.write(theme, tree.read(theme, 'utf8').replace("@mixin theme($default-mode: 'light')", "@mixin theme($default-mode: 'dark')"));
        app(tree, 'web');
      },
      expect: (tree, t) => {
        t.equal(declared(tree), 'dark', '$default-mode');
        t.has(`${DS}/styles/_core/_theme.scss`, "@mixin theme($default-mode: 'dark')");
      },
    },
    {
      name: 'the neutral binding: ds-mode.ts becomes the 0.45.0 seed, no Angular module is written',
      setup: (tree) => {
        designSystem(tree, { binding: 'neutral' });
      },
      expect: (tree, t) => {
        t.ok(t.read(`${DS}/src/lib/ds-mode.ts`) === current('generators/design-system/neutral/src/lib/ds-mode.ts.tpl'), 'ds-mode.ts');
        t.missing(`${DS}/src/lib/ds-default-mode.ts`);
        t.equal(declared(tree), 'system', '$default-mode');
      },
    },
    {
      name: 'no design system: nothing to do',
      setup: (tree) => {
        app(tree, 'web', "'dark'");
      },
      expect: (tree, t) => t.has('apps/web/src/styles.scss', "@include ds.theme('dark');"),
    },
  ],
};
