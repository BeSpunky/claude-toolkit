// 0.45.0 — the design system's default mode moves out of the app's generator-owned theme block, into the tokens.
//
// WHY. `design-system-styles` owns the `@include ds.theme();` block in every app's global stylesheet and re-asserts
// it on every run, and that call was the only place a project could choose a mode — so a hand-written
// `ds.theme('dark')` was overwritten on every upgrade. Worse, under the stock mixin the argument was only the
// `:root` fallback: the OS preference outranked it for every visitor who had not pinned a mode, so "dark unless
// the user chooses" was not expressible at all. 0.45.0 models it: `$default-mode` in the design system's
// `_tokens.scss` (the file the design phase owns), `'system'` (follow the OS) or a mode name (fixed).
//
// WHAT IT DOES, per design system:
//   1. CARRY the project's choice into `_tokens.scss` as `$default-mode` (unless it already declares one). The
//      choice is what each app's theme call effectively asked for — its argument, else the mixin's own default —
//      and an effective `'light'` (the stock) is today's behaviour, i.e. `'system'`. A different mode is carried as
//      a FIXED default: that is what writing `'dark'` was asking for, and it is reported, since the meaning
//      sharpened. Apps that disagree cannot share one default: reported, `'system'` written.
//   2. CLEAR the original: every app's theme call loses its argument (carrying data means clearing the copy —
//      the per-app generator that would rewrite the block is skipped on an UPGRADE_PARTIAL run).
//   3. UPGRADE the seeded mechanism files that must read the token — `_theme.scss`, and the runtime that resolves
//      what a visitor sees (`ds-theme.service.ts` + `ds-runtime-theme.service.ts`, or the neutral `ds-mode.ts`).
//      They are SEEDED, i.e. the project's to edit, so a file is replaced only when it is still exactly the stock
//      0.44 shape (each has had one stock shape since the design system shipped; compared modulo whitespace,
//      quote style, trailing commas and the token prefix — what a formatter changes). A customised one is
//      REPORTED, with the way to re-seed it, never edited on a guess.
import { type Tree, logger } from '@nx/devkit';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findDesignSystem } from '../../generators/_utils/design-system';
import { applicationsWith } from '../../adapters/registry';
import { THEME_START, THEME_END } from '../../generators/design-system-styles/generator';

const TAG = '[0.45.0 carry-default-mode-into-tokens]';
const SRC = join(__dirname, '../..');

/** The seeded mechanism files, with the fingerprint of the one stock shape each had through 0.44.x. */
const MECHANISM = [
  {
    file: 'styles/_core/_theme.scss',
    template: 'generators/design-system/files/styles/_core/_theme.scss.tpl',
    stock044: '3a31f79b8c546815bce30e9d736587dceec48094181107a022eae20d7c37fa09',
  },
  {
    file: 'src/lib/ds-theme.service.ts',
    template: 'adapters/angular/design-system-files/src/lib/ds-theme.service.ts.tpl',
    stock044: '7c1f351eadfb3d3894502ebcbd05fbcb5977f2f76c5cfd71235201a934492bf7',
    importsDefaultModeModule: true,
  },
  {
    file: 'src/lib/ds-runtime-theme.service.ts',
    template: 'adapters/angular/design-system-files/src/lib/ds-runtime-theme.service.ts.tpl',
    stock044: 'cd9c857760c51fa0267e97d8c1e8f22bf9a1e3b0a4ab91831bb984f1fb5281ac',
    importsDefaultModeModule: true,
  },
  {
    file: 'src/lib/ds-mode.ts',
    template: 'generators/design-system/neutral/src/lib/ds-mode.ts.tpl',
    stock044: 'c719b27000127ac22e6c3ae30f9a241a7aacd99a3047d3b6dbc7e43807d5459c',
  },
] as const;

/** New in 0.45.0 beside the Angular services, which import it. A new file, so writing it can break nothing. */
const DEFAULT_MODE_MODULE = {
  file: 'src/lib/ds-default-mode.ts',
  template: 'adapters/angular/design-system-files/src/lib/ds-default-mode.ts.tpl',
} as const;

const DECLARATION = /^\$default-mode\s*:/m;
const THEME_CALL = /@include\s+ds\.theme\(\s*(?:(?:\$default-mode\s*:\s*)?(['"])([\w-]+)\1)?\s*\)/;

export default async function carryDefaultModeIntoTokens(tree: Tree): Promise<void> {
  const ds = findDesignSystem(tree);
  if (!ds) return;
  const tokensPath = `${ds.root}/styles/_core/_tokens.scss`;
  const themePath = `${ds.root}/styles/_core/_theme.scss`;
  if (!tree.exists(tokensPath)) {
    logger.warn(`${TAG} ${tokensPath} not found — nothing to carry the default mode into. Skipped.`);
    return;
  }
  const tokens = tree.read(tokensPath, 'utf8') ?? '';
  const prefix = /^\$prefix\s*:\s*['"]([^'"]+)['"]/m.exec(tokens)?.[1] ?? null;

  const calls = themeCalls(tree);

  // 1) Carry.
  if (!DECLARATION.test(tokens)) {
    const mixinDefault = tree.exists(themePath)
      ? /@mixin\s+theme\(\s*\$default-mode\s*:\s*['"]([\w-]+)['"]/.exec(tree.read(themePath, 'utf8') ?? '')?.[1] ?? null
      : null;
    const effective = (calls.length ? calls.map((c) => c.arg) : [null]).map((arg) => arg ?? mixinDefault ?? 'light');
    const distinct = [...new Set(effective)];
    let value = 'system';
    if (distinct.length === 1 && distinct[0] !== 'light') {
      value = distinct[0];
      logger.info(
        `${TAG} Carried the default mode '${value}' into ${tokensPath} as \`$default-mode: '${value}'\`. It now means ` +
          `what a visitor sees until they choose a mode, WHATEVER THE OS SAYS (before, the OS preference outranked ` +
          `it). For the old OS-following behaviour, set it to 'system'.`,
      );
    } else if (distinct.length > 1) {
      logger.warn(
        `${TAG} The apps ask for different default modes (${calls.map((c) => `${c.path}: ${c.arg ?? 'none'}`).join('; ')}), ` +
          `and the design system has one. Wrote \`$default-mode: 'system'\` (follow the OS) to ${tokensPath} — set the ` +
          `mode the design defaults to there.`,
      );
    }
    tree.write(tokensPath, declare(tokens, value, prefix ?? '<prefix>'));
  }

  // 2) Clear the original.
  for (const call of calls) {
    if (call.arg === null) continue;
    const source = tree.read(call.path, 'utf8') ?? '';
    const from = source.indexOf(THEME_START);
    const to = source.indexOf(THEME_END, from);
    const block = source.slice(from, to).replace(THEME_CALL, '@include ds.theme()');
    tree.write(call.path, source.slice(0, from) + block + source.slice(to));
    logger.info(`${TAG} ${call.path}: \`ds.theme('${call.arg}')\` → \`ds.theme()\` — the mode now lives in ${tokensPath}.`);
  }

  // 3) The mechanism that reads it.
  if (prefix === null) {
    logger.warn(
      `${TAG} ${tokensPath} declares no \`$prefix\`, so the seeded theme files cannot be checked against their stock ` +
        `shape. They still ignore \`$default-mode\`: delete ${MECHANISM.map((m) => `${ds.root}/${m.file}`).filter((p) => tree.exists(p)).join(', ')} ` +
        `and re-run the upgrade to re-seed them, carrying over any edits of your own.`,
    );
    return;
  }
  let angularUpgraded = false;
  for (const m of MECHANISM) {
    const path = `${ds.root}/${m.file}`;
    if (!tree.exists(path)) continue;
    const current = tree.read(path, 'utf8') ?? '';
    const next = render(m.template, prefix);
    if (fingerprint(current, prefix) === fingerprint(next, prefix)) continue; // already current
    if (fingerprint(current, prefix) !== m.stock044) {
      logger.warn(
        `${TAG} ${path} differs from the stock file the design system seeded, so it was left as it is — and it ` +
          `does not read \`$default-mode\` yet. To take the 0.45.0 version: delete it and re-run the upgrade (the ` +
          `design-system generator re-seeds a missing file), then carry over your own edits.`,
      );
      continue;
    }
    tree.write(path, next);
    if ('importsDefaultModeModule' in m) angularUpgraded = true;
    logger.info(`${TAG} ${path}: replaced the stock 0.44 file with the 0.45.0 one, which reads \`$default-mode\`.`);
  }
  const moduleFile = `${ds.root}/${DEFAULT_MODE_MODULE.file}`;
  if (angularUpgraded && !tree.exists(moduleFile)) tree.write(moduleFile, render(DEFAULT_MODE_MODULE.template, prefix));
}

/** Each styled app's theme block: where it is and the argument its `ds.theme(…)` call passes (null for none). */
function themeCalls(tree: Tree): Array<{ path: string; arg: string | null }> {
  const found: Array<{ path: string; arg: string | null }> = [];
  for (const { project, port } of applicationsWith(tree, 'styles')) {
    const path = port.globalStylesheet(tree, project);
    if (!path || !tree.exists(path)) continue;
    const source = tree.read(path, 'utf8') ?? '';
    const from = source.indexOf(THEME_START);
    const to = source.indexOf(THEME_END, from);
    if (from === -1 || to === -1) continue;
    const call = THEME_CALL.exec(source.slice(from, to));
    if (call) found.push({ path, arg: call[2] ?? null });
  }
  return found;
}

/** `$default-mode` declared exactly as a 0.45.0 seed declares it: right after `$prefix`, else before `$modes`. */
function declare(tokens: string, value: string, prefix: string): string {
  const declaration =
    `/// What a visitor sees until THEY choose a mode (the runtime's \`setMode\` / \`DsTheme.mode\`) — a DESIGN decision,\n` +
    `/// which is why it lives here, in the one file the design phase owns, and not in an app's stylesheet:\n` +
    `///   'system'  — follow the OS (\`prefers-color-scheme\`). The first mode in \`$modes\` is the fallback for a browser\n` +
    `///               that states no preference.\n` +
    `///   a mode    — that mode, whatever the OS says. A dark-first design is \`'dark'\`.\n` +
    `/// \`theme()\` reads it; it is also emitted as \`--${prefix}-default-mode\`, which is how the runtime knows.\n` +
    `$default-mode: '${value}';\n`;
  const afterPrefix = /^\$prefix\s*:[^\n]*\n/m.exec(tokens);
  if (afterPrefix) {
    const at = afterPrefix.index + afterPrefix[0].length;
    return `${tokens.slice(0, at)}\n${declaration}${tokens.slice(at)}`;
  }
  const modes = /^\$modes\s*:/m.exec(tokens);
  if (modes) return `${tokens.slice(0, modes.index)}${declaration}\n${tokens.slice(modes.index)}`;
  return `${tokens.trimEnd()}\n\n${declaration}`;
}

function render(template: string, prefix: string): string {
  return readFileSync(join(SRC, template), 'utf8').replaceAll('{{tokenPrefix}}', prefix);
}

/**
 * A seeded file's shape, independent of what a formatter or the token prefix changed: the prefix folded back to its
 * placeholder, whitespace dropped, quotes unified, trailing commas removed. Exported for the fixture test.
 */
export function fingerprint(text: string, prefix: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unrendered = text.replace(new RegExp(`(data-|--|['"])${escaped}-`, 'g'), '$1{{tokenPrefix}}-');
  const flat = unrendered.replace(/"/g, "'").replace(/\s+/g, '').replace(/,([)\]}])/g, '$1');
  return createHash('sha256').update(flat).digest('hex');
}
