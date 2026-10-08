// The Angular adapter's DESIGN-SYSTEM port — the framework half of the design system.
//
// The tokens and the SASS API are framework-neutral (generators/design-system/files/styles). What is Angular:
//   - the LIBRARY SHAPE: a publishable @nx/angular library, built by ng-packagr (created by publishable-lib
//     through this adapter's `libs` port — the DS is a publishable library like any other);
//   - the RUNTIME BINDING: DsTheme (writes the mode attribute), DsRuntimeTheme, provideDesignSystem() —
//     seeded from ./design-system-files, with STRUCTURE.md and the src/index.ts barrel as the owned contract;
//   - the LIBRARY'S OWN sass channel: ng-packagr does not read an app's stylePreprocessorOptions, it has its
//     own `lib.styleIncludePaths` (relative to ng-package.json) — and `assets` ships the raw .scss to dist;
//   - the COMPONENT GENERATOR: `ds-component`, one secondary entry point per component.
import { join } from 'node:path';
import { type Tree, updateJson, logger } from '@nx/devkit';
import type { DesignSystemPort } from '../stack-adapter';
import { updateManifest } from '../../generators/_utils/dependencies';

/** The runtime files this binding owns; anything else under src/lib is the base generator's demo output. */
const RUNTIME_FILES = new Set(['design-system.providers.ts', 'ds-theme.service.ts', 'ds-runtime-theme.service.ts']);

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
   * copies, and it would teach exactly the wrong lesson. Deletes anything under src/lib that isn't ours.
   */
  pruneGenerated(tree: Tree, root: string) {
    const libDir = `${root}/src/lib`;
    if (!tree.exists(libDir)) return;
    for (const child of tree.children(libDir)) {
      if (RUNTIME_FILES.has(child)) continue;
      logger.info(`[design-system] Pruning \`${libDir}/${child}\` — the design system ships no components.`);
      tree.delete(`${libDir}/${child}`);
    }
  },

  pruneUnusedPeers(tree: Tree, root: string) {
    const unused = unusedAngularPeers(tree, root);
    if (!unused.length) return;
    updateManifest(tree, `${root}/package.json`, 'design-system', (json) => {
      for (const name of unused) delete json.peerDependencies[name];
      return json;
    });
    logger.info(`[design-system] ${root}/package.json no longer peers ${unused.join(', ')} — only the pruned demo used it.`);
  },
};

/**
 * The `@angular/*` peers (other than @angular/core, which every Angular library needs) a library's manifest declares
 * and no source file under it imports — what @nx/angular's library generator declared for its demo component. The
 * rule @nx/dependency-checks applies, so the library passes its own lint.
 */
export function unusedAngularPeers(tree: Tree, root: string): string[] {
  const manifest = `${root}/package.json`;
  if (!tree.exists(manifest)) return [];
  let peers: Record<string, string> = {};
  try {
    peers = JSON.parse(tree.read(manifest, 'utf8') ?? '').peerDependencies ?? {};
  } catch {
    return [];
  }
  const candidates = Object.keys(peers).filter((name) => name.startsWith('@angular/') && name !== '@angular/core');
  if (!candidates.length) return [];
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const child of tree.children(dir)) {
      const path = `${dir}/${child}`;
      if (tree.isFile(path)) {
        if (/\.[cm]?[jt]sx?$/.test(child)) sources.push(tree.read(path, 'utf8') ?? '');
      } else if (child !== 'node_modules') walk(path);
    }
  };
  walk(root);
  return candidates.filter((name) => !sources.some((text) => new RegExp(`['"]${name.replace(/[/]/g, '\\/')}(?:/[^'"]*)?['"]`).test(text)));
}
