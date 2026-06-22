// House generator: create a house-standard PUBLISHABLE @bespunky library.
//
// Delegate-then-post-process (the xpand design-system-library idiom, stripped of every
// design-system specific — no storybook, tailwind, styleIncludePaths, sass exports, file: deps):
//   1. Delegate the actual library scaffold to the appropriate base generator:
//        - Angular (default) → `@nx/angular/generators` libraryGenerator with
//          publishable+buildable+standalone+skipModule, Vitest, eslint, strict.
//        - --nonAngular      → `@nx/js` libraryGenerator with bundler `tsc` (plain-TS leaves
//          like typescript-utils / rxjs; NO ng-package.json).
//   2. Read the emitted project config BACK and NORMALIZE it (we author defensively — the exact
//      tree @nx/angular@23.1 emits is not assumed; we mutate what's there rather than overwrite).
//   3. Add the per-PROJECT `nx release` baseline (git-tag resolver + dist packageRoot). The
//      ROOT release config (releaseTagPattern, projectsRelationship, the projects glob) lives in
//      nx.json and is Foundation's job — this generator NEVER touches nx.json.
//   4. (Angular only) Normalize the root ng-package.json to the modern nested-entrypoint shape:
//      { $schema, dest: <relative-to-dist>, lib: { entryFile: 'src/index.ts' } }, no umdModuleIds.
//   5. Author the workspaces+references links: add any --workspaceDeps as `workspace:*` deps to
//      the lib's own package.json, and add a `{ path: ./<directory> }` entry to the ROOT
//      tsconfig.json references[] (NOT tsconfig.base.json — base holds compilerOptions only).
//   6. Return an installPackagesTask callback so the workspace re-links after generation.
//
// Linking model (DECIDED 2026-06-22): Nx package-manager workspaces (`workspace:*`) + TS project
// references, NOT tsconfig.base.json path aliases. The generator authors per-lib deps + the root
// references entry; `nx sync` maintains the rest.
import {
  type Tree,
  type GeneratorCallback,
  type ProjectConfiguration,
  readProjectConfiguration,
  updateProjectConfiguration,
  readJson,
  writeJson,
  updateJson,
  installPackagesTask,
  formatFiles,
  logger,
} from '@nx/devkit';
import type { PublishableLibGeneratorSchema } from './schema';

// The npm scope every BeSpunky package lives under. Used to build the default importPath
// and to expand --workspaceDeps short names into scoped package names.
const SCOPE = '@bespunky';

export default async function publishableLibGenerator(
  tree: Tree,
  options: PublishableLibGeneratorSchema
): Promise<GeneratorCallback> {
  if (!options.name) {
    throw new Error('publishable-lib generator requires a library name (positional arg 0 / --name).');
  }

  // Resolve the house defaults up-front so both delegate paths and the post-processing share them.
  const name        = options.name;
  const importPath   = options.importPath ?? `${SCOPE}/${name}`;
  const directory    = options.directory ?? `packages/${name}`;
  const prefix       = options.prefix ?? 'bs';
  const style        = options.style ?? 'scss';
  const nonAngular   = options.nonAngular ?? false;
  const skipFormat   = options.skipFormat ?? false;

  // 1) Delegate the scaffold. We skipFormat on the delegate and run a single formatFiles at the
  //    end (so the whole tree — base output + our mutations — is formatted once).
  if (nonAngular) {
    // ASSUMPTION (@nx/js@23.1): the export is named `libraryGenerator` from '@nx/js'. Option names
    //   `directory`/`importPath`/`bundler`/`linter`/`unitTestRunner`/`publishable`/`strict`/`tags`/
    //   `skipFormat` are assumed stable from the Nx 22/23 line. `bundler: 'tsc'` (tsc-only, no
    //   esbuild/rollup) and `publishable: true` are the publishable-plain-TS shape; VERIFY the
    //   @nx/js library schema in Docker.
    const { libraryGenerator: jsLibraryGenerator } = await import('@nx/js');

    await jsLibraryGenerator(tree, {
      name,
      directory,
      importPath,
      bundler: 'tsc',
      publishable: true,
      linter: 'eslint',
      unitTestRunner: 'vitest',
      strict: true,
      skipFormat: true,
      tags: options.tags,
    } as Parameters<typeof jsLibraryGenerator>[1]);
  } else {
    // ASSUMPTION (@nx/angular@23.1): the export is named `libraryGenerator` from
    //   '@nx/angular/generators'. The following option NAMES are assumed stable from the Nx 22/23
    //   line and must be VERIFIED against the installed schema:
    //     - `publishable` + `buildable` (publishable should imply the @nx/angular:package build
    //       target + root ng-package.json + lib package.json; we pass both explicitly).
    //     - `standalone: true` + `skipModule: true` (standalone-only suite, no NgModule entry).
    //     - `unitTestRunner: 'vitest-angular'` — the Angular-native Vitest value. VERIFY this is the
    //       correct enum member (it may be plain `'vitest'`, or Vitest may be the default/inferred).
    //     - `linter: 'eslint'` as a string (the `Linter` enum is deprecated in newer Nx).
    //     - `strict`, `prefix`, `style`, `importPath`, `directory`, `tags`, `skipFormat`.
    const { libraryGenerator: angularLibraryGenerator } = await import('@nx/angular/generators');

    await angularLibraryGenerator(tree, {
      name,
      directory,
      importPath,
      publishable: true,
      buildable: true,
      standalone: true,
      skipModule: true,
      prefix,
      style,
      linter: 'eslint',
      strict: true,
      unitTestRunner: 'vitest-angular',
      skipFormat: true,
      tags: options.tags,
    } as Parameters<typeof angularLibraryGenerator>[1]);
  }

  // 2) Read the emitted project back. The base generator names the project after the library;
  //    `readProjectConfiguration` resolves it regardless of where the files landed.
  // ASSUMPTION: the generated project NAME equals `name`. With a nested `directory`, some Nx
  //   versions derive a name like `<dir>-<name>`. If readProjectConfiguration throws, the
  //   coordinator must reconcile the actual emitted project name (e.g. via getProjects()).
  const project = readProjectConfiguration(tree, name);
  const projectRoot = project.root; // workspace-relative, e.g. `packages/<name>`

  // 3) Per-project release baseline + publish source. (Root release config is Foundation's job.)
  applyReleaseConfig(project, projectRoot);
  updateProjectConfiguration(tree, name, project);

  // 4) Angular only: normalize the root ng-package.json to the modern nested-entrypoint shape.
  if (!nonAngular) {
    normalizeRootNgPackage(tree, projectRoot);
  }

  // 5) Linking model: workspace:* sibling deps on the lib's own package.json + the root
  //    tsconfig references entry.
  if (options.workspaceDeps?.length) {
    addWorkspaceDeps(tree, projectRoot, options.workspaceDeps);
  }
  addRootTsConfigReference(tree, projectRoot);

  if (!skipFormat) {
    await formatFiles(tree);
  }

  // 6) Re-link the workspace after generation. `true` runs the install always (not just on a
  //    package.json change) so the new `workspace:*` symlinks are created.
  return () => installPackagesTask(tree, true);
}

/**
 * Add the per-project `nx release` baseline to a project configuration (mutates in place):
 *   - `release.version` resolves the current version from the git tag, falling back to the
 *     on-disk package.json version when no tag exists yet (maiden release).
 *   - the `nx-release-publish` target publishes from the built `dist/<projectRoot>` output
 *     rather than the source tree.
 *
 * Deliberately does NOT set releaseTagPattern / projectsRelationship — those are root-level
 * (nx.json) concerns owned by Foundation. This writes ONLY the project-local resolver + packageRoot.
 */
function applyReleaseConfig(project: ProjectConfiguration, projectRoot: string): void {
  // ASSUMPTION (Nx 22/23 release shape): per-project `release.version.currentVersionResolver` +
  //   `fallbackCurrentVersionResolver` is the supported nested shape (the legacy flat
  //   `generatorOptions` / `useLegacyVersioning` keys were removed in v22). VERIFY by running
  //   `nx release version --dry-run` against a generated lib in Docker.
  const release = (project.release ?? {}) as Record<string, unknown>;
  release.version = {
    ...((release.version as Record<string, unknown>) ?? {}),
    currentVersionResolver: 'git-tag',
    fallbackCurrentVersionResolver: 'disk',
  };
  // `release` is not on the ProjectConfiguration type in some @nx/devkit versions; assign through
  // a loose record so this compiles under `declaration:false` whatever the installed typings say.
  (project as Record<string, unknown>).release = release;

  // ASSUMPTION: the publish target is named `nx-release-publish` and takes `options.packageRoot`.
  //   `dist/{projectRoot}` uses the Nx token so it resolves per-project at run time. VERIFY the
  //   token expands inside packageRoot (it does for executor options); if not, fall back to the
  //   literal `dist/<projectRoot>`.
  project.targets ??= {};
  const publish = project.targets['nx-release-publish'] ?? {};
  publish.options = {
    ...(publish.options ?? {}),
    packageRoot: 'dist/{projectRoot}',
  };
  project.targets['nx-release-publish'] = publish;
}

/**
 * Normalize the library's root ng-package.json to the house modern-entrypoint shape:
 *   { $schema, dest: <relative path to dist/<projectRoot>>, lib: { entryFile: 'src/index.ts' } }
 * and strip any `umdModuleIds` (banned by the entry-point standard).
 *
 * Defensive: reads the emitted file and mutates it (preserving any extra keys the base generator
 * added that we don't explicitly override), rather than assuming its exact contents. Logs and
 * returns if the base generator emitted no ng-package.json (shouldn't happen for a publishable
 * Angular lib, but we don't crash on it).
 */
function normalizeRootNgPackage(tree: Tree, projectRoot: string): void {
  const ngPackagePath = `${projectRoot}/ng-package.json`;
  if (!tree.exists(ngPackagePath)) {
    logger.warn(
      `[publishable-lib] Expected a root ng-package.json at ${ngPackagePath} but none was emitted — ` +
      `skipped normalization. Verify the @nx/angular publishable library output.`
    );
    return;
  }

  // dest is relative to the ng-package.json (which sits at <projectRoot>) and points at
  // dist/<projectRoot>. From `packages/<name>` to `dist/packages/<name>` that is `../../dist/...`:
  // one `..` per path segment in projectRoot, then `dist/<projectRoot>`.
  const upToRoot = projectRoot
    .split('/')
    .filter(Boolean)
    .map(() => '..')
    .join('/');
  const dest = `${upToRoot}/dist/${projectRoot}`;

  const ngPackage = readJson<Record<string, unknown>>(tree, ngPackagePath);
  ngPackage.$schema = '../../node_modules/ng-packagr/ng-package.schema.json';
  ngPackage.dest = dest;
  ngPackage.lib = {
    ...((ngPackage.lib as Record<string, unknown>) ?? {}),
    entryFile: 'src/index.ts',
  };
  // The entry-point standard bans umdModuleIds.
  delete (ngPackage.lib as Record<string, unknown>).umdModuleIds;
  delete ngPackage.umdModuleIds;

  writeJson(tree, ngPackagePath, ngPackage);
}

/**
 * Add each sibling package as a `"@bespunky/<dep>": "workspace:*"` dependency on the library's OWN
 * package.json (the workspaces linking model). Idempotent: never overwrites an existing entry.
 * Accepts short names (`rxjs`) — scoped names (`@bespunky/rxjs`) are also tolerated.
 */
function addWorkspaceDeps(tree: Tree, projectRoot: string, deps: string[]): void {
  const pkgPath = `${projectRoot}/package.json`;
  if (!tree.exists(pkgPath)) {
    logger.warn(
      `[publishable-lib] No package.json at ${pkgPath} — skipped adding workspaceDeps ` +
      `(${deps.join(', ')}). Verify the base generator emitted a lib package.json.`
    );
    return;
  }

  updateJson(tree, pkgPath, (json: Record<string, unknown>) => {
    const dependencies = { ...((json.dependencies as Record<string, string>) ?? {}) };
    for (const dep of deps) {
      const scoped = dep.startsWith(`${SCOPE}/`) ? dep : `${SCOPE}/${dep}`;
      dependencies[scoped] ??= 'workspace:*';
    }
    json.dependencies = dependencies;
    return json;
  });
}

/**
 * Add `{ "path": "./<projectRoot>" }` to the ROOT tsconfig.json `references[]` (NOT
 * tsconfig.base.json — base holds compilerOptions only). Creates the array if missing; idempotent
 * (won't duplicate an existing reference to the same path). Tolerates the `./`-prefixed or bare
 * form already present.
 */
function addRootTsConfigReference(tree: Tree, projectRoot: string): void {
  const rootTsConfigPath = 'tsconfig.json';
  if (!tree.exists(rootTsConfigPath)) {
    logger.warn(
      `[publishable-lib] No root tsconfig.json found — skipped adding a project reference for ` +
      `${projectRoot}. The workspaces+references linking model expects one at the workspace root.`
    );
    return;
  }

  const refPath = `./${projectRoot}`;
  updateJson(tree, rootTsConfigPath, (json: Record<string, unknown>) => {
    const references = Array.isArray(json.references)
      ? (json.references as Array<{ path?: string }>)
      : [];
    const normalize = (p?: string) => (p ?? '').replace(/^\.\//, '').replace(/\/$/, '');
    const already = references.some((ref) => normalize(ref?.path) === normalize(refPath));
    if (!already) {
      references.push({ path: refPath });
    }
    json.references = references;
    return json;
  });
}
