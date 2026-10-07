// 0.50.0 — the design system gains its accessibility mechanisms: `ds.visually-hidden($focusable)`, `ds.skip-link()`
// and `ds.skip-target()`, and the `z-skip-link` layer the skip link stacks on.
//
// WHAT CHANGED. A skip link (WCAG 2.4.1) needs "visually hidden UNTIL focused", and the design system only had the
// `%visually-hidden` placeholder — which cannot cross a component stylesheet and cannot be revealed on focus — so
// every project hand-wrote one (E5: into a component stylesheet, which then blew its size budget). From 0.50.0 the
// SASS API forwards a new `_utils/_a11y.scss`, and a new app's shell gets the `<main>` landmark from its stack and,
// on its first design-system wiring, the skip link WITH its look (`ds.skip-link()`, `ds.skip-target()`).
//
// WHAT IT DOES for an existing design system — additively, and only where nothing could collide:
//   1. adds the `z-skip-link` token after `z-modal` in the token file's base map (the skip link must stack above
//      modals — borrowing `z-modal` tied with them). The token file is the project's: only the stock shape (a
//      `'z-modal': …,` entry) is extended; any other shape is reported, and nothing below is done — `ds.skip-link()`
//      reads the token, and an unknown token is a compile-time @error;
//   2. seeds `styles/_utils/_a11y.scss` if absent. A file of that name that is NOT the house's is the project's own
//      (a common name): it is reported and nothing is forwarded — forwarding mixins it does not define would break
//      the build of every app that calls them;
//   3. adds `@forward '_utils/a11y' show visually-hidden, skip-link, skip-target;` to the PUBLIC API
//      (`styles/_index.scss`), after the mixins forward — never when the styles already define a mixin of one of
//      those names (two forwarded mixins of one name are a sass error), which is reported instead.
// It never touches an app: an existing app's shell is the app's own (class C). It REPORTS how to adopt the skip
// link in one, because a primitive nobody hears about is a primitive nobody uses.
import { type Tree, logger } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findDesignSystem } from '../../generators/_utils/design-system';

const WHO = '0.50.0/add-design-system-a11y';
const MIXINS = ['visually-hidden', 'skip-link', 'skip-target'];
const FORWARD = `@forward '_utils/a11y' show ${MIXINS.join(', ')};`;
const TEMPLATES = join(__dirname, '../../generators/design-system/files/styles');
const TOKEN = 'z-skip-link';

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
  const tokens = `${styles}/_core/_tokens.scss`;
  if (!tree.exists(index)) return;
  const api = tree.read(index, 'utf8') ?? '';
  if (api.includes("'_utils/a11y'")) return;
  const skip = (why: string) => logger.warn(`[${WHO}] ${designSystem.name}: ${why} — so ds.skip-link() / ds.visually-hidden() / ds.skip-target() were not added.`);

  // The mechanism builds on the house's own functions and focus ring; a design system that replaced those files is
  // not one this file can be dropped into blind.
  const missing = [`${styles}/_core/_functions.scss`, `${styles}/_utils/_mixins.scss`, tokens].filter((file) => !tree.exists(file));
  if (missing.length) return skip(`${missing.join(', ')} not found (the mechanism builds on them)`);
  const template = readFileSync(join(TEMPLATES, '_utils/_a11y.scss.tpl'), 'utf8');
  if (tree.exists(a11y) && tree.read(a11y, 'utf8') !== template) {
    return skip(`${a11y} exists and is not the house's — it is this project's own file of that name, and forwarding mixins it may not define would break every app that calls them. Rename yours, or compare it with the house's (${MIXINS.join(', ')}) and keep one`);
  }
  const clash = clashingMixins(tree, styles, a11y);
  if (clash.length) return skip(`it already defines ${clash.join(', ')} (two forwarded mixins of one name are a sass error) — compare yours with the house's and keep one`);

  const tokenText = tree.read(tokens, 'utf8') ?? '';
  if (!new RegExp(`'${TOKEN}'`).test(tokenText)) {
    const modal = /^([ \t]*)'z-modal':[^\n]*,[ \t]*\n/m.exec(tokenText);
    if (!modal) return skip(`${tokens} has no \`'z-modal': …,\` entry to place the \`${TOKEN}\` layer after — add \`'${TOKEN}'\` (above your modal layer) to the base map, and re-run the upgrade`);
    const at = modal.index + modal[0].length;
    const entry = `${modal[1]}// The skip link: above everything, modals included — a keyboard user's way past the chrome is never covered.\n${modal[1]}'${TOKEN}': 1100,\n`;
    tree.write(tokens, `${tokenText.slice(0, at)}${entry}${tokenText.slice(at)}`);
    logger.info(`[${WHO}] ${designSystem.name}: added the \`${TOKEN}\` layer to ${tokens} (above \`z-modal\`) — retune it with the rest of the stacking order.`);
  }

  if (!tree.exists(a11y)) tree.write(a11y, template);
  const comment = '// Accessibility mechanisms: `visually-hidden($focusable)`, and the app shell\'s `skip-link()` and `skip-target()`.';
  const mixinsForward = /^@forward '_utils\/mixins'[^\n]*\n/m.exec(api);
  const next = mixinsForward
    ? `${api.slice(0, mixinsForward.index + mixinsForward[0].length)}\n${comment}\n${FORWARD}\n${api.slice(mixinsForward.index + mixinsForward[0].length)}`
    : `${api.trimEnd()}\n\n${comment}\n${FORWARD}\n`;
  tree.write(index, next);
  logger.info(
    `[${WHO}] ${designSystem.name} now exports ds.visually-hidden($focusable), ds.skip-link() and ds.skip-target() (${a11y}). Your ` +
      `apps' shells are yours, so none was changed — to give one a skip link: \`<a class="skip-link" href="#main">Skip to main content</a>\` ` +
      `first in the shell, the content in \`<main id="main" tabindex="-1">\`, and \`.skip-link { @include ds.skip-link(); }\` + ` +
      `\`#main { @include ds.skip-target(); }\` in its global stylesheet (Angular: move focus on click — with <base href="/"> a bare "#main" ` +
      `routes to the root; HOUSE.md has the snippet).`,
  );
}

/** Mixins of the house's names the design system's styles already define (outside the house's file). */
function clashingMixins(tree: Tree, dir: string, own: string): string[] {
  const found = new Set<string>();
  const pattern = new RegExp(`@mixin\\s+(${MIXINS.join('|')})\\b`, 'g');
  const walk = (path: string): void => {
    for (const child of tree.children(path)) {
      const full = `${path}/${child}`;
      if (tree.isFile(full)) {
        if (full === own || !full.endsWith('.scss')) continue;
        for (const match of (tree.read(full, 'utf8') ?? '').matchAll(pattern)) found.add(`\`${match[1]}\` (${full})`);
      } else walk(full);
    }
  };
  walk(dir);
  return [...found];
}
