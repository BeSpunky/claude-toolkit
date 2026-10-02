// The Angular adapter's LIBRARY port: @nx/angular:library, plus the ng-packagr config a publishable lib needs.
import { type Tree, type GeneratorCallback, readJson, writeJson, updateJson, logger } from '@nx/devkit';
import type { LibPort } from '../stack-adapter';

const noop: GeneratorCallback = () => {};

export const angularLibs: LibPort = {
  async create(tree, options) {
    // Option NAMES verified against @nx/angular 23 (`nx g @nx/angular:library --help`): standalone-only suite,
    // no NgModule entry, the Angular-native Vitest runner, eslint as a string (the enum is deprecated).
    const { libraryGenerator } = await import('@nx/angular/generators');
    return (
      (await libraryGenerator(tree, {
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
        unitTestRunner: 'vitest-angular',
        skipFormat: true,
        tags: options.tags,
      } as Parameters<typeof libraryGenerator>[1])) ?? noop
    );
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
