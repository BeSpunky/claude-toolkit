// House generator: open the design system's SASS channel on ONE app.
//
// The per-app half of the design system, and the reason a LATER app is correct by construction. It runs from
// BOTH:
//   - `design-system`  — for every app that already exists when the DS lands (the scaffold's first app, and
//                        every app in the workspace on an upgrade), and
//   - `app`            — for every app created afterwards (the design-system layer's per-app step).
// Self-detecting: no design system in the workspace -> clean no-op.
//
// FRAMEWORK-NEUTRAL, through the app's STACK ADAPTER: the load path and the stylesheet's location come from its
// `styles` port, the provider from its `providers` port. An app whose stack has no styles port is REPORTED and
// left alone (see adapters/registry `portOf`) — never handed config it cannot read.
//
// WHAT IT WRITES, and why each piece is necessary:
//   0. the design system LINKED to this app, the workspace's way (`_utils/linking`): under `paths` the global
//      alias already reaches every app (nothing to add); under `workspaces` the app's governing package.json
//      DECLARES the design-system package — without it pnpm never links it and the provider's import below
//      resolves only by the accident of hoisting.
//   1. the DS's parent dir as a sass LOAD PATH (styles port) — SASS reads neither path aliases nor package
//      `exports`, so a load path is the one channel that resolves `@use 'design-system/styles'` under both
//      linkings (see the design-system generator's SASS CHANNEL note).
//   2. project.implicitDependencies += <design-system>                       <-- CACHE CORRECTNESS
//      A load path is not a graph edge; without one a token edit can leave `nx build <app>` replaying a cached
//      bundle with the OLD tokens. Deliberately NOT a hand-rolled `inputs` array — a project-level `inputs`
//      OVERRIDES the inferred/targetDefault inputs wholesale, and a hardcoded named input hard-fails
//      `nx build` on any workspace whose nx.json doesn't define it. A graph edge also keeps `nx affected` right.
//   3. the two marker blocks in the app's global stylesheet: the `@use` (prepended) and `@include ds.theme()`
//      (appended). TWO blocks because sass requires every `@use` to precede any other rule.
//   4. the design system's runtime provider (its binding's, e.g. provideDesignSystem()) — only into an app of
//      the SAME stack as the binding: a framework's provider is that framework's code.
//
// Idempotent + upgrade-safe: arrays are MERGED and de-duplicated, and the marker blocks are upserted between
// their markers, so everything OUTSIDE them stays the developer's.
import {
  type Tree,
  readJson,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
  logger,
} from '@nx/devkit';
import { dirname, basename } from 'node:path';
import { findDesignSystem } from '../_utils/design-system';
import { adapterOf, isApplication, portOf } from '../../adapters/registry';
import { workspaceLinking } from '../_utils/linking';

interface DesignSystemStylesSchema {
  /** See wireProviders in schema.json — wiring is a BASELINE act, never a sync-time one. */
  wireProviders?: boolean;
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

  // No design system in this workspace (a pre-DS project, or the scaffold's first app, created before the DS
  // lib exists) -> nothing to wire. Not an error.
  const designSystem = findDesignSystem(tree);
  if (!designSystem) return;

  // Only APPLICATIONS consume the design system's sass — a library builds no global stylesheet.
  if (!isApplication(tree, options.project)) {
    logger.info(`[design-system-styles] Skipped \`${options.project}\` — not an application.`);
    return;
  }
  const styles = portOf(tree, options.project, 'styles', 'design-system-styles', "the design system's sass channel");
  if (!styles) return;

  // Sanity-gate on the sass barrel actually being there, so we never point an app's load path at a library
  // that can't answer `@use 'design-system/styles'`.
  const barrel = `${designSystem.root}/styles/_index.scss`;
  if (!tree.exists(barrel)) {
    logger.warn(
      `[design-system-styles] The design system at \`${designSystem.root}\` has no sass barrel ` +
        `(${barrel}) — skipped wiring \`${options.project}\`. Run \`nx g @bespunky/nx-tools:design-system\` first.`
    );
    return;
  }

  // 0) The app consumes the design system: link it, the workspace's way.
  const importPath = readImportPath(tree, designSystem.root);
  const appRoot = readProjectConfiguration(tree, options.project).root;
  workspaceLinking(tree).link(tree, { importPath, libRoot: designSystem.root, consumerRoot: appRoot });

  const loadPath = dirname(designSystem.root); // e.g. `packages` — the app's sass load path
  const specifier = `${basename(designSystem.root)}/styles`; // e.g. `design-system/styles`

  // 1) The sass load path.
  if (!styles.addLoadPath(tree, options.project, loadPath)) {
    logger.warn(`[design-system-styles] \`${options.project}\` has no \`build\` target — skipped.`);
    return;
  }

  // 2) Cache correctness, the idiomatic Nx way — an implicit dependency on the design system (never on itself).
  //    Written with `targets` LAST — the order devkit's `readProjectConfiguration` hands a project back in. Adding the
  //    key onto the object as read appended it AFTER targets, so the NEXT sync (read → write, through any port)
  //    moved it back above them: a one-time reshuffle of every app's project.json, a diff nobody asked for
  //    (caught by tools/test-generators' idempotence check).
  const { targets, ...project } = readProjectConfiguration(tree, options.project);
  const deps = new Set<string>([...(project.implicitDependencies ?? []), designSystem.name]);
  deps.delete(options.project);
  updateProjectConfiguration(tree, options.project, { ...project, implicitDependencies: [...deps], ...(targets ? { targets } : {}) });

  // 3) The app's global stylesheet, as the app itself declares it.
  wireGlobalStylesheet(tree, styles.globalStylesheet(tree, options.project), specifier, options.project);

  // 4) The runtime binding's provider, on the per-app path so the first app and every later one get it from ONE
  //    code path — an app with the sass but not the provider renders the tokens but never follows a mode change.
  wireDesignSystemProvider(tree, options.project, designSystem, importPath, options.wireProviders === true);

  if (!options.skipFormat) await formatFiles(tree);
}

/**
 * The specifier an app imports the design system's runtime by: what this workspace links it as (its alias, or
 * its package name), else its package name, else its directory's name.
 */
function readImportPath(tree: Tree, designSystemRoot: string): string {
  const linked = workspaceLinking(tree).importPathOf(tree, designSystemRoot);
  if (linked) return linked;
  const pkgPath = `${designSystemRoot}/package.json`;
  const name = tree.exists(pkgPath) ? readJson<{ name?: string }>(tree, pkgPath).name : undefined;
  return name ?? basename(designSystemRoot);
}

/**
 * Install the design system's runtime binding into the app's bootstrap (Angular: `provideDesignSystem()` in
 * app.config.ts, which eagerly instantiates DsTheme so the mode attribute is right from boot).
 *
 * The provider is the BINDING'S, so it only goes into an app of the binding's own stack. A neutral design system
 * has no provider — its `setMode()` is called by the app itself. Idempotent; warns with a manual instruction
 * rather than crashing if the bootstrap's shape is unrecognized.
 */
function wireDesignSystemProvider(
  tree: Tree,
  app: string,
  designSystem: { name: string; root: string },
  importPath: string,
  ensuring: boolean,
): void {
  const binding = adapterOf(tree, designSystem.name);
  const appStack = adapterOf(tree, app);
  if (!binding?.designSystem || !appStack?.providers || binding.id !== appStack.id) return;

  const providerFn = binding.designSystem.provider;
  const result = appStack.providers.wire(tree, app, { providerFn, importFrom: importPath, ensuring });
  if (result === 'unrecognized') {
    logger.warn(
      `[design-system-styles] Could not auto-wire ${appStack.providers.bootstrapFile(tree, app)}. Add ` +
        `\`import { ${providerFn} } from '${importPath}';\` and include \`${providerFn}()\` ` +
        `in your providers array manually — it installs the theme's mode attribute on <html> at startup.`
    );
  }
}

/**
 * Upsert the `@use` and `@include ds.theme()` marker blocks into the app's GLOBAL stylesheet (located by the
 * app's stack — never assumed to be src/styles.scss).
 *
 * The two blocks are placed at opposite ends on purpose:
 *   - the `@use` block is PREPENDED at offset 0, because sass rejects a `@use` that follows any other
 *     rule, and the app may well have `@use`s of its own further down;
 *   - the `theme()` call is APPENDED at EOF, where it is legal anywhere after the `@use`.
 * Both are upserted between their markers, so a re-run is a no-op and anything the developer wrote
 * outside them survives untouched. Nothing a PROJECT decides lives inside them: the call takes no argument,
 * because the default mode is a design decision with its own home — the design system's `$default-mode`.
 */
function wireGlobalStylesheet(tree: Tree, stylesPath: string | null, specifier: string, projectName: string): void {
  if (!stylesPath) {
    logger.warn(
      `[design-system-styles] Could not find a global SCSS stylesheet for \`${projectName}\`. ` +
        `Add these two lines yourself:\n` +
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
    `/* Emits the design tokens as CSS custom properties (:root + [data-*-mode] + the default mode).\n` +
    `   Called EXACTLY ONCE, here. Never from a component's SCSS. What a visitor sees before choosing a\n` +
    `   mode is the design system's \$default-mode (styles/_core/_tokens.scss) — set it there, not here. */\n` +
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
