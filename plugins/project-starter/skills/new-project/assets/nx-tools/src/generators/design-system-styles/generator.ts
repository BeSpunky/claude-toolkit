// House generator: open the design system's SASS channel on ONE Angular app.
//
// The per-app half of the design system, and the reason a LATER app is correct by construction. It is
// composed by BOTH:
//   - `design-system`  — for every app that already exists when the DS lands (the scaffold's first app,
//                        and every app in the workspace on a --repair), and
//   - `app`            — for every app created afterwards.
// so `nx g @bespunky/nx-tools:app apps/admin` in a design-system workspace comes out sass-wired with no
// flag and no recollection that this workspace has a design system. Self-detecting, exactly like the
// firebase wiring. No design system in the workspace -> clean no-op.
//
// WHAT IT WRITES, and why each piece is necessary:
//
//   1. build.options.stylePreprocessorOptions.includePaths += <the DS's parent dir>
//      The in-repo sass channel. The workspace links via tsconfig.base.json path aliases, and SASS does
//      not read those — so a load path is the only way `@use 'design-system/styles'` can resolve.
//
//   2. project.implicitDependencies += <design-system>                       <-- CACHE CORRECTNESS
//      Step 4 wires `import { provideDesignSystem } from '<ds>'` into app.config.ts — a tsconfig-path
//      alias Nx already resolves into an app->DS graph edge, so a token edit already invalidates
//      `nx build <app>` and `^production`/`^default` already hash the DS's styles. This implicit
//      dependency is the belt to that braces: it guarantees the edge even if the provider wiring can't
//      match app.config.ts. It is deliberately NOT a hand-rolled `inputs` array — a project-level
//      `inputs` OVERRIDES the inferred/targetDefault inputs wholesale, and a hardcoded named input
//      (`production`) hard-fails `nx build` on any workspace whose nx.json doesn't define it (a real
//      `--repair`-on-a-foreign-project failure). A graph edge also keeps `nx affected` correct.
//
//   3. The two marker blocks in the app's global stylesheet: the `@use` (prepended) and the
//      `@include ds.theme()` (appended). TWO blocks, not one, because sass requires every `@use` to
//      precede any other rule — a single block containing both would break the moment the app's own
//      stylesheet has a `@use` of its own further down.
//
// Idempotent + --repair-safe: arrays are MERGED and de-duplicated (never clobbered — an app may have
// its own includePaths for something else), and the marker blocks are upserted between their markers
// (the house-doc pointer idiom), so everything OUTSIDE the markers stays the developer's.
import {
  type Tree,
  readJson,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
  logger,
} from '@nx/devkit';
import { dirname, basename } from 'node:path';
import { findDesignSystem, isAngularApp } from '../_utils/design-system';
import { wireProvider } from '../_utils/wire-provider';

interface DesignSystemStylesSchema {
  project: string;
  skipFormat?: boolean;
}

const USE_START = '/* @bespunky/design-system:use:start — generator-owned. */';
const USE_END = '/* @bespunky/design-system:use:end */';
const THEME_START = '/* @bespunky/design-system:theme:start — generator-owned. */';
const THEME_END = '/* @bespunky/design-system:theme:end */';

export default async function designSystemStylesGenerator(
  tree: Tree,
  options: DesignSystemStylesSchema
): Promise<void> {
  if (!options.project) {
    throw new Error('design-system-styles generator requires --project=<app>.');
  }

  // No design system in this workspace (a pre-DS project, or the scaffold's first app, created before
  // the DS lib exists) -> nothing to wire. Not an error.
  const designSystem = findDesignSystem(tree);
  if (!designSystem) return;

  if (!isAngularApp(tree, options.project)) {
    logger.info(
      `[design-system-styles] Skipped \`${options.project}\` — not an Angular application ` +
        `(only browser apps consume the design system's sass).`
    );
    return;
  }

  // Sanity-gate on the sass barrel actually being there, so we never point an app's load path at a
  // library that can't answer `@use 'design-system/styles'`.
  const barrel = `${designSystem.root}/styles/_index.scss`;
  if (!tree.exists(barrel)) {
    logger.warn(
      `[design-system-styles] The design system at \`${designSystem.root}\` has no sass barrel ` +
        `(${barrel}) — skipped wiring \`${options.project}\`. Run \`nx g @bespunky/nx-tools:design-system\` first.`
    );
    return;
  }

  const loadPath = dirname(designSystem.root); // e.g. `packages` — the app's sass load path
  const specifier = `${basename(designSystem.root)}/styles`; // e.g. `design-system/styles`

  const project = readProjectConfiguration(tree, options.project);
  const build = project.targets?.build;
  if (!build) {
    logger.warn(`[design-system-styles] \`${options.project}\` has no \`build\` target — skipped.`);
    return;
  }

  // 1) The sass load path. Merge + dedupe: an app may already carry includePaths of its own, and a
  //    --repair must re-assert ours without dropping theirs.
  // ASSUMPTION (verify in Docker against @angular/build): `stylePreprocessorOptions.includePaths`
  //   entries are resolved relative to the WORKSPACE ROOT (not the project root). The entire in-repo
  //   channel rests on this. If they turn out to be project-relative, the fix is a `../..`-style path
  //   derived from the app's own root.
  build.options ??= {};
  const preprocessor = { ...((build.options as Record<string, unknown>).stylePreprocessorOptions as Record<string, unknown> ?? {}) };
  const includePaths = new Set<string>([...((preprocessor.includePaths as string[]) ?? []), loadPath]);
  preprocessor.includePaths = [...includePaths];
  (build.options as Record<string, unknown>).stylePreprocessorOptions = preprocessor;

  // 2) Cache correctness, declared the idiomatic Nx way — an implicit dependency on the design system.
  //    Step 4 wires `import { provideDesignSystem } from '<ds>'` into app.config.ts, a tsconfig-path-alias
  //    import Nx's graph already resolves into an app->DS edge (so `^production`/`^default` already hash
  //    the DS's styles and a token edit already invalidates `nx build <app>`). This `implicitDependencies`
  //    entry is the belt to that braces: it guarantees the edge even in the degraded case where the
  //    provider wiring below can't match app.config.ts, WITHOUT the hazards of a hand-rolled `inputs`
  //    array — which would (a) OVERRIDE the inferred/targetDefault inputs wholesale, and (b) hard-fail
  //    `nx build` on any workspace whose nx.json doesn't define the `production` namedInput (a real
  //    `--repair`-on-a-foreign-project failure). A real graph edge also keeps `nx affected` correct.
  const deps = new Set<string>([...(project.implicitDependencies ?? []), designSystem.name]);
  // Never make a project depend on itself (design-system-styles is only ever run on apps, but be safe).
  deps.delete(options.project);
  project.implicitDependencies = [...deps];

  updateProjectConfiguration(tree, options.project, project);

  // 3) The app's global stylesheet — derived from the build target, never assumed to be src/styles.scss.
  wireGlobalStylesheet(tree, build, specifier, options.project);

  // 4) Install the design system into the app's ApplicationConfig. This lives here, on the per-app path,
  //    rather than in the `design-system` generator, so that BOTH the first app and every later one get
  //    it from ONE code path — a later app that got the sass but not the provider would render with the
  //    tokens but never respond to a mode change, which is the kind of half-wiring nobody debugs quickly.
  wireDesignSystemProvider(tree, options.project, readImportPath(tree, designSystem.root));

  if (!options.skipFormat) await formatFiles(tree);
}

/** The design system's published package name — the specifier an app imports its TS surface from. */
function readImportPath(tree: Tree, designSystemRoot: string): string {
  const pkgPath = `${designSystemRoot}/package.json`;
  const name = tree.exists(pkgPath) ? readJson<{ name?: string }>(tree, pkgPath).name : undefined;
  // The tsconfig path alias is keyed on the package name, so this is also the in-repo import specifier.
  return name ?? basename(designSystemRoot);
}

/**
 * Add `provideDesignSystem()` to the app's `appConfig.providers` (+ the import).
 *
 * Eagerly instantiating `DsTheme` is what puts the mode attribute on <html> from the FIRST paint. Without
 * it the service is never constructed until some component injects it, so the app boots in the wrong
 * theme and then snaps — a flash the user sees and nobody can reproduce on demand.
 *
 * Idempotent (a --repair re-run is a no-op), and warns with a manual instruction rather than crashing if
 * the app.config shape is unrecognized.
 */
function wireDesignSystemProvider(tree: Tree, projectName: string, importPath: string): void {
  const appRoot = readProjectConfiguration(tree, projectName).root;
  const appConfigPath = `${appRoot}/src/app/app.config.ts`;
  if (!tree.exists(appConfigPath)) return;

  const current = tree.read(appConfigPath, 'utf8') ?? '';
  const wired = wireProvider(current, appConfigPath, {
    providerFn: 'provideDesignSystem',
    importFrom: importPath,
  });

  if (wired && wired !== current) tree.write(appConfigPath, wired);
  else if (wired === null) {
    logger.warn(
      `[design-system-styles] Could not auto-wire ${appConfigPath}. Add ` +
        `\`import { provideDesignSystem } from '${importPath}';\` and include \`provideDesignSystem()\` ` +
        `in your providers array manually — it installs the theme's mode attribute on <html> at startup.`
    );
  }
}

/**
 * Upsert the `@use` and `@include ds.theme()` marker blocks into the app's GLOBAL stylesheet.
 *
 * The stylesheet is located from `build.options.styles[0]` — the app's own declaration of what its global
 * stylesheet is — rather than assuming `src/styles.scss`, which is merely the @nx/angular default.
 *
 * The two blocks are placed at opposite ends on purpose:
 *   - the `@use` block is PREPENDED at offset 0, because sass rejects a `@use` that follows any other
 *     rule, and the app may well have `@use`s of its own further down;
 *   - the `theme()` call is APPENDED at EOF, where it is legal anywhere after the `@use`.
 * Both are upserted between their markers, so a re-run is a no-op and anything the developer wrote
 * outside them survives untouched.
 */
function wireGlobalStylesheet(
  tree: Tree,
  build: { options?: Record<string, unknown> },
  specifier: string,
  projectName: string
): void {
  const styles = (build.options?.styles as (string | { input?: string })[] | undefined) ?? [];
  const first = styles[0];
  const stylesPath = typeof first === 'string' ? first : first?.input;

  if (!stylesPath || !stylesPath.endsWith('.scss') || !tree.exists(stylesPath)) {
    logger.warn(
      `[design-system-styles] Could not find a global SCSS stylesheet for \`${projectName}\` ` +
        `(build.options.styles[0]${stylesPath ? ` = ${stylesPath}` : ''}). Add these two lines yourself:\n` +
        `    @use '${specifier}' as ds;   // at the very top\n` +
        `    @include ds.theme();          // anywhere after it\n` +
        `Without them the app has no design tokens at runtime.`
    );
    return;
  }

  const current = tree.read(stylesPath, 'utf8') ?? '';

  const useBlock = `${USE_START}\n@use '${specifier}' as ds;\n${USE_END}`;
  const themeBlock =
    `${THEME_START}\n` +
    `/* Emits the design tokens as CSS custom properties (:root + [data-*-mode] + the OS preference).\n` +
    `   Called EXACTLY ONCE, here. Never from a component's SCSS. */\n` +
    `@include ds.theme();\n` +
    `${THEME_END}`;

  let next = upsert(current, USE_START, USE_END, useBlock, 'prepend');
  next = upsert(next, THEME_START, THEME_END, themeBlock, 'append');

  if (next !== current) tree.write(stylesPath, next);
}

/**
 * Replace the text between `start` and `end` markers with `block`; if the markers aren't there yet,
 * insert the block at the top or the bottom of the file (per `placement`). The house-doc pointer idiom.
 *
 * ORPHAN GUARD: if exactly one marker survives (a developer half-deleted the block while editing), the
 * naive "both present?" check would take the insert branch and prepend a SECOND `@use` while the first
 * lingers — sass then hard-errors on the duplicate. When we see a lone marker we treat the block as
 * present-but-damaged and rewrite from the surviving marker, rather than duplicating.
 */
function upsert(source: string, start: string, end: string, block: string, placement: 'prepend' | 'append'): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end);

  if (from !== -1 && to !== -1 && to > from) {
    return source.slice(0, from) + block + source.slice(to + end.length);
  }

  // Exactly one marker present → the block was damaged. Splice from whichever marker we have.
  if (from !== -1 && to === -1) return source.slice(0, from) + block + source.slice(from + start.length);
  if (from === -1 && to !== -1) return source.slice(0, to) + block + source.slice(to + end.length);

  if (placement === 'prepend') return `${block}\n\n${source.trimStart()}`;
  return `${source.trimEnd()}\n\n${block}\n`;
}
