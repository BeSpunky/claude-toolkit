// 0.50.0 — an existing design system gains ds.visually-hidden($focusable), ds.skip-link(), ds.skip-target() and the
// z-skip-link layer.
//
// The shapes it meets: a design system seeded before 0.50.0 (its _index.scss forwards mixins, no a11y; its tokens
// stop at z-modal), one whose own styles already define a `skip-link` mixin (a clash — reported, nothing forwarded),
// one with its OWN `_utils/_a11y.scss` (R8-12: reported, nothing forwarded), one whose token file has no z-modal entry
// (reported), one that replaced the house's functions file (reported), and a workspace with no design system.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '../../../plugins/house/engine/nx-tools/src/generators/design-system/files/styles');
// The public API as 0.49 seeded it: today's template without the a11y forward. That is byte-for-byte the ONLY
// _index.scss the toolkit ever shipped — unchanged from ed399a8 (the design-system generator's birth) through 0.49
// (git show ed399a8:plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/design-system/files/styles/_index.scss.tpl),
// and no shipped style file ever carried `'_utils/a11y'` or a `visually-hidden`/`skip-link` mixin (git log -S) — so
// there is no historical shape to list.
const NEW_INDEX = readFileSync(join(STYLES, '_index.scss.tpl'), 'utf8');
const OLD_INDEX = NEW_INDEX.replace(/\/\/ Accessibility mechanisms[^\n]*\n@forward '_utils\/a11y'[^\n]*\n\n/, '');
const ROOT = 'libs/design-system';
// The token file as 0.49 seeded it: today's template without the skip-link layer.
const NEW_TOKENS = readFileSync(join(STYLES, '_core/_tokens.scss.tpl'), 'utf8');
const OLD_TOKENS = NEW_TOKENS.replace(/  \/\/ The skip link: above everything[^\n]*\n  'z-skip-link'[^\n]*\n/, '');

function designSystem(tree, { functions = true, tokens = OLD_TOKENS, extra = {} } = {}) {
  tree.write(`${ROOT}/project.json`, JSON.stringify({ name: 'design-system', root: ROOT, projectType: 'library', tags: ['type:design-system', 'platform:web'] }));
  tree.write(`${ROOT}/styles/_index.scss`, OLD_INDEX);
  tree.write(`${ROOT}/styles/_core/_tokens.scss`, tokens);
  if (functions) tree.write(`${ROOT}/styles/_core/_functions.scss`, '// fns\n');
  tree.write(`${ROOT}/styles/_utils/_mixins.scss`, '// mixins\n');
  for (const [file, text] of Object.entries(extra)) tree.write(`${ROOT}/styles/${file}`, text);
}

export default {
  name: '0.50.0 · add-design-system-a11y',
  ladder: ['0.50.0/add-design-system-a11y'],
  cases: [
    {
      name: 'a pre-0.50 design system: _a11y.scss seeded, forwarded right after the mixins, nothing else moved',
      setup: (tree) => designSystem(tree),
      expect: (tree, t) => {
        t.ok(t.read(`${ROOT}/styles/_utils/_a11y.scss`) === readFileSync(join(STYLES, '_utils/_a11y.scss.tpl'), 'utf8'), 'the seeded mechanism');
        const index = t.read(`${ROOT}/styles/_index.scss`);
        t.occurrences(`${ROOT}/styles/_index.scss`, "@forward '_utils/a11y' show visually-hidden, skip-link, skip-target;", 1);
        t.ok(OLD_TOKENS !== NEW_TOKENS && t.read(`${ROOT}/styles/_core/_tokens.scss`) === NEW_TOKENS, 'the z-skip-link layer, exactly as a new design system has it');
        t.ok(/@forward '_utils\/mixins'[^\n]*\n\n\/\/ Accessibility[^\n]*\n@forward '_utils\/a11y'/.test(index), `placed after the mixins forward:\n${index}`);
        t.ok(OLD_INDEX !== NEW_INDEX && index === NEW_INDEX, 'exactly what a new design system is seeded with — only the forward was added');
      },
    },
    {
      name: 'the styles already define a skip-link mixin: nothing forwarded, nothing seeded (reported)',
      setup: (tree) => designSystem(tree, { extra: { '_utils/_mine.scss': '@mixin skip-link { display: block; }\n' } }),
      expect: (tree, t) => {
        t.ok(t.read(`${ROOT}/styles/_index.scss`) === OLD_INDEX, 'the public API changed');
        t.missing(`${ROOT}/styles/_utils/_a11y.scss`);
      },
    },
    {
      name: "the design system has its OWN _utils/_a11y.scss (not the house's): nothing forwarded (reported), the file untouched",
      setup: (tree) => designSystem(tree, { extra: { '_utils/_a11y.scss': '@mixin focus-trap { }\n' } }),
      expect: (tree, t, lines) => {
        t.ok(t.read(`${ROOT}/styles/_index.scss`) === OLD_INDEX, 'the public API changed');
        t.ok(t.read(`${ROOT}/styles/_utils/_a11y.scss`) === '@mixin focus-trap { }\n', 'their file changed');
        t.ok(t.read(`${ROOT}/styles/_core/_tokens.scss`) === OLD_TOKENS, 'tokens changed');
        t.ok(lines.some((line) => line.includes("is not the house's")), `reported:\n${lines.join('\n')}`);
      },
    },
    {
      name: 'a token file without a z-modal entry: nothing added (reported)',
      setup: (tree) => designSystem(tree, { tokens: '$base: (\n  "space-1": 4px,\n);\n' }),
      expect: (tree, t, lines) => {
        t.ok(t.read(`${ROOT}/styles/_index.scss`) === OLD_INDEX, 'the public API changed');
        t.missing(`${ROOT}/styles/_utils/_a11y.scss`);
        t.ok(lines.some((line) => line.includes("no `'z-modal': …,` entry")), `reported:\n${lines.join('\n')}`);
      },
    },
    {
      name: 'the house functions file was replaced: nothing added (reported)',
      setup: (tree) => designSystem(tree, { functions: false }),
      expect: (tree, t) => {
        t.ok(t.read(`${ROOT}/styles/_index.scss`) === OLD_INDEX, 'the public API changed');
        t.missing(`${ROOT}/styles/_utils/_a11y.scss`);
      },
    },
    {
      name: 'no design system: nothing to do',
      setup: (tree) => tree.write('libs/ui/project.json', JSON.stringify({ name: 'ui', root: 'libs/ui' })),
      expect: (tree, t) => t.missing('libs/ui/styles'),
    },
  ],
};
