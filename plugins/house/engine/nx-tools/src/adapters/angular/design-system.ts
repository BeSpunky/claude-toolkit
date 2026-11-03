// The Angular adapter's DESIGN-SYSTEM port — the framework half of the design system.
//
// The tokens and the SASS API are framework-neutral (generators/design-system/files/styles). What is Angular:
//   - the LIBRARY SHAPE: a publishable @nx/angular library, built by ng-packagr (created by publishable-lib
//     through this adapter's `libs` port — the DS is a publishable library like any other);
//   - the RUNTIME BINDING: DsTheme (writes the mode attribute), DsRuntimeTheme, provideDesignSystem() —
//     seeded from ./design-system-files, with STRUCTURE.md and the src/index.ts barrel as the owned contract;
//   - the LIBRARY'S OWN sass channel: ng-packagr does not read an app's stylePreprocessorOptions, it has its
//     own `lib.styleIncludePaths` (relative to ng-package.json) — and `assets` ships the raw .scss to dist;
//   - the FIRST SPEC: a library that ships no components still has a runtime to test, and its test target needs one
//     (see creationTemplates), and a target that also runs the specs its entry points carry (see reachEntryPointSpecs);
//   - the COMPONENT GENERATOR: `ds-component`, one secondary entry point per component.
import { join } from 'node:path';
import { type ProjectConfiguration, type Tree, readProjectConfiguration, updateJson, logger } from '@nx/devkit';
import { updateProjectConfigurationInPlace } from '../../generators/_utils/project-files';
import type { DesignSystemPort } from '../stack-adapter';
import { pruneUnusedPeers } from './library-peers';

/** The runtime files this binding owns; anything else under src/lib is the base generator's demo output. */
const RUNTIME_FILES = new Set(['design-system.providers.ts', 'ds-theme.service.ts', 'ds-runtime-theme.service.ts']);

/**
 * The specs of the whole library, for a runner that resolves globs from the source root (<library>/src). BOTH halves are
 * needed: the builder's glob reports a file under its cwd by its cwd-relative path, which a `../` pattern never matches,
 * so `../**` alone finds the entry points and silently drops src (verified on @angular/build 22.2).
 */
const SPECS_OF_THE_LIBRARY = ['**/*.spec.ts', '**/*.test.ts', '../**/*.spec.ts', '../**/*.test.ts'];
/** The builder ignores `**\/node_modules/**` itself, but that pattern does not match above its cwd either. */
const NOT_THE_LIBRARYS_OWN = ['../**/node_modules/**', '../**/dist/**'];

export const angularDesignSystem: DesignSystemPort = {
  templates: join(__dirname, 'design-system-files'),
  alwaysRewrite: ['STRUCTURE.md', 'src/index.ts'],
  provider: 'provideDesignSystem',

  openLibraryStyles(tree: Tree, root: string, specifier: string) {
    const ngPackagePath = `${root}/ng-package.json`;
    if (!tree.exists(ngPackagePath)) {
      logger.warn(
        `[design-system] No ng-package.json at ${ngPackagePath} — the library's own SCSS will not resolve ` +
          `\`@use '${specifier}'\`, and the sass layer will not ship to dist. Verify the publishable Angular output.`,
      );
      return;
    }
    updateJson(tree, ngPackagePath, (json: Record<string, unknown>) => {
      const lib = { ...((json.lib as Record<string, unknown>) ?? {}) };
      // `..` — the DS's parent dir, matching the app's load path, so the specifier is the same everywhere.
      lib.styleIncludePaths = [...new Set([...((lib.styleIncludePaths as string[]) ?? []), '..'])];
      json.lib = lib;
      json.assets = [...new Set([...((json.assets as string[]) ?? []), './styles'])];
      return json;
    });
  },

  /**
   * The design system ships ZERO components — a scaffolded demo component would be the first thing a developer
   * copies, and it would teach exactly the wrong lesson. Deletes anything under src/lib that isn't ours, and judges the
   * peers again: the library port judged them with the demo still there, and whatever only the demo imported goes with it.
   */
  pruneGenerated(tree: Tree, root: string) {
    const libDir = `${root}/src/lib`;
    if (!tree.exists(libDir)) return;
    for (const child of tree.children(libDir)) {
      if (RUNTIME_FILES.has(child)) continue;
      logger.info(`[design-system] Pruning \`${libDir}/${child}\` — the design system ships no components.`);
      tree.delete(`${libDir}/${child}`);
    }
    pruneUnusedPeers(tree, root);
  },

  /**
   * @nx/angular:unit-test FAILS on a library with no spec ("No tests found") and has no passWithNoTests option (its
   * schema refuses one; verified on @nx/angular 24.0 / @angular/build 22.2), and pruning the demo removed the only spec
   * @nx/angular wrote. So the library is born with a real spec of the runtime it ships. Only this executor is judged:
   * it means Angular 21+, which covers the 20+ the spec's TestBed.tick() needs. Jest, the runner below Angular 21, passes
   * on no specs only through Nx 23 (its targetDefaults); Nx 24 infers its target, and no target here means no spec.
   */
  creationTemplates(project: ProjectConfiguration) {
    return project.targets?.test?.executor === '@nx/angular:unit-test' ? join(__dirname, 'design-system-creation-files') : undefined;
  },

  /**
   * @nx/angular:unit-test looks only under the source root, and `ds-component` writes a component's spec at
   * <library>/<entry>/src. Without this a failing entry spec exits 0 beside DsTheme's passing one: a false green.
   */
  reachEntryPointSpecs(tree: Tree, name: string) {
    const project = readProjectConfiguration(tree, name);
    const test = project.targets?.test;
    if (test?.executor !== '@nx/angular:unit-test') return;
    test.options = { ...test.options, include: SPECS_OF_THE_LIBRARY, exclude: NOT_THE_LIBRARYS_OWN };
    updateProjectConfigurationInPlace(tree, name, project);
  },
};
