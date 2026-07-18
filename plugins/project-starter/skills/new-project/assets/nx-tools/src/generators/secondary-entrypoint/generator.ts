// House generator: add a publishable SECONDARY ENTRY-POINT to an existing library.
//
// What it produces:
//   <lib-root>/<name>/
//     ├── ng-package.json   →  { "lib": { "entryFile": "src/index.ts" } }
//     └── src/index.ts      →  empty (`export {}`) by default, or re-exports a
//                              generated standalone component when --component=standalone.
//
// ng-packagr auto-discovers nested `ng-package.json` files by filesystem scan, so the new
// entry becomes the `<package>/<name>` deep-import subpath with no extra registration.
//
// LINKING MODEL (DECIDED 2026-06-22 — the suite's one decision that shapes this generator):
//   The BeSpunky suite links in-repo via `tsconfig.base.json` PATH ALIASES, NOT package-manager
//   workspaces + project references. The deep import `@bespunky/<lib>/<subpath>` resolves through
//   the `compilerOptions.paths` entry that the delegated @nx/angular generator (via addPathMapping)
//   writes for the new subpath. That alias is therefore the ONLY in-repo resolution channel for the
//   entry — so we KEEP it. (An earlier revision stripped it under a stale workspaces+references
//   assumption; that strip step is now gone.) Deleting it would break editor/type resolution of the
//   deep import by construction (ts(2307)). We deliberately do NOT add an alias of our own — the
//   base generator's addPathMapping already wrote the correct one.
//
// This generator is a content-agnostic entry creator. It delegates the structural work to
// @nx/angular's `librarySecondaryEntryPointGenerator`, then normalizes the result and (only on
// request) decorates it with a component. It intentionally drops xpand's design-system
// behavior: the `components/` relocation, the default Button-style component, and the `scam`
// option (the suite is standalone-only) are all gone.
import {
  type Tree,
  formatFiles,
  readJson,
  readProjectConfiguration,
  writeJson,
  updateJson,
  logger,
  joinPathFragments,
} from '@nx/devkit';
// ASSUMPTION (verify in Docker against @nx/angular 23.1): the secondary-entry-point and
// component generators are exported from '@nx/angular/generators' under these exact names.
// xpand (an older @nx/angular line) imported `librarySecondaryEntryPointGenerator` and
// `componentGenerator` from here; the names have been stable across recent majors. If the
// import fails, check `node_modules/@nx/angular/generators` for the current export name.
import {
  componentGenerator,
  librarySecondaryEntryPointGenerator,
} from '@nx/angular/generators';
import type { SecondaryEntrypointGeneratorSchema } from './schema';

export async function secondaryEntrypointGenerator(
  tree: Tree,
  options: SecondaryEntrypointGeneratorSchema
): Promise<void> {
  if (!options.name) {
    throw new Error('secondary-entrypoint generator requires --name=<entry> (the subpath, e.g. `testing`).');
  }
  if (!options.library) {
    throw new Error('secondary-entrypoint generator requires --library=<project> (the parent library).');
  }

  const component = options.component ?? 'none';

  // The parent library must already exist (it's produced by `publishable-lib`). Read it up
  // front so we fail fast with a clear message and so we know where the nested entry lands.
  const libraryConfig = readProjectConfiguration(tree, options.library);
  const libraryRoot = libraryConfig.root;
  const packageName = readPackageName(tree, libraryRoot, options.library);

  // 1) Delegate the structural work: this creates `<lib-root>/<name>/{ng-package.json, src/index.ts}`.
  //    `skipModule: true` — the suite is standalone-only, so we never want an NgModule entry.
  // ASSUMPTION (verify in Docker): on @nx/angular 23.1 the option keys are `library` + `name`
  //    (+ `skipModule`). Older lines accepted the same; if 23.1 renamed `library`→`project`
  //    or moved `skipModule`, adjust here. We pass ONLY these three (not `...options`) so our
  //    own `component`/`skipFormat` keys can't leak into the delegated schema.
  await librarySecondaryEntryPointGenerator(tree, {
    library: options.library,
    name: options.name,
    skipModule: true,
  });

  // 1b) RESET the parent lib's tsconfig.lib.json include/exclude to the bounded house shape.
  //     The delegated @nx/angular generator APPENDS the new entry's deep glob to these arrays on
  //     every run — and (observed on @nx/angular 23.1) cumulatively/cartesian: N secondary entries
  //     explode into thousands of globs (a multi-MB tsconfig), which TS then compiles into a regex
  //     past V8's nesting limit ("error TS500: Invalid regular expression", the ng-packagr build
  //     dies — worst on 4-segment-deep entries like `router-x/navigation/zod`). We replace that
  //     growing list with a FIXED-SIZE pair of globs that still covers the primary src AND every
  //     secondary-entry src (so the editor can resolve `@bespunky/*` on the PATHS model — see
  //     resetLibTsConfig). Resetting here makes the generator idempotent and bloat-proof.
  resetLibTsConfig(tree, libraryRoot);

  const entryRoot = joinPathFragments(libraryRoot, options.name);

  // 2) KEEP the tsconfig.base.json path alias the base generator added for the new subpath.
  //    See the LINKING MODEL note at the top of this file: on the PATHS model that
  //    `@bespunky/<lib>/<subpath>` alias is the ONLY in-repo resolution channel for the deep
  //    import, so deleting it would break type resolution (ts(2307)). We deliberately leave it.

  // 3) Normalize the nested ng-package.json to the house shape. ng-packagr accepts `{}` for a
  //    secondary entry, but we keep the explicit entryFile so the contract is visible and stable
  //    regardless of what the base generator emitted.
  const ngPackagePath = joinPathFragments(entryRoot, 'ng-package.json');
  if (tree.exists(ngPackagePath)) {
    updateJson(tree, ngPackagePath, (json) => {
      json.lib = { ...(json.lib ?? {}), entryFile: 'src/index.ts' };
      return json;
    });
  } else {
    // Defensive: if the base generator didn't emit one (API drift), write the canonical shape.
    writeJson(tree, ngPackagePath, { lib: { entryFile: 'src/index.ts' } });
  }

  // 4) Optional component + the entry's public surface (src/index.ts).
  const indexPath = joinPathFragments(entryRoot, 'src', 'index.ts');
  if (component === 'standalone') {
    // Scaffold a flat standalone component directly inside the entry's src folder, then make it
    // the entry's public surface. The base generator already created a placeholder src/index.ts;
    // we overwrite it with the re-export so the entry actually exports the component.
    // ASSUMPTION (verify in Docker): @nx/angular 23.1 `componentGenerator` accepts `path` (the
    //    target directory) + `flat` + `skipTests:false` and infers the project from the path.
    //    Older lines also accepted a `project` key; xpand passed both `project` + `path`. We pass
    //    both for resilience — `project` is harmless if ignored.
    const srcPath = joinPathFragments(entryRoot, 'src');
    await componentGenerator(tree, {
      name: options.name,
      project: options.library,
      path: srcPath,
      standalone: true,
      flat: true,
      style: 'scss',
      skipFormat: true,
    } as Parameters<typeof componentGenerator>[1]);

    // Re-export the generated component. The componentGenerator writes `<name>.component.ts`
    // next to src/index.ts (flat: true), so a relative barrel export is correct.
    tree.write(
      indexPath,
      `// ${options.name} secondary entry-point (${packageName}/${options.name}).\n` +
        `export * from './${options.name}.component';\n`
    );
  } else {
    // 'none' — leave the entry empty. Overwrite whatever placeholder the base generator wrote
    //   with a clear, intentionally-empty barrel so the entry typechecks and is obviously a stub.
    tree.write(
      indexPath,
      `// ${options.name} secondary entry-point (${packageName}/${options.name}).\n` +
        `// Public surface of this entry-point — re-export what consumers should import here.\n` +
        `export {};\n`
    );
  }

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default secondaryEntrypointGenerator;

/**
 * Reset the parent library's tsconfig.lib.json include/exclude to the canonical BOUNDED shape.
 * See the call site (step 1b): the delegated secondary-entry generator bloats these arrays
 * cartesian-style across runs, eventually producing a multi-MB tsconfig whose globs compile to a
 * regex past V8's nesting limit. We defeat that bloat by RESETTING to a fixed-size glob set on
 * every run — but the set must still cover every source the editor needs to type-check.
 *
 * The two include globs are deliberate and fixed-size (no per-entry accumulation, so they can NOT
 * reintroduce the cartesian TS500 bloat):
 *   - `src/**\/*.ts`     → the PRIMARY entry's sources (the root `src/`).
 *   - `**\/src/**\/*.ts` → EVERY secondary-entry's sources, which sit in their OWN `src/` beside the
 *                          primary one (e.g. `reactive-input/shared/src/`, `router-x/navigation/src/`).
 * Without the second glob those nested sources fall outside the lib's TS project, so the editor
 * can't resolve `@bespunky/*` imports inside them → ts(2307). On the PATHS linking model that is a
 * broken link, so the bounded include is what makes a multi-entry lib editor-correct. No-op when
 * the file is absent.
 */
function resetLibTsConfig(tree: Tree, libraryRoot: string): void {
  const tsLibPath = joinPathFragments(libraryRoot, 'tsconfig.lib.json');
  if (!tree.exists(tsLibPath)) return;
  updateJson(tree, tsLibPath, (json) => {
    json.include = ['src/**/*.ts', '**/src/**/*.ts'];
    json.exclude = [
      'src/**/*.spec.ts',
      '**/src/**/*.spec.ts',
      'src/**/*.test.ts',
      '**/src/**/*.test.ts',
      '**/*.stories.ts',
      '**/storybook/**',
    ];
    return json;
  });
}

/**
 * Read the parent library's published package name (e.g. `@bespunky/angular-zen`) from its
 * package.json. Used only for the comment header in the generated index.ts — purely cosmetic,
 * so a missing name degrades to the project name rather than throwing.
 */
function readPackageName(tree: Tree, libraryRoot: string, fallback: string): string {
  const pkgPath = joinPathFragments(libraryRoot, 'package.json');
  if (!tree.exists(pkgPath)) {
    assertLibraryGeneratedByNx(fallback);
    return fallback;
  }
  const pkg = readJson<{ name?: string }>(tree, pkgPath);
  return pkg.name ?? fallback;
}

/**
 * Defensive guard carried forward from xpand: a library without a package.json almost certainly
 * wasn't produced by the @nx/angular library generator, so a secondary entry-point on it won't
 * resolve. We only warn (the package name is cosmetic here) rather than hard-fail.
 */
function assertLibraryGeneratedByNx(library: string): void {
  logger.warn(
    `[secondary-entrypoint] Library \`${library}\` has no package.json at its root. ` +
      `Secondary entry-points expect a publishable library generated by '@nx/angular:library' ` +
      `(or the house \`publishable-lib\` generator). The entry was still created, but verify ` +
      `the library is publishable.`
  );
}
