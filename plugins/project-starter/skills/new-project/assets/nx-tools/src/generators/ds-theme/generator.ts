// House generator: add a THEME to the design system — a brand, a tenant palette, a user-selectable skin.
//
//     nx g @bespunky/nx-tools:ds-theme acme
//     -> packages/design-system/themes/acme.theme.scss   (authored in SASS, against the real tokens)
//     -> every Angular app's build emits `theme-acme.css` as a STANDALONE file (inject: false)
//     -> swap it at runtime:  inject(DsRuntimeTheme).use('theme-acme.css')
//
// WHY A CSS FILE AND NOT JAVASCRIPT — this is the whole design, so it's worth stating plainly:
//   - NO FLASH. A <link> in <head> is applied BEFORE first paint. Any JS-applied theme lands after the
//     bundle boots, so the user watches the default theme paint and then snap to the brand. That flash is
//     unfixable from a service, and it is the reason this is not a JS API.
//   - COMPILE-TIME GUARANTEES SURVIVE. The theme is authored in SASS with `ds.theme-overrides()`, so an
//     unknown token name is a BUILD ERROR — the same guard component SCSS gets. A theme shipped as an
//     unvalidated JSON blob throws that away, and a typo'd key then resolves to nothing, silently.
//   - The browser caches, revalidates and CDN-serves it for free. No string-building, no <style> injection.
//
// `inject: false` + `bundleName` is Angular's own mechanism for exactly this: the stylesheet is compiled
// and emitted as its own file, but NOT linked into index.html automatically — which is what makes it
// swappable rather than always-on.
import {
  type Tree,
  formatFiles,
  getProjects,
  readProjectConfiguration,
  updateProjectConfiguration,
  names,
  logger,
  joinPathFragments,
} from '@nx/devkit';
import { findDesignSystem, isAngularApp } from '../_utils/design-system';

interface DsThemeSchema {
  /** The theme name, e.g. `acme` -> themes/acme.theme.scss -> theme-acme.css. */
  name: string;
  skipFormat?: boolean;
}

export default async function dsThemeGenerator(tree: Tree, options: DsThemeSchema): Promise<void> {
  if (!options.name) {
    throw new Error('ds-theme generator requires a theme name (positional arg 0 / --name), e.g. `acme`.');
  }

  const designSystem = findDesignSystem(tree);
  if (!designSystem) {
    throw new Error(
      'ds-theme: no design system in this workspace. Run `nx g @bespunky/nx-tools:design-system` first.'
    );
  }

  const themeName = names(options.name).fileName;
  const bundleName = `theme-${themeName}`;
  const themePath = joinPathFragments(designSystem.root, 'themes', `${themeName}.theme.scss`);

  // 1) The theme source. Seeded, never overwritten — after the first run this file is the project's
  //    design, and a re-run must not wipe a brand someone spent a week on.
  if (!tree.exists(themePath)) {
    tree.write(themePath, themeSource(themeName));
  } else {
    logger.info(`[ds-theme] ${themePath} already exists — left untouched; re-asserting the build wiring only.`);
  }

  // 2) Register it on every Angular app's build target as a STANDALONE stylesheet. Idempotent: matched by
  //    bundleName, so a re-run updates rather than duplicating.
  let wired = 0;
  for (const [appName] of getProjects(tree)) {
    if (!isAngularApp(tree, appName)) continue;
    if (registerThemeBundle(tree, appName, themePath, bundleName)) wired++;
  }

  if (!options.skipFormat) await formatFiles(tree);

  logger.info(
    `[ds-theme] Created the "${themeName}" theme (wired into ${wired} app(s)). It builds to ` +
      `\`${bundleName}.css\`. Link it in index.html to apply it before first paint:\n` +
      `    <link id="ds-theme" rel="stylesheet" href="${bundleName}.css">\n` +
      `…or swap it at runtime: \`inject(DsRuntimeTheme).use('${bundleName}.css')\`.`
  );
}

/**
 * Add `{ input, bundleName, inject: false }` to the app's build `styles`.
 *
 * `inject: false` is what makes the theme SWAPPABLE: Angular compiles and emits the stylesheet as its own
 * file but does not add it to index.html, so the app links whichever theme it wants (or none). Without it
 * the theme would be force-applied to everyone, always — the opposite of a theme.
 */
function registerThemeBundle(tree: Tree, appName: string, input: string, bundleName: string): boolean {
  const project = readProjectConfiguration(tree, appName);
  const build = project.targets?.build;
  if (!build) return false;

  build.options ??= {};
  const options = build.options as Record<string, unknown>;
  const styles = [...((options.styles as unknown[]) ?? [])];

  const existing = styles.findIndex(
    (entry) => typeof entry === 'object' && entry !== null && (entry as { bundleName?: string }).bundleName === bundleName
  );
  const entry = { input, bundleName, inject: false };

  if (existing >= 0) styles[existing] = entry;
  else styles.push(entry);

  options.styles = styles;
  updateProjectConfiguration(tree, appName, project);
  return true;
}

/** The starting theme file — authored in SASS, so every token name is checked at BUILD time. */
function themeSource(themeName: string): string {
  return (
    `// The "${themeName}" theme — a standalone stylesheet of TOKEN OVERRIDES, compiled to \`theme-${themeName}.css\`\n` +
    `// and applied by linking it. Nothing else in the app changes; every component re-themes through the\n` +
    `// cascade, because components read \`var(--ds-…)\` and never a literal.\n` +
    `//\n` +
    `// Authored in SASS on purpose: an unknown token name here is a BUILD ERROR, not a value that silently\n` +
    `// does nothing at runtime. A theme can only RE-BIND tokens the design system already declares — it\n` +
    `// cannot introduce new ones, because no component would be reading them.\n` +
    `//\n` +
    `// Override any colour in BOTH modes: a token overridden in light but not dark keeps the built-in value\n` +
    `// in dark, so the brand would only half-apply (the compiler warns you about exactly this).\n` +
    `@use '../styles' as ds;\n` +
    `\n` +
    `@include ds.theme-overrides(\n` +
    `  // Mode-independent overrides (radius, space, duration…).\n` +
    `  $base: (\n` +
    `    // 'radius-md': 10px,\n` +
    `  ),\n` +
    `  $light: (\n` +
    `    // 'color-primary': #c0392b,\n` +
    `    // 'color-on-primary': #ffffff,\n` +
    `  ),\n` +
    `  $dark: (\n` +
    `    // 'color-primary': #ff8a7a,\n` +
    `    // 'color-on-primary': #1c1c20,\n` +
    `  )\n` +
    `);\n`
  );
}
