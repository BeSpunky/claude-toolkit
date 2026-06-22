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
// LINKING MODEL (the suite's one decision that shapes this generator):
//   The BeSpunky suite links in-repo via package-manager WORKSPACES + project references —
//   NOT `tsconfig.base.json` path aliases. The published package's subpath export resolves
//   the deep import; in-repo it resolves via the package symlink's subpath. Therefore, if the
//   delegated @nx/angular generator adds a `tsconfig.base.json` `paths` entry for the new
//   subpath, this generator STRIPS it (see stripTsConfigPath) so the two linking models don't
//   coexist and fight. We deliberately do NOT add any path alias of our own.
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

  // 1b) RESET the parent lib's tsconfig.lib.json include/exclude to the sane root-entry shape.
  //     The delegated @nx/angular generator APPENDS the new entry's deep glob to these arrays on
  //     every run — and (observed on @nx/angular 23.1) cumulatively/cartesian: N secondary entries
  //     explode into thousands of globs (a multi-MB tsconfig), which TS then compiles into a regex
  //     past V8's nesting limit ("error TS500: Invalid regular expression", the ng-packagr build
  //     dies — worst on 4-segment-deep entries like `router-x/navigation/zod`). ng-packagr discovers
  //     secondary entries via their own nested ng-package.json, so the ROOT tsconfig only needs the
  //     root entry's src. Resetting here makes the generator idempotent and bloat-proof.
  resetLibTsConfig(tree, libraryRoot);

  const entryRoot = joinPathFragments(libraryRoot, options.name);

  // 2) STRIP the tsconfig.base.json path alias if the base generator added one.
  //    See the LINKING MODEL note at the top of this file.
  // ASSUMPTION (verify in Docker): whether @nx/angular 23.1's secondary-entry-point generator
  //    writes a `tsconfig.base.json` `paths` entry at all. Older lines did; recent Nx (Project
  //    Crystal / TS-solution setups) may not, or may write to a different tsconfig. This strip
  //    is defensive and idempotent — it's a no-op when no such entry exists.
  stripTsConfigPath(tree, packageName, options.name);

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
 * Reset the parent library's tsconfig.lib.json include/exclude to the canonical root-entry shape.
 * See the call site (step 1b): the delegated secondary-entry generator bloats these arrays
 * cartesian-style across runs, eventually producing a multi-MB tsconfig whose globs compile to a
 * regex past V8's nesting limit. ng-packagr builds secondary entries via their own ng-package.json,
 * so the root tsconfig only needs `src/**` (the root entry). No-op when the file is absent.
 */
function resetLibTsConfig(tree: Tree, libraryRoot: string): void {
  const tsLibPath = joinPathFragments(libraryRoot, 'tsconfig.lib.json');
  if (!tree.exists(tsLibPath)) return;
  updateJson(tree, tsLibPath, (json) => {
    json.include = ['src/**/*.ts'];
    json.exclude = ['src/**/*.spec.ts', 'src/**/*.test.ts'];
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

/**
 * Remove the `tsconfig.base.json` `paths` entry for `<packageName>/<entryName>` if the delegated
 * generator added one. The suite links via workspaces + project references, so a path alias here
 * would be a competing (and stale) resolution mechanism. Idempotent and shape-tolerant: a no-op
 * when there is no `tsconfig.base.json`, no `compilerOptions.paths`, or no matching key.
 *
 * ASSUMPTION (verify in Docker): the alias key the base generator would write is exactly
 *   `<packageName>/<entryName>`. If @nx/angular 23.1 doesn't add a path at all (likely on a
 *   TS-solution / Project-Crystal workspace), this function simply never finds a key to delete.
 */
function stripTsConfigPath(tree: Tree, packageName: string, entryName: string): void {
  const tsConfigPath = 'tsconfig.base.json';
  if (!tree.exists(tsConfigPath)) return;

  const aliasKey = `${packageName}/${entryName}`;
  updateJson(tree, tsConfigPath, (json) => {
    const paths = json?.compilerOptions?.paths as Record<string, unknown> | undefined;
    if (paths && Object.prototype.hasOwnProperty.call(paths, aliasKey)) {
      delete paths[aliasKey];
      logger.info(
        `[secondary-entrypoint] Removed the \`${aliasKey}\` tsconfig.base.json path alias added ` +
          `by the base generator. The suite links via workspaces + project references; the deep ` +
          `import resolves through the package's subpath export, not a tsconfig path.`
      );
    }
    return json;
  });
}
