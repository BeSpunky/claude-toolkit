// House generator: adopt an extracted package back into the project — the loop-closer.
//
// A local library that was marked (`mark-extractable`), lifted into the shared @bespunky
// workspace (`extract-tool`) and published (`nx release`) is now an npm package. This swaps the
// project from the local copy to the published one, so the shared library is the single source
// of truth.
//
// Honours verify-then-delete (decision #3) — deleting is a SEPARATE, second run, so you can
// build in between and confirm the package actually works:
//
//   1. nx g @bespunky/nx-tools:adopt-extracted <lib>
//        → adds the package dependency + rewrites imports (local alias → package). KEEPS the lib.
//   2. build the project to verify the package works.
//   3. nx g @bespunky/nx-tools:adopt-extracted <lib> --finalize
//        → removes the now-unused local library and unlinks it (its path aliases, or its workspace
//          membership, solution reference and the workspace-range dependencies linking declared — see
//          `_utils/linking`). The published dependency step 1 declared is not one of those, so it stays.
//
//   --keepShim: one-step staged migration instead — replace the lib's entry with
//               `export * from '<package>'` and keep it (old import paths keep working).
//
// Runs inside the project's own Nx workspace (a normal generator). The import rewrite is a
// best-effort module-specifier codemod — review the diff and the build before --finalize.
import {
  type Tree,
  type GeneratorCallback,
  readProjectConfiguration,
  removeProjectConfiguration,
  readJson,
  writeJson,
  visitNotIgnoredFiles,
  joinPathFragments,
  formatFiles,
  logger,
} from '@nx/devkit';
import { requireLayer } from '../../layers/registry';
import { workspaceLinking } from '../_utils/linking';
import { declareDependencies, declaredSpec } from '../_utils/dependencies';
import { updateJsonInPlace } from '../_utils/json-edits';

interface AdoptExtractedSchema {
  lib: string;
  package?: string;
  version?: string;
  finalize?: boolean;
  keepShim?: boolean;
}

const readJsonSafe = (tree: Tree, path: string): Record<string, any> =>
  tree.exists(path) ? (readJson(tree, path) as Record<string, any>) : {};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default async function adoptExtractedGenerator(
  tree: Tree,
  options: AdoptExtractedSchema
): Promise<GeneratorCallback | void> {
  // Swapping a local library for its published package presupposes there ARE libraries — the `js` layer.
  requireLayer(tree, 'js', 'adopt-extracted');

  const project = readProjectConfiguration(tree, options.lib);
  const markerPath = joinPathFragments(project.root, 'extraction.json');
  const marker = readJsonSafe(tree, markerPath);

  const packageName: string | undefined =
    options.package ?? marker.ingestedPackage?.name ?? marker.proposedPackage;
  if (!packageName) {
    throw new Error(
      `adopt-extracted: could not determine the published package name for "${options.lib}". ` +
        `Pass --package <scope>/<name> (or run after extract-tool has set ingestedPackage).`
    );
  }

  // The local import specifier(s) to rewrite away from: what THIS workspace imports the lib by (its linking's
  // answer — a path alias, or its package name), plus its package.json name, which a project may also import
  // it by when the two differ. Cover both.
  const linking = workspaceLinking(tree);
  const linkedAs = linking.importPathOf(tree, project.root);
  const libPkg = readJsonSafe(tree, joinPathFragments(project.root, 'package.json'));
  const libName = typeof libPkg.name === 'string' ? libPkg.name : undefined;
  const rewriteAliases = [...new Set([linkedAs, libName].filter(Boolean))] as string[];

  // ---- Step 2: finalize (delete the now-unused local lib) ----
  if (options.finalize) {
    const rootPkg = readJsonSafe(tree, 'package.json');
    const installed = { ...(rootPkg.dependencies ?? {}), ...(rootPkg.devDependencies ?? {}) };
    // Declared by a range of its own — not the workspace range that reaches the LOCAL package, which the unlink
    // below removes (and with it the only declaration there was).
    const declared = installed[packageName];
    if (typeof declared !== 'string' || linking.isLinkRange(tree, declared)) {
      throw new Error(
        `adopt-extracted --finalize: the published "${packageName}" isn't a dependency yet` +
          `${typeof declared === 'string' ? ` (only the local workspace link "${declared}" is)` : ''}. ` +
          `Run adopt-extracted (without --finalize) first, build to verify, then --finalize.`
      );
    }
    // Unlink BEFORE deleting: the linking reads the library's own files to know what to remove.
    const importPath = linkedAs ?? libName;
    if (importPath) linking.unlink(tree, { importPath, libRoot: project.root });
    removeProjectConfiguration(tree, options.lib);
    tree.delete(project.root);
    await formatFiles(tree);
    logger.info(`✔ Removed local library "${options.lib}" — the project now uses ${packageName}. Loop closed.`);
    return;
  }

  // ---- Step 1: declare the PUBLISHED dependency ----
  // Where the local library shares the package's name, the root may already declare it — by the range the
  // workspace's linking wrote to reach the LOCAL package (`*` / `workspace:*`). That declaration is replaced, not
  // kept beside: it is what --finalize's unlink removes, so leaving it would end with no dependency at all, and
  // devkit's version merge cannot be trusted to prefer a dist-tag over a bare `*`.
  const rootManifest = readJsonSafe(tree, 'package.json');
  const linkedFields = (['dependencies', 'devDependencies'] as const).filter((field) => {
    const range = rootManifest[field]?.[packageName];
    return typeof range === 'string' && linking.isLinkRange(tree, range);
  });
  if (linkedFields.length) {
    updateJsonInPlace(tree, 'package.json', (manifest) => {
      for (const field of linkedFields) delete manifest[field][packageName];
    });
  }
  // The version is a deliberate value — never `latest` (0.50.0): the one given, else the one extract-tool recorded
  // when it published (marker.ingestedPackage.version), as a caret range; with neither, ask rather than float.
  const recorded: unknown = marker.ingestedPackage?.version;
  const version =
    options.version ?? (typeof recorded === 'string' && /^\d+\.\d+\.\d+/.test(recorded) ? `^${recorded}` : undefined);
  if (!version) {
    throw new Error(
      `adopt-extracted: which version of ${packageName} should "${options.lib}" adopt? The extraction marker records ` +
        `none it can use${typeof recorded === 'string' ? ` ("${recorded}")` : ''}. Pass --version=^<published version> ` +
        `(\`npm view ${packageName} version\` names the newest) — the house never declares a dist-tag like latest.`
    );
  }
  const alreadyDeclared = declaredSpec(tree, packageName) !== undefined;
  const installCallback = declareDependencies(tree, 'adopt-extracted', { [packageName]: version });

  const entry = project.sourceRoot
    ? joinPathFragments(project.sourceRoot, 'index.ts')
    : joinPathFragments(project.root, 'src', 'index.ts');

  if (options.keepShim) {
    // Staged migration: the lib becomes a thin re-export; old import paths keep working.
    tree.write(entry, `export * from '${packageName}';\n`);
    const libImplDir = project.sourceRoot
      ? joinPathFragments(project.sourceRoot, 'lib')
      : joinPathFragments(project.root, 'src', 'lib');
    if (tree.exists(libImplDir)) tree.delete(libImplDir);
    marker.status = 'adopted-shim';
    writeJson(tree, markerPath, marker);
    await formatFiles(tree);
    logger.info(
      `✔ "${options.lib}" now re-exports ${packageName} (shim). Imports unchanged; old paths keep working.`
    );
    return installCallback;
  }

  // The local library still answers its own specifier until --finalize removes it — whichever way the
  // workspace links, the in-repo link wins over the installed package. Said out loud, so the verification build
  // is not mistaken for proof that the PUBLISHED package works.
  if (rewriteAliases.includes(packageName)) {
    logger.warn(
      `"${packageName}" is also the local library's own specifier, so until --finalize it still resolves to ` +
        `${project.root}, not to the installed package — the build between the two runs verifies the local copy.`
    );
  }

  // Default: rewrite imports from the local specifier(s) to the package, keep the lib for now.
  if (rewriteAliases.length) {
    const regexes = rewriteAliases.map(
      (a) => new RegExp("(['\"`])" + escapeRegExp(a) + "(/[^'\"`]*)?\\1", 'g')
    );
    let changed = 0;
    visitNotIgnoredFiles(tree, '.', (file) => {
      if (!file.endsWith('.ts') || file.startsWith(project.root)) return;
      const content = tree.read(file, 'utf-8');
      if (!content) return;
      let updated = content;
      for (const re of regexes) {
        updated = updated.replace(re, (_m, q: string, sub = '') => `${q}${packageName}${sub ?? ''}${q}`);
      }
      if (updated !== content) {
        tree.write(file, updated);
        changed++;
      }
    });
    logger.info(
      changed
        ? `Rewrote imports (${rewriteAliases.join(', ')}) → "${packageName}" in ${changed} file(s).`
        : `No file imports ${rewriteAliases.join(', ')} — nothing to rewrite.`,
    );
  } else {
    logger.warn(
      `Could not determine the local import specifier for "${options.lib}" — rewrite skipped. Update imports to "${packageName}" by hand.`
    );
  }

  marker.status = 'adopting';
  writeJson(tree, markerPath, marker);
  await formatFiles(tree);

  logger.info(
    `${alreadyDeclared ? `${packageName} is declared` : `Declared ${packageName}`}; imports point at it. Next: build to verify the package works, then ` +
      `re-run with --finalize to remove the local library "${options.lib}".`
  );
  return installCallback;
}
