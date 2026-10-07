// House generator: create a house-standard PUBLISHABLE library.
//
// Delegate-then-post-process:
//   1. Delegate the library scaffold to a STACK ADAPTER's `libs` port (src/adapters) — the framework's own
//      generator, the library LINKED the way the workspace links (the port's promise; see LINKING below).
//      `--stack` names one (`angular`: @nx/angular:library, ng-packagr, standalone, Vitest; `js`:
//      @nx/js with bundler `tsc`, for plain-TS leaves); the default is the workspace's own most specific stack.
//      This REPLACED a `--nonAngular` boolean that made one generator do two things behind a flag — a third
//      stack would have been a second boolean. `--nonAngular` survives only as a deprecated alias of `--stack=js`.
//   2. The stack's packaging post-processing (Angular: the modern nested ng-package.json shape; plain TS: where
//      @nx/js publishes the package from, under the workspace's model).
//   3. Read the emitted project config BACK and add the per-PROJECT `nx release` baseline (git-tag resolver +
//      a packageRoot — the stack's, else `dist/<root>`). The ROOT release config lives in nx.json and is
//      Foundation's job — never touched here.
//   4. Declare the cross-lib deps (--workspaceDeps) on the lib's own package.json (see LINKING), and let the stack's packager allow them (Angular:
//      ng-package.json `allowedNonPeerDependencies`, or ng-packagr hard-fails the build).
//   5. Mark TEST-ONLY peers (vitest, …) `{ optional: true }` so consumers get no bogus unmet-peer warning.
//   6. Return an install callback.
//
// WHERE AND UNDER WHICH NAME — both derived from the workspace, never the toolkit's own conventions: the
// directory from where this workspace keeps libraries (its layout's libsDir — `libs/`, `packages/`, …), the npm scope
// from the workspace's own name (resolveWorkspaceScope). Defaulting to `packages/` and `@bespunky` made every
// consumer's library a BeSpunky package in a folder their repo doesn't use.
//
// LINKING — detected, never assumed (`_utils/linking`). The workspace wears one of two models, and this
// generator states only WHAT it needs; the port decides how:
//   - `paths` (the integrated model, and the house default): in-repo resolution is the root tsconfig's PATH
//     ALIAS, which the stack's generator writes. A cross-lib dep on the lib's package.json is then the
//     PUBLISHED-consumer contract only — a real caret range (`^<sibling's current version>`), maintained by
//     `nx release` (`updateDependents:auto`); a `workspace:*` there would mean nothing to anyone.
//   - `workspaces` (TS-solution): the package.json dependency IS the in-repo link — pnpm links nothing
//     undeclared, and with `link-workspace-packages` off (its default) a plain `^x.y.z` resolves from the
//     REGISTRY, i.e. the last published sibling, not the one beside it. So a sibling that lives in this
//     workspace is declared the way the package manager links one (`workspace:*` / `*` — the port's
//     `workspaceDependencySpec`), and the package manager rewrites that to the real version at publish.
// One rule serves both: every sibling found in the workspace is LINKED to this library as its consumer, and
// the caret range fills whatever the linking left undeclared. A sibling not in the workspace (yet) is a
// registry package under either model, and gets the caret range.
import {
  type Tree,
  type GeneratorCallback,
  type ProjectConfiguration,
  getProjects,
  readProjectConfiguration,
  readJson,
  installPackagesTask,
  formatFiles,
  logger,
} from '@nx/devkit';
import { updateProjectConfigurationInPlace } from '../_utils/project-files';
import { updateManifest } from '../_utils/dependencies';
import type { PublishableLibGeneratorSchema } from './schema';
import { requireLayer } from '../../layers/registry';
import { adapter, ADAPTERS } from '../../adapters/registry';
import { workspaceStackWith } from '../../adapters/workspace';
import { resolveLibsDir, resolveWorkspaceScope } from '../_utils/workspace-layout';
import { workspaceLinking } from '../_utils/linking';
import { type Platform, csvTags, platformOf } from '../../platform/platform';

// Test-only peers the base @nx generators declare as HARD peerDependencies (the chosen unitTestRunner pulls these
// in). A consumer of the published library never runs its tests, so each is marked `{ optional: true }`.
const TEST_ONLY_PEERS = ['vitest'];

export default async function publishableLibGenerator(
  tree: Tree,
  options: PublishableLibGeneratorSchema
): Promise<GeneratorCallback> {
  if (!options.name) {
    throw new Error('publishable-lib generator requires a library name (positional arg 0 / --name).');
  }

  // The stack: named, or the deprecated boolean's meaning, or the workspace's own.
  const stackId = options.stack ?? (options.nonAngular ? 'js' : undefined);
  if (options.nonAngular) logger.warn('[publishable-lib] --nonAngular is deprecated: pass --stack=js.');
  const stack = stackId ? adapter(stackId) : workspaceStackWith(tree, 'libs');
  if (!stack?.libs) {
    throw new Error(
      `[publishable-lib] ${stackId ? `The ${stackId} stack cannot create libraries` : 'No stack in this workspace can create libraries'} ` +
        `(stacks that can: ${ADAPTERS.filter((a) => a.libs).map((a) => a.id).join(', ')}). ` +
        `Add one — \`nx add @nx/js\` for plain TypeScript — and re-run.`,
    );
  }
  // The stack's layer is the precondition — stated as a sentence before the dynamic import of its plugin.
  requireLayer(tree, stack.layer, 'publishable-lib');

  const name       = options.name;
  const scope      = `@${resolveWorkspaceScope(tree)}`;
  const importPath = options.importPath ?? `${scope}/${name}`;
  const directory  = options.directory ?? `${resolveLibsDir(tree)}/${name}`;
  const platform   = libraryPlatform(options, stack.platform);

  // 1) Delegate. skipFormat on the delegate; one formatFiles at the end over base output + our mutations.
  await stack.libs.create(tree, {
    name,
    directory,
    importPath,
    publishable: true,
    prefix: options.prefix ?? 'bs',
    style: options.style ?? 'scss',
    tags: options.tags,
    platform,
  });

  // 2) The stack's packaging shape — FIRST, because it may decide where the package is published from.
  const projectRoot = readProjectConfiguration(tree, name).root;
  stack.libs.normalizePackaging?.(tree, projectRoot);

  // 3) Read the project back and add the per-project release baseline.
  const project = readProjectConfiguration(tree, name);
  applyReleaseConfig(project, projectRoot);
  updateProjectConfigurationInPlace(tree, name, project);

  // 4) Cross-lib deps — linked in-repo the workspace's way, ranged for the published consumer.
  if (options.workspaceDeps?.length) {
    const declared = addWorkspaceDeps(tree, projectRoot, options.workspaceDeps, scope);
    if (declared.length) stack.libs.allowDependencies?.(tree, projectRoot, declared);
  }

  // 5) Test-only peers optional.
  markTestPeersOptional(tree, projectRoot);

  if (!options.skipFormat) {
    await formatFiles(tree);
  }

  // 6) Re-install (always — the new lib's runtime deps must resolve into node_modules).
  return () => installPackagesTask(tree, true);
}

/**
 * The library's ONE platform: `--platform`, else a `platform:` tag passed in `--tags`, else the stack's own. Both
 * given and different is a contradiction, refused rather than resolved by a precedence nobody would guess.
 */
function libraryPlatform(options: { platform?: Platform; tags?: string }, stackPlatform: Platform): Platform {
  const tagged = platformOf(csvTags(options.tags));
  if (options.platform && tagged && options.platform !== tagged) {
    throw new Error(`[publishable-lib] --platform=${options.platform} contradicts the platform:${tagged} tag in --tags. A library has one platform — pass one.`);
  }
  return options.platform ?? tagged ?? stackPlatform;
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
  project.release = {
    ...project.release,
    version: { ...project.release?.version, currentVersionResolver: 'git-tag', fallbackCurrentVersionResolver: 'disk' },
  };

  // ASSUMPTION: the publish target is named `nx-release-publish` and takes `options.packageRoot`.
  //   `dist/{projectRoot}` uses the Nx token so it resolves per-project at run time. VERIFY the
  //   token expands inside packageRoot (it does for executor options); if not, fall back to the
  //   literal `dist/<projectRoot>`.
  // A packageRoot the STACK recorded (step 2) is its knowledge of where its build puts the package, and wins;
  // `dist/{projectRoot}` is the default for a stack that records none (ng-packagr emits there).
  project.targets ??= {};
  const publish = project.targets['nx-release-publish'] ?? {};
  publish.options = {
    ...(publish.options ?? {}),
    packageRoot: publish.options?.packageRoot ?? 'dist/{projectRoot}',
  };
  project.targets['nx-release-publish'] = publish;
}

/**
 * Declare each sibling package as a cross-lib dependency on the library's OWN package.json. Short names are
 * expanded with the workspace's scope; a scoped name is taken as-is. A sibling found in the workspace BY ITS
 * PACKAGE NAME is linked to this library as its consumer first (under `workspaces` that declares the
 * `workspace:*` / `*` dependency; under `paths` the global alias already covers it); then any entry still
 * undeclared gets a REAL caret range of the sibling's current version, read from ITS package.json — never from
 * an assumed `packages/<name>` path. A sibling not found yet is declared against `^0.0.1`, with a warning.
 * Never overwrites an existing entry. Returns the scoped names.
 */
function addWorkspaceDeps(tree: Tree, projectRoot: string, deps: string[], scope: string): string[] {
  const pkgPath = `${projectRoot}/package.json`;
  if (!tree.exists(pkgPath)) {
    logger.warn(
      `[publishable-lib] No package.json at ${pkgPath} — skipped adding workspaceDeps ` +
      `(${deps.join(', ')}). Verify the base generator emitted a lib package.json.`
    );
    return [];
  }

  const linking = workspaceLinking(tree);
  const scopedNames = deps.map((dep) => (dep.startsWith('@') ? dep : `${scope}/${dep}`));
  const siblings = scopedNames.map((scoped) => ({ scoped, ...findSibling(tree, scoped) }));
  for (const { scoped, root } of siblings) {
    if (root && root !== projectRoot) linking.link(tree, { importPath: scoped, libRoot: root, consumerRoot: projectRoot });
  }
  updateManifest(tree, pkgPath, 'publishable-lib', (json: Record<string, unknown>) => {
    const dependencies = { ...((json.dependencies as Record<string, string>) ?? {}) };
    for (const { scoped, version } of siblings) dependencies[scoped] ??= `^${version}`;
    json.dependencies = dependencies;
    return json;
  });
  return scopedNames;
}

/**
 * A sibling's current version, from its own package.json — found by package name, then by project name — and,
 * when found by its PACKAGE NAME, its root: only then is it the package that specifier names, and so linkable.
 */
function findSibling(tree: Tree, scopedName: string): { version: string; root?: string } {
  const shortName = scopedName.split('/').pop() ?? scopedName;
  let fallback: string | undefined;
  for (const [projectName, config] of getProjects(tree)) {
    const pkgPath = `${config.root}/package.json`;
    if (!tree.exists(pkgPath)) continue;
    const pkg = readJson<{ name?: string; version?: string }>(tree, pkgPath);
    if (pkg.name === scopedName && pkg.version) return { version: pkg.version, root: config.root };
    if (projectName === shortName && pkg.version) fallback ??= pkg.version;
  }
  if (fallback) return { version: fallback };

  logger.warn(
    `[publishable-lib] Could not find a version for sibling "${scopedName}" in this workspace — ` +
    `declared the cross-lib dependency as "^0.0.1". Adjust the range once the sibling exists.`
  );
  return { version: '0.0.1' };
}

/**
 * Mark every TEST-ONLY peer (see `TEST_ONLY_PEERS`) the base generator declared as a hard
 * `peerDependency` as `{ optional: true }` in the lib's `peerDependenciesMeta` — the shape
 * `@bespunky/angular-zen` already uses. Without this, every consumer of the published library
 * gets a bogus unmet-peer warning for a test framework it never runs.
 *
 * Only marks peers that are ACTUALLY declared (so we never invent a meta entry for a runner the
 * lib doesn't use), and never clobbers an existing `peerDependenciesMeta` entry. No-ops cleanly
 * when the lib has no package.json or declares none of the test-only peers.
 */
function markTestPeersOptional(tree: Tree, projectRoot: string): void {
  const pkgPath = `${projectRoot}/package.json`;
  if (!tree.exists(pkgPath)) {
    logger.warn(
      `[publishable-lib] No package.json at ${pkgPath} — skipped marking test-only peers ` +
      `optional. Verify the base generator emitted a lib package.json.`
    );
    return;
  }

  updateManifest(tree, pkgPath, 'publishable-lib', (json: Record<string, unknown>) => {
    const peerDependencies = (json.peerDependencies as Record<string, string>) ?? {};
    const declaredTestPeers = TEST_ONLY_PEERS.filter((peer) => peer in peerDependencies);
    if (declaredTestPeers.length === 0) {
      return json;
    }

    const peerDependenciesMeta = {
      ...((json.peerDependenciesMeta as Record<string, { optional?: boolean }>) ?? {}),
    };
    for (const peer of declaredTestPeers) {
      peerDependenciesMeta[peer] = { ...peerDependenciesMeta[peer], optional: true };
    }
    json.peerDependenciesMeta = peerDependenciesMeta;
    return json;
  });
}
