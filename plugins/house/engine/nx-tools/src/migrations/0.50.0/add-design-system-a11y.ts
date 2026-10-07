// 0.50.0 — the design system gains its accessibility mechanisms: `ds.visually-hidden($focusable)` and
// `ds.skip-link()`.
//
// WHAT CHANGED. A skip link (WCAG 2.4.1) needs "visually hidden UNTIL focused", and the design system only had the
// `%visually-hidden` placeholder — which cannot cross a component stylesheet and cannot be revealed on focus — so
// every project hand-wrote one (E5: into a component stylesheet, which then blew its size budget). From 0.50.0 the
// SASS API forwards a new `_utils/_a11y.scss`, and a NEW app's first shell starts with a skip link and the `<main>`
// landmark, styled by `ds.skip-link()`.
//
// WHAT IT DOES for an existing design system — additively, and only where nothing could collide:
//   1. seeds `styles/_utils/_a11y.scss` if absent (the design-system generator would seed it on this same upgrade;
//      writing it here keeps step 2 from ever forwarding a file that is not there);
//   2. adds `@forward '_utils/a11y' show visually-hidden, skip-link;` to the PUBLIC API (`styles/_index.scss`),
//      after the mixins forward — never when the styles already define a mixin of either name (two forwarded
//      `skip-link`s are a sass error), which is reported instead.
// It never touches an app: an existing app's shell is the app's own (class C). It REPORTS how to adopt the skip
// link in one, because a primitive nobody hears about is a primitive nobody uses.
import { type Tree, logger } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findDesignSystem } from '../../generators/_utils/design-system';

const WHO = '0.50.0/add-design-system-a11y';
const FORWARD = "@forward '_utils/a11y' show visually-hidden, skip-link;";
const TEMPLATE = join(__dirname, '../../generators/design-system/files/styles/_utils/_a11y.scss.tpl');

export default async function addDesignSystemA11y(tree: Tree): Promise<void> {
  if (!tree.exists('nx.json')) return;
  let designSystem;
  try {
    designSystem = findDesignSystem(tree);
  } catch {
    return;
  }
  if (!designSystem) return;
  const styles = `${designSystem.root}/styles`;
  const index = `${styles}/_index.scss`;
  const a11y = `${styles}/_utils/_a11y.scss`;
  if (!tree.exists(index)) return;
  const api = tree.read(index, 'utf8') ?? '';
  if (api.includes("'_utils/a11y'")) return;

  // The mechanism builds on the house's own functions and focus ring; a design system that replaced those files is
  // not one this file can be dropped into blind.
  const missing = [`${styles}/_core/_functions.scss`, `${styles}/_utils/_mixins.scss`].filter((file) => !tree.exists(file));
  if (missing.length) {
    logger.warn(`[${WHO}] ${designSystem.name}: ${missing.join(', ')} not found, so ds.skip-link() / ds.visually-hidden() were not added — their mechanism builds on those files.`);
    return;
  }
  const clash = clashingMixins(tree, styles, a11y);
  if (clash.length) {
    logger.warn(
      `[${WHO}] ${designSystem.name} already defines ${clash.join(', ')} — so the house's \`_utils/a11y\` was not forwarded ` +
        `from ${index} (two forwarded mixins of one name are a sass error). Compare yours with the house's and keep one.`,
    );
    return;
  }

  if (!tree.exists(a11y)) tree.write(a11y, readFileSync(TEMPLATE, 'utf8'));
  const mixinsForward = /^@forward '_utils\/mixins'[^\n]*\n/m.exec(api);
  const next = mixinsForward
    ? `${api.slice(0, mixinsForward.index + mixinsForward[0].length)}\n// Accessibility mechanisms: \`visually-hidden($focusable)\` and the app shell's \`skip-link()\`.\n${FORWARD}\n${api.slice(mixinsForward.index + mixinsForward[0].length)}`
    : `${api.trimEnd()}\n\n// Accessibility mechanisms: \`visually-hidden($focusable)\` and the app shell's \`skip-link()\`.\n${FORWARD}\n`;
  tree.write(index, next);
  logger.info(
    `[${WHO}] ${designSystem.name} now exports ds.visually-hidden($focusable) and ds.skip-link() (${a11y}). Your apps' shells ` +
      `are yours, so none was changed — to give one a skip link: \`<a class="skip-link" href="#main">Skip to main content</a>\` ` +
      `first in the shell, the content in \`<main id="main" tabindex="-1">\`, and \`.skip-link { @include ds.skip-link(); }\` in its ` +
      `global stylesheet (Angular: move focus on click — with <base href="/"> a bare "#main" routes to the root; HOUSE.md has the snippet).`,
  );
}

/** Mixins named `visually-hidden` / `skip-link` the design system's styles already define (outside the house's file). */
function clashingMixins(tree: Tree, dir: string, own: string): string[] {
  const found = new Set<string>();
  const walk = (path: string): void => {
    for (const child of tree.children(path)) {
      const full = `${path}/${child}`;
      if (tree.isFile(full)) {
        if (full === own || !full.endsWith('.scss')) continue;
        for (const match of (tree.read(full, 'utf8') ?? '').matchAll(/@mixin\s+(visually-hidden|skip-link)\b/g)) found.add(`\`${match[1]}\` (${full})`);
      } else walk(full);
    }
  };
  walk(dir);
  return [...found];
}
