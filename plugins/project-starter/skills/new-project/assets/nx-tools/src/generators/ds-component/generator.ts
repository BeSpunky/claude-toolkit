// House generator: promote a reusable component INTO the design system, as its own secondary entry point.
//
//     nx g @bespunky/nx-tools:ds-component button
//     -> packages/design-system/button/{ng-package.json, src/index.ts, src/button.component.{ts,html,scss}}
//     -> imports as `@<scope>/design-system/button`
//
// THIS IS THE ONLY WAY A COMPONENT ENTERS THE DESIGN SYSTEM. Hand-creating the folder gets you a
// component that resolves in the editor (through the tsconfig path alias) and then VANISHES on publish,
// because nothing declared it as an entry point. Generator-first isn't a style preference here — the
// entry-point config IS the boundary.
//
// WHEN TO RUN IT: on the SECOND occurrence of a UI pattern. The first time you build a card in a feature,
// it lives there — you don't yet know its contract. The second time, you don't copy it: you promote it,
// migrate BOTH sites onto it, and delete the copies. Two use-sites is exactly enough evidence to design
// the API honestly (one is a guess; three is debt). See the `bespunky-design-system:design-system-first` skill.
//
// One entry point per component (not one shared `components` barrel) so each is independently
// tree-shakeable and is its own boundary, and so the barrel never becomes a merge-conflict hotspot.
//
// Composes `secondary-entrypoint` (which does the structural work and keeps the path alias — the only
// in-repo TS resolution channel) and then applies the design-system specifics the generic generator
// deliberately doesn't know about: the sass channel into the component's own SCSS, and a starting shape
// that reads tokens instead of inventing values.
import {
  type Tree,
  formatFiles,
  updateJson,
  readProjectConfiguration,
  logger,
  joinPathFragments,
  names,
} from '@nx/devkit';
import { basename } from 'node:path';
import secondaryEntrypointGenerator from '../secondary-entrypoint/generator';
import { findDesignSystem } from '../_utils/design-system';

interface DsComponentSchema {
  /** The component (and entry-point) name, e.g. `button` -> `@scope/design-system/button`. */
  name: string;
  /** Override the design-system project. Defaults to the workspace's tagged design system. */
  library?: string;
  skipFormat?: boolean;
}

export default async function dsComponentGenerator(tree: Tree, options: DsComponentSchema): Promise<void> {
  if (!options.name) {
    throw new Error('ds-component generator requires a component name (positional arg 0 / --name), e.g. `button`.');
  }

  const designSystem = options.library
    ? { name: options.library, root: '' }
    : findDesignSystem(tree);

  if (!designSystem) {
    throw new Error(
      'ds-component: no design system in this workspace. Run `nx g @bespunky/nx-tools:design-system` ' +
        'first (or pass --library=<project> to target a specific library).'
    );
  }

  const entryName = names(options.name).fileName;
  const libraryRoot = designSystem.root || resolveLibraryRoot(tree, designSystem.name);
  const entryRoot = joinPathFragments(libraryRoot, entryName);
  const specifier = `${basename(libraryRoot)}/styles`; // e.g. `design-system/styles`
  const entryNgPackage = joinPathFragments(entryRoot, 'ng-package.json');

  // IDEMPOTENCE GUARD. If the entry already exists, this is a re-run over a component the developer OWNS
  // — its SCSS, template, and API are theirs and may be months of work. We must NOT re-run
  // secondary-entrypoint (which re-invokes @nx/angular's componentGenerator and could regenerate/overwrite
  // those files). Re-assert only the safe, generator-owned config (the entry's sass load path) and stop.
  const alreadyExists = tree.exists(entryNgPackage);

  // 1) The structural work — FIRST CREATION ONLY: the nested ng-package.json, src/index.ts, the standalone
  //    component, and the `@scope/design-system/<name>` path alias. secondary-entrypoint also resets the
  //    parent lib's tsconfig.lib.json globs to a bounded shape — without which N entry points explode into
  //    a multi-MB tsconfig that TS then fails to compile. That's its job; we don't duplicate it.
  if (!alreadyExists) {
    await secondaryEntrypointGenerator(tree, {
      library: designSystem.name,
      name: entryName,
      component: 'standalone',
      skipFormat: true,
    });
  }

  // 2) The sass channel for THIS entry's SCSS. Safe to re-assert on every run (a merge-and-dedupe of a
  //    generator-owned config value, not the developer's content).
  //    Belt-and-braces: the primary ng-package.json already declares `styleIncludePaths`, and ng-packagr
  //    MAY inherit that into secondary entries — but that inheritance is unverified, and a component whose
  //    SCSS can't resolve `@use '<ds>/styles'` fails the build. Declaring it on the entry itself costs one
  //    line. `../..` from `<lib>/<entry>/ng-package.json` is the lib's PARENT dir — the app's load path.
  if (tree.exists(entryNgPackage)) {
    updateJson(tree, entryNgPackage, (json: Record<string, unknown>) => {
      const lib = { ...((json.lib as Record<string, unknown>) ?? {}) };
      const paths = new Set<string>([...((lib.styleIncludePaths as string[]) ?? []), '../..']);
      lib.styleIncludePaths = [...paths];
      json.lib = lib;
      return json;
    });
  }

  if (alreadyExists) {
    logger.info(
      `[ds-component] Entry point \`${entryName}\` already exists — re-asserted its sass config and left ` +
        `its component files untouched (they're yours). Delete the folder first if you meant to recreate it.`
    );
    if (!options.skipFormat) await formatFiles(tree);
    return;
  }

  // Detect the component's ACTUAL file base — @nx/angular ≤ v19 emits `<name>.component.ts`, v20+ emits
  // `<name>.ts`. Everything downstream (the barrel re-export, the SCSS filename) derives from what was
  // really written, so we never hardcode `.component` and then export a path that doesn't exist.
  const componentBase = detectComponentBase(tree, entryRoot, entryName);

  // 3) The component's SCSS: the house starting shape — every value a TOKEN, so a developer's first edit
  //    is `ds.color(...)` not a hex. First creation only (the guard above returned otherwise).
  seedComponentScss(tree, entryRoot, componentBase, specifier);

  // 4) The entry's PUBLIC API barrel — `<component>/src/index.ts` is the ONLY thing a consumer may import
  //    from this entry; everything else is implementation.
  seedEntryBarrel(tree, entryRoot, componentBase);

  if (!options.skipFormat) await formatFiles(tree);

  logger.info(
    `[ds-component] Created the \`${entryName}\` entry point. Import it as \`<package>/${entryName}\`. ` +
      `Now migrate BOTH call sites onto it and delete the local copies — a promotion that leaves the ` +
      `original behind is just a third copy.`
  );
}

/**
 * The base name (no extension) of the standalone component the delegated generator emitted under
 * `<entry>/src` — `button.component` on @nx/angular ≤ v19, `button` on v20+. Found by scanning for the
 * component `.ts` (skipping `index.ts` and specs) so the barrel and the SCSS always match reality rather
 * than a hardcoded suffix. Falls back to `<name>.component` if the scan finds nothing (shouldn't happen).
 */
function detectComponentBase(tree: Tree, entryRoot: string, entryName: string): string {
  const srcDir = joinPathFragments(entryRoot, 'src');
  if (tree.exists(srcDir)) {
    for (const child of tree.children(srcDir)) {
      if (child === 'index.ts' || !child.endsWith('.ts') || child.endsWith('.spec.ts')) continue;
      return child.replace(/\.ts$/, '');
    }
  }
  return `${entryName}.component`;
}

/**
 * Write the entry point's PUBLIC API barrel.
 *
 * One folder = one entry point = one contract. What this file exports, the design system must support;
 * what it doesn't, the library is free to rename, reshape, or delete tomorrow. So it stays minimal, and
 * the component's helpers, sub-components, and private types go under a `_`-prefixed folder named for what it
 * holds (`_parts/`, `_material/` — never `internal`, which names the access level the `_` already carries), where a consumer
 * cannot reach them by accident.
 *
 * Written only if secondary-entrypoint's placeholder is still there (i.e. on creation) — never over a
 * barrel the project has since curated.
 */
function seedEntryBarrel(tree: Tree, entryRoot: string, componentBase: string): void {
  const indexPath = joinPathFragments(entryRoot, 'src', 'index.ts');
  const current = tree.read(indexPath, 'utf8') ?? '';

  // secondary-entrypoint writes a one-line re-export; anything longer is the project's own curation.
  const untouched = current.split('\n').filter((line) => line.trim().startsWith('export')).length <= 1;
  if (!untouched) return;

  tree.write(
    indexPath,
    `// THE PUBLIC API of this design-system entry point.\n` +
      `//\n` +
      `// What you export here, you must support. Everything NOT exported is implementation — put it in a\n` +
      `// \`_\`-prefixed folder named for WHAT IT IS (\`_parts/\`, \`_material/\`), so a consumer cannot reach it\n` +
      `// by accident and you stay free to change it. The \`_\` says "not yours"; the name says what it holds.\n` +
      `export * from './${componentBase}';\n`
  );
}

/**
 * The design system's root, when it was named explicitly (--library) rather than found by tag.
 * Devkit throws a clear "Cannot find configuration for project" if the name is wrong — let it.
 */
function resolveLibraryRoot(tree: Tree, library: string): string {
  return readProjectConfiguration(tree, library).root;
}

/**
 * Overwrite the component SCSS @nx/angular emitted (an empty file) with the house starting shape.
 *
 * Not cosmetic: this is where a developer's first styling instinct lands. An empty file invites a hex;
 * a file that already reads `ds.color('on-surface')` invites another token. The comment block is the
 * rule stated at the exact moment it applies.
 */
function seedComponentScss(tree: Tree, entryRoot: string, componentBase: string, specifier: string): void {
  // The SCSS sits beside the component `.ts` and shares its base (`button.component.scss` / `button.scss`).
  const target = joinPathFragments(entryRoot, 'src', `${componentBase}.scss`);

  tree.write(
    target,
    `// Every visual value here is a TOKEN. No raw hex, no magic px, no hand-typed duration.\n` +
      `// If the design system doesn't have the value you need, ADD THE TOKEN — don't hardcode it here.\n` +
      `@use '${specifier}' as ds;\n` +
      `\n` +
      `:host {\n` +
      `  display: block;\n` +
      `  padding: ds.space(3);\n` +
      `  color: ds.color('on-surface');\n` +
      `  background: ds.color('surface');\n` +
      `  border-radius: ds.radius('md');\n` +
      `\n` +
      `  @include ds.focus-ring();\n` +
      `}\n` +
      `\n` +
      `// Variants are DATA, not booleans: type a \`variant\` input as a union, render it as a host\n` +
      `// attribute, and select on it here. Two booleans are four undesigned states.\n` +
      `//\n` +
      `//   :host([data-variant='danger']) { background: ds.color('danger'); color: ds.color('on-danger'); }\n`
  );
}
