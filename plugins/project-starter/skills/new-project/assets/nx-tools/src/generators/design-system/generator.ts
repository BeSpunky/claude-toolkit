// House generator: create the workspace's DESIGN SYSTEM library.
//
// Every BeSpunky project is born with one, from moment zero — because the alternative is that the first
// feature typed a hex into a component's SCSS, the second copied it, and by screen five there is no
// system to retrofit.
//
// WHAT IT SHIPS: the MECHANISM, not a design.
//   - Design tokens as CSS CUSTOM PROPERTIES (the runtime layer — a theme change is a re-binding through
//     the cascade: live, no rebuild, no second stylesheet).
//   - A SASS API (the author-time layer — zero-output functions/mixins/placeholders, summoned with one
//     `@use` by the app and by the DS's own components alike).
//   - The TS half of the theming mechanism (DsTheme: the one thing that writes the mode attribute).
//   - STRUCTURE.md: the conventions, so feature work knows where components and styles go.
//
// WHAT IT DOES NOT SHIP: components, and any opinionated visual style. Token VALUES are loudly-marked
// PLACEHOLDERS that exist only so the lib compiles and the app runs; the design phase
// (bespunky-product-ux:stage-the-vision -> realize-the-vision) replaces them wholesale.
//
// Composes, never re-implements:
//   1. `publishable-lib` does the whole library scaffold (packages/<name>, ng-packagr, `nx release`
//      git-tag baseline, Vitest, and — via the base generator's addPathMapping — the tsconfig.base.json
//      path alias). We pass an explicit importPath because publishable-lib's DEFAULT scope is @bespunky
//      (this repo's own npm scope); a customer project must not get `@bespunky/design-system`.
//   2. `design-system-styles` (per-app) opens the SASS channel on every Angular app in the workspace.
//      The `app` generator composes it too, so a LATER app is wired with no flag — the same
//      self-detecting idiom firebase-emulators uses.
//
// THE SASS CHANNEL (the one genuinely hard problem here). The workspace links in-repo via
// tsconfig.base.json PATH ALIASES only — no package-manager workspaces, so there is no
// node_modules/@scope/design-system to resolve against. SASS does not read tsconfig paths, and every
// `pkg:`-flavoured mechanism resolves through node module resolution. So the in-repo channel MUST be a
// sass LOAD PATH, and we point it at the DS lib's PARENT dir (`packages`) rather than its styles dir.
// That makes the in-repo specifier `design-system/styles` — literally the published specifier minus the
// npm scope. One mental model, three consumers:
//   (1) the app            -> stylePreprocessorOptions.includePaths  (written by design-system-styles)
//   (2) the DS's own SCSS  -> ng-package.json lib.styleIncludePaths  (ng-packagr never reads (1))
//   (3) a published consumer -> the raw .scss shipped to dist as an ng-package `asset` + a `./styles`
//                               entry in the package's `exports` map
//
// IDEMPOTENCE / --repair CONTRACT (read before changing anything here):
//   - `styles/` and `src/` are SEEDED, not owned: each file is written only if ABSENT. This is not
//     laziness — `styles/_core/_tokens.scss` is precisely the file the design phase REPLACES, and a --repair
//     that rewrote it would silently destroy the project's real design and restore the placeholders.
//     Same for any mixin or breakpoint the project has since added.
//   - Everything else (STRUCTURE.md, the ng-package/package.json patches, the tags, the app wiring) is
//     GENERATOR-OWNED and re-asserted on every run, so a --repair heals drift.
import {
  type Tree,
  type GeneratorCallback,
  getProjects,
  readJson,
  readProjectConfiguration,
  updateProjectConfiguration,
  updateJson,
  formatFiles,
  logger,
} from '@nx/devkit';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import publishableLibGenerator from '../publishable-lib/generator';
import designSystemStylesGenerator from '../design-system-styles/generator';
import { findDesignSystem, isAngularApp, DESIGN_SYSTEM_TAG } from '../_utils/design-system';
import { resolveLibsDir } from '../_utils/workspace-layout';

interface DesignSystemSchema {
  /** The library (and project) name. Defaults to `design-system`. */
  name?: string;
  /**
   * The npm scope for the import path, WITHOUT the leading `@`. Defaults to the root package.json name.
   * Load-bearing: publishable-lib's default scope is `@bespunky` (this toolkit's own), which would be
   * wrong for every customer project.
   */
  scope?: string;
  /** Full override of the import path (wins over `scope`), e.g. `@acme/design-system`. */
  importPath?: string;
  /** Workspace-relative directory. Defaults to `<detected-libs-dir>/<name>` (see resolveLibsDir). */
  directory?: string;
  /** The Angular component-selector prefix for components promoted into the DS. */
  prefix?: string;
  /** The CSS custom-property namespace: `ds` -> `--ds-color-surface`, `[data-ds-mode]`. */
  tokenPrefix?: string;
  skipFormat?: boolean;
}

const noop: GeneratorCallback = () => {};

export default async function designSystemGenerator(
  tree: Tree,
  options: DesignSystemSchema = {}
): Promise<GeneratorCallback> {
  const name = options.name ?? 'design-system';
  const tokenPrefix = options.tokenPrefix ?? 'ds';
  const prefix = options.prefix ?? 'bs';
  const scope = normalizeNpmScope(options.scope ?? resolveWorkspaceScope(tree));
  const importPath = options.importPath ?? `@${scope}/${name}`;

  // 1) Create the library — but ONLY if it isn't there. On a --repair the lib already exists, and
  //    re-running publishable-lib would re-delegate to @nx/angular:library over a lib the project has
  //    since filled with real components. Everything below this point is safe to re-run.
  let installTask: GeneratorCallback = noop;
  const existing = findDesignSystem(tree);
  if (!existing) {
    // We are about to CREATE a design system. If the workspace already has libraries, one of them may BE
    // the design system under a name we can't recognise (findDesignSystem keys off the `type:design-system`
    // tag, falling back only to a library literally named `design-system`). Warn — do NOT guess and adopt:
    // the tag is the single source of truth, so the safe, reversible fix is for a human to tag the real DS
    // and re-run, which makes this branch a no-op. Silently creating a second DS is the failure we saw.
    warnIfDesignSystemMayAlreadyExist(tree);

    // Land the new library where THIS workspace keeps libraries (libs/, packages/, …), not a hardcoded
    // `packages/`. An explicit --directory still wins.
    const directory = options.directory ?? `${resolveLibsDir(tree)}/${name}`;
    installTask =
      (await publishableLibGenerator(tree, {
        name,
        directory,
        importPath,
        prefix,
        style: 'scss',
        // The detection key. design-system-styles (and the `app` generator, through it) find the DS by
        // this tag — NOT by path, because `directory` is overridable, and NOT by a marker file, which
        // would invent a second source of truth next to the tag.
        tags: `${DESIGN_SYSTEM_TAG},platform:web`,
        skipFormat: true,
      })) ?? noop;
  }

  const project = readProjectConfiguration(tree, existing?.name ?? name);
  const root = project.root; // never assume `packages/<name>` — `directory` is overridable
  const specifier = `${basename(root)}/styles`; // e.g. `design-system/styles`
  const stylesLoadPath = dirname(root); // e.g. `packages` — the ONE sass load path

  // 2) Re-assert the tag (a --repair heals a lib whose tags were edited away, and it is the ONLY thing
  //    that makes the DS findable).
  const tags = new Set(project.tags ?? []);
  tags.add(DESIGN_SYSTEM_TAG);
  project.tags = [...tags];
  updateProjectConfiguration(tree, project.name ?? name, project);

  // 3) On FIRST creation, purge what @nx/angular:library emitted: the demo component under src/lib AND
  //    the barrel src/index.ts that re-exports it. This MUST happen before seeding — the base generator
  //    already wrote src/index.ts, so a seed-if-absent would skip our curated barrel and leave a barrel
  //    pointing at a component we're about to delete (→ the lib and every app fail to compile). Skipped
  //    on --repair, where src/lib and src/index.ts are the project's own.
  if (!existing) pruneGeneratedComponents(tree, root);

  // 4) Seed the sass layer, the TS surface, and the docs. `styles/**` and the TS impl under `src/lib`
  //    are SEEDED, NOT OWNED (written only if absent) — `styles/_core/_tokens.scss` is the file the
  //    design phase replaces wholesale, and a --repair must never restore placeholders over a real
  //    design. But the CONTRACT files are generator-owned and force-rewritten every run: `STRUCTURE.md`
  //    (docs), and `src/index.ts` (the public API — a skipped barrel is the compile-breaker above).
  const substitutions = { tokenPrefix, importPath, specifier, root, name, prefix };
  seedTemplates(tree, join(__dirname, 'files'), root, substitutions, /* alwaysRewrite */ ['STRUCTURE.md', 'src/index.ts']);

  // 5) Channel (2): the DS lib's OWN component SCSS. ng-packagr does not read the app's
  //    stylePreprocessorOptions — it has its own load-path option, relative to the ng-package.json's dir.
  //    Channel (3): ship the raw .scss to dist so a PUBLISHED consumer can @use it.
  // ASSUMPTION (verify in Docker against the installed ng-packagr): `lib.styleIncludePaths` entries are
  //   resolved relative to the ng-package.json's directory (so `..` == the DS's parent dir, matching the
  //   app's load path), and `assets` accepts a glob and copies it to dist preserving structure.
  const ngPackagePath = `${root}/ng-package.json`;
  if (tree.exists(ngPackagePath)) {
    updateJson(tree, ngPackagePath, (json: Record<string, unknown>) => {
      const lib = { ...((json.lib as Record<string, unknown>) ?? {}) };
      const includePaths = new Set<string>([...((lib.styleIncludePaths as string[]) ?? []), '..']);
      lib.styleIncludePaths = [...includePaths];
      json.lib = lib;

      const assets = new Set<string>([...((json.assets as string[]) ?? []), './styles']);
      json.assets = [...assets];
      return json;
    });
  } else {
    logger.warn(
      `[design-system] No ng-package.json at ${ngPackagePath} — the library's own SCSS will not resolve ` +
        `\`@use '${specifier}'\`, and the sass layer will not ship to dist. Verify the publishable Angular output.`
    );
  }

  // 6) Channel (3), the other half: the published subpath. `@scope/design-system/styles` -> the barrel.
  // ASSUMPTION (verify in Docker): ng-packagr MERGES custom `exports` entries from the source
  //   package.json into the map it generates for dist, rather than overwriting them. If it overwrites,
  //   fall back to a post-build target that patches dist/<root>/package.json.
  const pkgPath = `${root}/package.json`;
  if (tree.exists(pkgPath)) {
    updateJson(tree, pkgPath, (json: Record<string, unknown>) => {
      const exports = { ...((json.exports as Record<string, unknown>) ?? {}) };
      exports['./styles'] = { sass: './styles/_index.scss', default: './styles/_index.scss' };
      json.exports = exports;
      // The legacy top-level field sass's package importer also consults. Cheap, and it makes the
      // package work with build setups that predate `exports` conditions.
      json.sass = './styles/_index.scss';
      return json;
    });
  }

  // 7) Wire every Angular app that already exists (the scaffold's first app — which was created BEFORE
  //    this lib and so couldn't wire itself; and every app in the workspace on a --repair). A LATER app
  //    wires itself, because the `app` generator composes this same per-app generator. One code path,
  //    both directions: the sass channel, the implicit dependency, the stylesheet blocks, and provideDesignSystem().
  for (const [appName] of getProjects(tree)) {
    if (isAngularApp(tree, appName)) {
      await designSystemStylesGenerator(tree, { project: appName, skipFormat: true });
    }
  }

  if (!options.skipFormat) await formatFiles(tree);

  return installTask;
}

/**
 * We're about to CREATE a design system because none was found by tag or by the name `design-system`.
 * If the workspace already contains libraries, one of them might be the project's real design system
 * under a different name — in which case creating a fresh one is a DUPLICATE, not a repair (exactly the
 * failure a `--repair` against a `libs/`-style repo produced). We DETECT and RELAY; we never adopt on a
 * guess, because the `type:design-system` tag is the single source of truth and the correct fix is a
 * human tagging the real DS and re-running (which makes DS creation a no-op).
 *
 * No-ops silently when the workspace has no libraries (a fresh scaffold — nothing to be confused with).
 */
function warnIfDesignSystemMayAlreadyExist(tree: Tree): void {
  const libraries = [...getProjects(tree)]
    .filter(([, project]) => project.projectType === 'library')
    .map(([libName, project]) => `${libName} (${project.root})`);

  if (libraries.length === 0) return;

  logger.warn(
    `[design-system] No library tagged \`${DESIGN_SYSTEM_TAG}\` (or named \`design-system\`) was found, so a NEW ` +
      `design system is being created. If one of these existing libraries IS your design system, stop and adopt it ` +
      `instead of creating a duplicate — add the tag \`${DESIGN_SYSTEM_TAG}\` to its project config and re-run; this ` +
      `generator will then heal it in place (correct location, no relocation) rather than scaffold a second one:\n` +
      libraries.map((lib) => `  - ${lib}`).join('\n')
  );
}

/**
 * The npm scope for the DS's import path, derived from the root package.json `name` (which
 * `create-nx-workspace` sets to the workspace name). Falls back to `workspace` rather than throwing —
 * an odd scope is a cosmetic problem the caller can override with --scope; a crash mid-scaffold is not.
 *
 * A root name that is ALREADY scoped (`@acme/monorepo`) yields `acme`, not `@acme/monorepo`.
 */
function resolveWorkspaceScope(tree: Tree): string {
  const rootName = tree.exists('package.json')
    ? readJson<{ name?: string }>(tree, 'package.json').name
    : undefined;

  if (!rootName) {
    logger.warn(`[design-system] No name in the root package.json — using the scope "@workspace". Pass --scope to override.`);
    return 'workspace';
  }
  return rootName.startsWith('@') ? rootName.slice(1).split('/')[0] : rootName;
}

/**
 * Coerce a scope to a VALID npm scope name. `create-nx-workspace` seeds the root package name from the
 * project dir, which a user may have named `My_App` — and `@My_App/design-system` is an illegal npm
 * package name that `nx release`/`npm publish` reject, and it would land verbatim in every app's import.
 * npm names must be lowercase and URL-safe: lowercase, and collapse anything that isn't `a-z 0-9 - . ~`
 * to a hyphen.
 */
function normalizeNpmScope(scope: string): string {
  const normalized = scope.toLowerCase().replace(/[^a-z0-9\-.~]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalized !== scope) {
    logger.info(`[design-system] Normalized the npm scope "${scope}" -> "${normalized}" (npm names must be lowercase and URL-safe).`);
  }
  return normalized || 'workspace';
}

/**
 * Copy the `files/**` template tree into the library, substituting `{{token}}`s and dropping the `.tpl`
 * suffix (the suffix exists because nx-tools' package.json `files` array only ships .tpl/.template/.json/.js
 * — a plain .scss under src/ would never reach a consumer's node_modules).
 *
 * SEED semantics: a file is written only if it does NOT exist, EXCEPT for the paths in `alwaysRewrite`.
 * See the file header for why this matters — a --repair must never restore placeholder tokens over the
 * project's real design.
 */
function seedTemplates(
  tree: Tree,
  templateDir: string,
  destRoot: string,
  substitutions: Record<string, string>,
  alwaysRewrite: string[]
): void {
  const walk = (dir: string, relative: string): void => {
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);
      const relativePath = relative ? `${relative}/${entry}` : entry;

      if (statSync(absolute).isDirectory()) {
        walk(absolute, relativePath);
        continue;
      }

      const destPath = `${destRoot}/${relativePath.replace(/\.tpl$/, '')}`;
      const destRelative = relativePath.replace(/\.tpl$/, '');
      if (tree.exists(destPath) && !alwaysRewrite.includes(destRelative)) continue;

      let content = readFileSync(absolute, 'utf8');
      for (const [key, value] of Object.entries(substitutions)) {
        content = content.split(`{{${key}}}`).join(value);
      }
      tree.write(destPath, content);
    }
  };

  walk(templateDir, '');
}

/**
 * Delete whatever demo component/service `@nx/angular:library` emitted under `src/lib` before we seeded
 * ours. The design system ships ZERO components — a scaffolded `design-system.component.ts` would be the
 * first thing a developer copies, and it would teach exactly the wrong lesson.
 *
 * ASSUMPTION (verify in Docker): with `skipModule: true`, @nx/angular:library still emits a lib folder
 *   (historically `src/lib/<name>/<name>.ts` or `src/lib/<name>.component.ts`). We delete anything under
 *   src/lib that isn't one of ours, so the exact shape doesn't matter — but confirm the delegated
 *   generator's src/index.ts (which we overwrite) doesn't re-export something we just deleted.
 */
function pruneGeneratedComponents(tree: Tree, root: string): void {
  const ours = new Set(['design-system.providers.ts', 'ds-theme.service.ts', 'ds-runtime-theme.service.ts']);
  const libDir = `${root}/src/lib`;
  if (!tree.exists(libDir)) return;

  for (const child of tree.children(libDir)) {
    if (ours.has(child)) continue;
    logger.info(`[design-system] Pruning \`${libDir}/${child}\` — the design system ships no components.`);
    tree.delete(`${libDir}/${child}`);
  }
}
