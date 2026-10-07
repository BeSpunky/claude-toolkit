// The Angular adapter's LIBRARY port: @nx/angular:library, plus the ng-packagr config a publishable lib needs.
import { type Tree, type GeneratorCallback, readJson, writeJson, updateJson, logger } from '@nx/devkit';
import type { LibPort } from '../stack-adapter';
import { workspaceLinking } from '../../generators/_utils/linking';
import { angularGeneratorCall, stateAngularCompilerContract } from './ts-solution';
import { withPlatform, csvTags } from '../../platform/platform';
import { stateAnalogTsconfig } from './analog-tsconfig';
import { convertBareLint } from '../../generators/_utils/lint-inference';

const noop: GeneratorCallback = () => {};

export const angularLibs: LibPort = {
  // LINKED THE WAY THE WORKSPACE LINKS — the port's promise, kept the same in both models:
  //   - `paths`: @nx/angular:library writes the root-tsconfig alias itself (addTsConfigPath), as it always has.
  //   - `workspaces`: it would write that SAME alias — into tsconfig.base.json, the file every TS-solution package
  //     extends — because @nx/angular knows no other model (it refuses these workspaces; see ./ts-solution). A
  //     `paths` entry there is a second, global linking channel inside a references-based build: any composite
  //     package could import the library through it with no reference behind it, and the workspace would link two
  //     ways at once. So the alias is skipped (`skipTsConfig`) and the library is linked through the workspace's
  //     own port instead: a workspace member whose package.json `exports` its source under the custom condition,
  //     referenced by the solution — what @nx/js:library produces. An Angular LIBRARY is therefore not an island:
  //     it is a package like any other, consumed by Angular apps (the islands — they resolve `exports` like any
  //     import) and by plain-TS packages alike. Verified for real (@nx/angular 23.1, ng-packagr 22; U4 in
  //     docs/features/2026-10-02-workspace-layouts): ng-packagr builds with the source `exports` present, and an
  //     Angular app importing the library and a TS-solution package passes `nx sync`, typecheck and build.
  //     One honest leftover: ng-packagr MERGES the source package.json's `exports` into the dist one, replacing
  //     `types`/`default` but KEEPING the source-condition key — so the published package.json carries
  //     `"<condition>": "./src/index.ts"`. That is the same trade Nx makes for its own TS-solution packages, and it
  //     is inert exactly when the condition is workspace-unique (Nx's `@<scope>/source`), never a common one
  //     (`development`) that a consumer's bundler would actually match.
  //     And one honest warning: ng-packagr reports the source manifest's `types`/`default` (written by `link`,
  //     pointing at source) as "conflicting … would be overridden". Harmless, and NOT to be dropped: overriding them
  //     in the dist manifest is exactly right, while in the workspace they are LOAD-BEARING — the Angular
  //     application builder resolves an Angular app's import of the library through them (it does not apply the
  //     workspace's custom condition), and without them the app fails with "Could not resolve" / TS2307 (verified
  //     against the tripwire's workspace). So the link stays uniform; no Angular special case in the linker.
  // Secondary entry points must follow the same rule: link each subpath through the port (`subpath`), never a
  // `paths` alias of their own.
  async create(tree, options) {
    const linking = workspaceLinking(tree);
    const ownAlias = linking.kind === 'paths';
    // Option NAMES verified against @nx/angular 23 (`nx g @nx/angular:library --help`): standalone-only suite,
    // no NgModule entry, Vitest, eslint as a string (the enum is deprecated). WHICH Vitest follows from the build:
    // `vitest-angular` (the Angular-native `@nx/angular:unit-test` executor) runs through the library's own
    // build, so @nx/angular REFUSES it for a library that has none (validate-options: "requires the library to
    // be buildable or publishable") — a workspace-internal library (navigation-core) gets `vitest-analog`,
    // @nx/angular's own Vitest choice for exactly that case.
    const { libraryGenerator } = await import('@nx/angular/generators');
    const callback =
      (await angularGeneratorCall(tree, () => libraryGenerator(tree, {
        name: options.name,
        directory: options.directory,
        importPath: options.importPath,
        publishable: options.publishable,
        buildable: options.publishable,
        standalone: true,
        skipModule: true,
        prefix: options.prefix ?? 'bs',
        style: options.style ?? 'scss',
        linter: 'eslint',
        strict: true,
        unitTestRunner: options.publishable ? 'vitest-angular' : 'vitest-analog',
        skipFormat: true,
        tags: withPlatform(csvTags(options.tags), options.platform).join(','),
        skipTsConfig: !ownAlias,
      } as Parameters<typeof libraryGenerator>[1]))) ?? noop;
    // The Analog test config names its tsconfig, or every graph computation warns about a tsconfig.app.json a
    // library never has (./analog-tsconfig).
    stateAnalogTsconfig(tree, options.directory.replace(/\/+$/, ''));
    // Linted the way Nx recommends (@nx/eslint/plugin's inferred target), not by the deprecated executor @nx/angular writes.
    convertBareLint(tree, options.name);
    if (!ownAlias) {
      const libRoot = options.directory.replace(/\/+$/, '');
      linking.link(tree, { importPath: options.importPath, libRoot });
      stateTheBuildsSourceMaps(tree, libRoot);
      stateAngularCompilerContract(tree, libRoot);
    }
    return callback;
  },

  /**
   * The library's root ng-package.json in the house modern-entrypoint shape:
   *   { $schema, dest: <relative path to dist/<projectRoot>>, lib: { entryFile: 'src/index.ts' } }
   * with any `umdModuleIds` stripped (banned by the entry-point standard). Mutates what the base generator
   * emitted rather than assuming its exact contents.
   */
  normalizePackaging(tree: Tree, projectRoot: string) {
    const ngPackagePath = `${projectRoot}/ng-package.json`;
    if (!tree.exists(ngPackagePath)) {
      logger.warn(
        `[publishable-lib] Expected a root ng-package.json at ${ngPackagePath} but none was emitted — ` +
          `skipped normalization. Verify the @nx/angular publishable library output.`,
      );
      return;
    }
    // One `..` per segment of projectRoot gets from the ng-package.json back to the workspace root.
    const upToRoot = projectRoot.split('/').filter(Boolean).map(() => '..').join('/');
    const ngPackage = readJson<Record<string, unknown>>(tree, ngPackagePath);
    ngPackage.$schema = '../../node_modules/ng-packagr/ng-package.schema.json';
    ngPackage.dest = `${upToRoot}/dist/${projectRoot}`;
    ngPackage.lib = { ...((ngPackage.lib as Record<string, unknown>) ?? {}), entryFile: 'src/index.ts' };
    delete (ngPackage.lib as Record<string, unknown>).umdModuleIds;
    delete ngPackage.umdModuleIds;
    writeJson(tree, ngPackagePath, ngPackage);
  },

  /**
   * ng-packagr HARD-FAILS the build on any `dependencies` entry that is neither a peerDependency nor listed in
   * `allowedNonPeerDependencies`. Merged and de-duplicated, preserving what is already there.
   */
  allowDependencies(tree: Tree, projectRoot: string, dependencies: string[]) {
    const ngPackagePath = `${projectRoot}/ng-package.json`;
    if (!tree.exists(ngPackagePath)) {
      logger.warn(
        `[publishable-lib] No ng-package.json at ${ngPackagePath} — could not allow non-peer deps ` +
          `(${dependencies.join(', ')}); an Angular build will reject them. Verify the publishable Angular output.`,
      );
      return;
    }
    updateJson(tree, ngPackagePath, (json: Record<string, unknown>) => {
      json.allowedNonPeerDependencies = [
        ...new Set([...((json.allowedNonPeerDependencies as string[]) ?? []), ...dependencies]),
      ];
      return json;
    });
  },
};

/**
 * A TS-solution workspace typechecks EVERY project with plain `tsc --build` (the `@nx/js/typescript` plugin infers
 * a `typecheck` target from each tsconfig.json) — the Angular library included. @nx/angular gives a buildable
 * library's tsconfig.lib.json `inlineSources` without `sourceMap`, which tsc rejects outright (TS5051); it never
 * mattered before because only ng-packagr read that file, and ng-packagr FORCES `sourceMap: true` +
 * `inlineSources: true` itself (ng-packagr src/lib/ts/tsconfig.js). So the fix is to state the pair the build
 * actually uses — not to drop `inlineSources`: the file then tells the truth to both of its readers.
 */
function stateTheBuildsSourceMaps(tree: Tree, libRoot: string): void {
  const tsconfig = `${libRoot}/tsconfig.lib.json`;
  if (!tree.exists(tsconfig)) return;
  updateJson(tree, tsconfig, (json: { compilerOptions?: Record<string, unknown> }) => {
    const options = json.compilerOptions;
    if (options?.inlineSources && options.sourceMap === undefined && !options.inlineSourceMap) options.sourceMap = true;
    return json;
  });
}
