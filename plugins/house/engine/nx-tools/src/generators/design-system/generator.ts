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
//   - The runtime that writes the mode attribute, and STRUCTURE.md: the conventions.
//
// TWO HALVES — the phase-4 split. The tokens and the SASS API (./files/styles) are framework-NEUTRAL, the core
// every design system gets. The rest is a BINDING:
//   - a framework's, when the workspace has a stack whose adapter has a `designSystem` port (Angular: a
//     publishable @nx/angular library, DsTheme/provideDesignSystem, the ng-packagr sass channel, the
//     `ds-component` generator — src/adapters/angular/design-system.ts), created through `publishable-lib`;
//   - otherwise the NEUTRAL binding (./neutral): a plain source library carrying a DOM `setMode()`, so a Vite
//     app, a server-rendered site or a repo with no framework at all still gets one source of visual truth.
// An EXISTING design system keeps the binding it was born with — the stack that owns the library decides —
// so an Angular project's DS stays an Angular library, byte for byte.
//
// THE SASS CHANNEL (the one genuinely hard problem here). SASS reads neither tsconfig path aliases nor — without a
// `pkg:` importer every consumer's toolchain would have to configure — package `exports`. Under `paths` linking
// there is no node_modules/@scope/design-system at all; under `workspaces` linking there is, but only for the
// projects that declare it, and only once the package manager has run. The one channel that works under BOTH,
// from the first build, is a sass LOAD PATH — and we point it at the DS lib's PARENT dir (`packages`) rather
// than its styles dir.
// That makes the in-repo specifier `design-system/styles` — literally the published specifier minus the
// npm scope. One mental model, three consumers:
//   (1) the app              -> its stack's `styles` port (design-system-styles; Angular: stylePreprocessorOptions)
//   (2) the DS's own SCSS    -> the binding's `openLibraryStyles` (Angular: ng-package.json lib.styleIncludePaths)
//   (3) a published consumer -> the raw .scss + a `./styles` entry in the package's `exports` map
//
// IDEMPOTENCE / UPGRADE CONTRACT (read before changing anything here):
//   - `styles/` and `src/` are SEEDED, not owned: each file is written only if ABSENT. `styles/_core/_tokens.scss`
//     is precisely the file the design phase REPLACES, and an upgrade that rewrote it would silently destroy the
//     project's real design and restore the placeholders.
//   - Everything else (STRUCTURE.md, the src/index.ts barrel, the packaging patches, the tags, the app wiring)
//     is GENERATOR-OWNED and re-asserted on every run, so an upgrade heals drift.
import {
  type Tree,
  type GeneratorCallback,
  getProjects,
  offsetFromRoot,
  readProjectConfiguration,
  updateProjectConfiguration,
  readJson,
  updateJson,
  writeJson,
  formatFiles,
  logger,
} from '@nx/devkit';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import publishableLibGenerator from '../publishable-lib/generator';
import designSystemStylesGenerator from '../design-system-styles/generator';
import { findDesignSystem, DESIGN_SYSTEM_TAG } from '../_utils/design-system';
import { resolveLibsDir, resolveWorkspaceScope, normalizeNpmScope } from '../_utils/workspace-layout';
import { createProject } from '../_utils/project-files';
import { workspaceLinking, rootTsconfig } from '../_utils/linking';
import { adapterOf, applicationsWith, projectRole } from '../../adapters/registry';
import { workspaceStackWith } from '../../adapters/workspace';
import type { StackAdapter } from '../../adapters/stack-adapter';
import { platformTag } from '../../platform/platform';

interface DesignSystemSchema {
  /** See wireProviders in schema.json — wiring is a BASELINE act, never a sync-time one. */
  wireProviders?: boolean;
  /** The library (and project) name. Defaults to `design-system`. */
  name?: string;
  /** The npm scope for the import path, WITHOUT the leading `@`. Defaults to the workspace's scope. */
  scope?: string;
  /** Full override of the import path (wins over `scope`), e.g. `@acme/design-system`. */
  importPath?: string;
  /** Workspace-relative directory. Defaults to `<detected-libs-dir>/<name>` (see resolveLibsDir). */
  directory?: string;
  /** The component-selector prefix for components promoted into the DS (framework bindings only). */
  prefix?: string;
  /** The CSS custom-property namespace: `ds` -> `--ds-color-surface`, `[data-ds-mode]`. */
  tokenPrefix?: string;
  skipFormat?: boolean;
}

const noop: GeneratorCallback = () => {};

/** The neutral binding: what a design system carries when no framework binds it. */
const NEUTRAL_BINDING = { templates: join(__dirname, 'neutral'), alwaysRewrite: ['STRUCTURE.md', 'src/index.ts'] };

export default async function designSystemGenerator(
  tree: Tree,
  options: DesignSystemSchema = {}
): Promise<GeneratorCallback> {
  const name = options.name ?? 'design-system';
  const tokenPrefix = options.tokenPrefix ?? 'ds';
  const prefix = options.prefix ?? 'bs';
  const importPath = options.importPath ?? `@${normalizeNpmScope(options.scope ?? resolveWorkspaceScope(tree))}/${name}`;

  // The binding: the stack that OWNS an existing design system (it keeps what it was born with), or, for a new
  // one, the workspace's stack that can bind one. None → the neutral core.
  const existing = findDesignSystem(tree);
  const stack: StackAdapter | null = existing
    ? adapterOf(tree, existing.name)
    : workspaceStackWith(tree, 'designSystem');
  const binding = stack?.designSystem ?? null;

  // 1) Create the library — ONLY if it isn't there. On an upgrade it exists, and re-creating it would re-delegate
  //    to the framework generator over a library the project has since filled with real components.
  let installTask: GeneratorCallback = noop;
  if (!existing) {
    // A library under a name we can't recognise may already BE the design system — warn, never adopt on a guess.
    warnIfDesignSystemMayAlreadyExist(tree);
    const directory = options.directory ?? `${resolveLibsDir(tree)}/${name}`;
    // The tag is the detection key — NOT the path (overridable) and NOT a marker file (a second source of truth).
    // `platform:web`: the runtime writes the mode attribute on the DOM, whichever binding carries it.
    const tags = `${DESIGN_SYSTEM_TAG},${platformTag('web')}`;
    if (stack && binding) {
      installTask =
        (await publishableLibGenerator(tree, { name, directory, importPath, prefix, style: 'scss', tags, stack: stack.id, skipFormat: true })) ??
        noop;
    } else {
      createNeutralLibrary(tree, { name, directory, importPath, tags: tags.split(',') });
    }
  }

  const project = readProjectConfiguration(tree, existing?.name ?? name);
  const root = project.root; // never assume `packages/<name>` — `directory` is overridable
  const specifier = `${basename(root)}/styles`; // e.g. `design-system/styles`

  // 2) Re-assert the tag (an upgrade heals a lib whose tags were edited away; it is what makes the DS findable).
  project.tags = [...new Set([...(project.tags ?? []), DESIGN_SYSTEM_TAG])];
  updateProjectConfiguration(tree, project.name ?? name, project);

  // 3) On FIRST creation, purge what the framework generator emitted (a demo component, and the barrel that
  //    re-exports it) BEFORE seeding — or the seed-if-absent would keep a barrel pointing at a deleted file.
  if (!existing) binding?.pruneGenerated(tree, root);

  // 4) Seed the neutral core (the sass layer), then the binding's runtime + docs over it.
  const substitutions = { tokenPrefix, importPath, specifier, root, name, prefix };
  seedTemplates(tree, join(__dirname, 'files'), root, substitutions, []);
  const runtime = binding ?? NEUTRAL_BINDING;
  seedTemplates(tree, runtime.templates, root, substitutions, [...runtime.alwaysRewrite]);

  // 5) Channel (2): the library's OWN component styles — the binding's packager, when it has one.
  binding?.openLibraryStyles(tree, root, specifier);

  // 6) Channel (3): the published subpath. `@scope/design-system/styles` -> the barrel.
  publishStyles(tree, root);

  // 7) Wire every app that can consume it (its stack has a `styles` port) — the scaffold's first app, created
  //    BEFORE this lib, and every app on an upgrade. A LATER app wires itself: the `app` generator attaches the
  //    design-system layer's per-app step, this same design-system-styles.
  for (const { project: app } of applicationsWith(tree, 'styles')) {
    await designSystemStylesGenerator(tree, {
      project: app,
      skipFormat: true,
      // Passed THROUGH, never decided here: whether this run is ensuring the layer is the caller's fact.
      wireProviders: options.wireProviders === true,
    });
  }

  if (!options.skipFormat) await formatFiles(tree);

  return installTask;
}

/**
 * The neutral core's library: a plain SOURCE project (no build — consumers load its SCSS through a sass load path
 * and import its runtime through the workspace's link), tagged so it is found, with a package.json so it can be
 * published as-is. Created and linked the way THIS workspace defines and links projects (`createProject`,
 * `workspaceLinking`): a project.json + a path alias, or a package.json workspace member whose `exports` serve
 * its source. Its consumers are linked app by app, by design-system-styles.
 */
function createNeutralLibrary(tree: Tree, options: { name: string; directory: string; importPath: string; tags: string[] }): void {
  // Compiler options first: `createProject` references a package from the solution tsconfig only once it has one.
  writeProjectTsconfigs(tree, options.directory);
  createProject(
    tree,
    options.name,
    { root: options.directory, sourceRoot: `${options.directory}/src`, projectType: 'library', tags: options.tags, targets: {} },
    { name: options.importPath, version: '0.0.1' },
  );
  if (!tree.exists(`${options.directory}/package.json`)) {
    writeJson(tree, `${options.directory}/package.json`, { name: options.importPath, version: '0.0.1' });
  }
  workspaceLinking(tree).link(tree, { importPath: options.importPath, libRoot: options.directory });
}

/**
 * A workspace whose root compiler options are `composite` builds TypeScript as a graph of PROJECTS: every source
 * file must belong to one (a file reached from outside its program is TS6307), and the solution references each
 * by its tsconfig.json. A source library there therefore needs tsconfigs of its own — the shape @nx/js gives a
 * library in such a workspace (a references-only tsconfig.json over a tsconfig.lib.json). Elsewhere the neutral
 * library has never had one (its consumer compiles its source), and still does not.
 *
 * The runtime is browser code a BUNDLER consumes, so it is compiled with bundler resolution (extension-less
 * relative imports) and the DOM lib, whatever the workspace's server-leaning defaults (`nodenext`) say.
 */
function writeProjectTsconfigs(tree: Tree, root: string): void {
  const base = rootTsconfig(tree);
  if (!base || !readJson<{ compilerOptions?: { composite?: boolean } }>(tree, base).compilerOptions?.composite) return;
  const extendsBase = `${offsetFromRoot(root)}${base}`;
  if (!tree.exists(`${root}/tsconfig.json`)) {
    writeJson(tree, `${root}/tsconfig.json`, { extends: extendsBase, files: [], include: [], references: [{ path: './tsconfig.lib.json' }] });
  }
  if (!tree.exists(`${root}/tsconfig.lib.json`)) {
    writeJson(tree, `${root}/tsconfig.lib.json`, {
      extends: extendsBase,
      compilerOptions: {
        rootDir: 'src',
        outDir: 'dist',
        tsBuildInfoFile: 'dist/tsconfig.lib.tsbuildinfo',
        module: 'esnext',
        moduleResolution: 'bundler',
        lib: ['es2022', 'dom'],
        types: [],
      },
      include: ['src/**/*.ts'],
    });
  }
}

/** The `./styles` subpath of the published package — `@scope/design-system/styles` → the sass barrel. */
function publishStyles(tree: Tree, root: string): void {
  const pkgPath = `${root}/package.json`;
  if (!tree.exists(pkgPath)) return;
  updateJson(tree, pkgPath, (json: Record<string, unknown>) => {
    const exports = { ...((json.exports as Record<string, unknown>) ?? {}) };
    exports['./styles'] = { sass: './styles/_index.scss', default: './styles/_index.scss' };
    json.exports = exports;
    // The legacy top-level field sass's package importer also consults — for setups that predate `exports`.
    json.sass = './styles/_index.scss';
    return json;
  });
}

/**
 * We're about to CREATE a design system because none was found by tag or by the name `design-system`.
 * If the workspace already contains libraries, one of them might be the project's real design system
 * under a different name — in which case creating a fresh one is a DUPLICATE, not a sync (exactly the
 * failure an upgrade against a `libs/`-style repo produced). We DETECT and RELAY; we never adopt on a
 * guess, because the `type:design-system` tag is the single source of truth and the correct fix is a
 * human tagging the real DS and re-running (which makes DS creation a no-op).
 *
 * No-ops silently when the workspace has no libraries (a fresh scaffold — nothing to be confused with).
 */
function warnIfDesignSystemMayAlreadyExist(tree: Tree): void {
  const libraries = [...getProjects(tree)]
    .filter(([libName]) => projectRole(tree, libName) === 'library')
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

/**` template tree into the library, substituting `{{token}}`s and dropping the `.tpl`
 * suffix (the suffix exists because nx-tools' package.json `files` array only ships .tpl/.template/.json/.js
 * — a plain .scss under src/ would never reach a consumer's node_modules).
 *
 * SEED semantics: a file is written only if it does NOT exist, EXCEPT for the paths in `alwaysRewrite`.
 * See the file header for why this matters — an upgrade must never restore placeholder tokens over the
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
