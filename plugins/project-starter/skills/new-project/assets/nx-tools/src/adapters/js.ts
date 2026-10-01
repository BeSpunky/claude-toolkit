// THE PLAIN-TS ADAPTER — TypeScript/JavaScript with no UI framework, through @nx/js.
//
// It is what `publishable-lib` delegates to when a library is not a framework library (it replaced the
// `--nonAngular` boolean, which made one generator do two things behind a flag). It has no app, env,
// providers or styles ports: a plain-TS library has no bootstrap to wire and no stylesheet to load, and a
// capability asking for one is told so (see `portOf`).
import { type GeneratorCallback, readProjectConfiguration } from '@nx/devkit';
import type { StackAdapter } from './stack-adapter';

const noop: GeneratorCallback = () => {};

export const js: StackAdapter = {
  id: 'js',
  layer: 'js',

  ownsProject(tree, project) {
    try {
      return (readProjectConfiguration(tree, project).targets?.build?.executor ?? '').startsWith('@nx/js:');
    } catch {
      return false;
    }
  },

  libs: {
    async create(tree, options) {
      // `bundler: 'tsc'` + `publishable` is the publishable plain-TS shape; a workspace-internal library is
      // source only (`bundler: 'none'`) and consumed through its path alias.
      const { libraryGenerator } = await import('@nx/js');
      return (
        (await libraryGenerator(tree, {
          name: options.name,
          directory: options.directory,
          importPath: options.importPath,
          bundler: options.publishable ? 'tsc' : 'none',
          publishable: options.publishable,
          linter: 'eslint',
          unitTestRunner: 'vitest',
          strict: true,
          skipFormat: true,
          tags: options.tags,
        } as Parameters<typeof libraryGenerator>[1])) ?? noop
      );
    },
  },
};
