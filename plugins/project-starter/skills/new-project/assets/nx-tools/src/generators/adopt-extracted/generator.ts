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
//          membership, solution reference and `workspace:` dependencies — see `_utils/linking`).
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
  addDependenciesToPackageJson,
  readJson,
  writeJson,
  visitNotIgnoredFiles,
  joinPathFragments,
  formatFiles,
  logger,
} from '@nx/devkit';
import { requireLayer } from '../../layers/registry';
import { workspaceLinking } from '../_utils/linking';

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
  const linkedAs = workspaceLinking(tree).importPathOf(tree, project.root);
  const libPkg = readJsonSafe(tree, joinPathFragments(project.root, 'package.json'));
  const libName = typeof libPkg.name === 'string' ? libPkg.name : undefined;
  const rewriteAliases = [...new Set([linkedAs, libName].filter(Boolean))] as string[];

  // ---- Step 2: finalize (delete the now-unused local lib) ----
  if (options.finalize) {
    const rootPkg = readJsonSafe(tree, 'package.json');
    const installed = { ...(rootPkg.dependencies ?? {}), ...(rootPkg.devDependencies ?? {}) };
    if (!(packageName in installed)) {
      throw new Error(
        `adopt-extracted --finalize: "${packageName}" isn't a dependency yet. ` +
          `Run adopt-extracted (without --finalize) first, build to verify, then --finalize.`
      );
    }
    // Unlink BEFORE deleting: the linking reads the library's own files to know what to remove.
    const importPath = linkedAs ?? libName;
    if (importPath) workspaceLinking(tree).unlink(tree, { importPath, libRoot: project.root });
    removeProjectConfiguration(tree, options.lib);
    tree.delete(project.root);
    await formatFiles(tree);
    logger.info(`✔ Removed local library "${options.lib}" — the project now uses ${packageName}. Loop closed.`);
    return;
  }

  // ---- Step 1: add the dependency ----
  const installCallback = addDependenciesToPackageJson(
    tree,
    { [packageName]: options.version ?? 'latest' },
    {}
  );

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
    logger.info(`Rewrote imports (${rewriteAliases.join(', ')}) → "${packageName}" in ${changed} file(s).`);
  } else {
    logger.warn(
      `Could not determine the local import specifier for "${options.lib}" — rewrite skipped. Update imports to "${packageName}" by hand.`
    );
  }

  marker.status = 'adopting';
  writeJson(tree, markerPath, marker);
  await formatFiles(tree);

  logger.info(
    `Added ${packageName} and rewrote imports. Next: build to verify the package works, then ` +
      `re-run with --finalize to remove the local library "${options.lib}".`
  );
  return installCallback;
}
