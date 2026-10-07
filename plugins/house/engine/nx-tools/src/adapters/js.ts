// THE PLAIN-TS ADAPTER — TypeScript/JavaScript with no UI framework, through @nx/js.
//
// It is what `publishable-lib` delegates to when a library is not a framework library (it replaced the
// `--nonAngular` boolean, which made one generator do two things behind a flag). It has no app, env,
// providers or styles ports: a plain-TS library has no bootstrap to wire and no stylesheet to load, and a
// capability asking for one is told so (see `portOf`).
//
// BOTH LINKING MODELS ARE @nx/js's OWN. Its library generator already knows them (R1, docs/features/
// 2026-10-02-workspace-layouts): in a `paths` workspace it writes project.json + the root-tsconfig alias; in a
// TS-solution (`workspaces`) one it writes a package.json-defined project, the workspaces glob, the solution
// reference and `exports` — never a `paths` entry. So this adapter does not fight it; it tells @nx/js the one
// thing its PUBLIC entry point gets wrong (see `create`) and, under `workspaces`, has the linking port assert the
// library's identity afterwards — @nx/js keys the source condition by ITS naming rule and writes none when the
// workspace declares another, which would leave in-repo consumers reading a `dist` nobody has built.
import { type GeneratorCallback, type Tree, getProjects, readNxJson, readProjectConfiguration } from '@nx/devkit';
import type { StackAdapter } from './stack-adapter';
import { projectDefinitionFile, updateProjectConfigurationInPlace } from '../generators/_utils/project-files';
import { workspaceLinking } from '../generators/_utils/linking';
import { withPlatform, csvTags } from '../platform/platform';

const noop: GeneratorCallback = () => {};

/** The executors that make a project a plain-TS one (and the `js` layer's executor evidence). */
const JS_EXECUTORS = ['@nx/js:'];

export const js: StackAdapter = {
  id: 'js',
  layer: 'js',
  executors: JS_EXECUTORS,
  platform: 'shared',

  ownsProject(tree, project) {
    try {
      const config = readProjectConfiguration(tree, project);
      const executor = config.targets?.build?.executor;
      if (executor) return JS_EXECUTORS.some((prefix) => executor.startsWith(prefix));
      // No DECLARED build: in a TS-solution workspace @nx/js writes none — the `@nx/js/typescript` plugin infers
      // `build`/`typecheck` from the project's tsconfig.lib.json, and a Tree never sees inferred targets. That
      // plugin registered + a tsconfig.lib.json is @nx/js's own evidence that the project is its library. (An
      // Angular project declares its build explicitly, and is claimed by the Angular adapter first anyway.)
      return tree.exists(`${config.root}/tsconfig.lib.json`) && infersTypescript(tree);
    } catch {
      return false;
    }
  },

  libs: {
    async create(tree, options) {
      // `bundler: 'tsc'` + `publishable` is the publishable plain-TS shape; a workspace-internal library is
      // source only (`bundler: 'none'`) and consumed through the workspace's link (alias, or package `exports`).
      //
      // `useProjectJson` is passed explicitly because @nx/js's EXPORTED `libraryGenerator` pins it to `true`
      // (only its CLI entry derives it from the workspace) — which, in a TS-solution workspace, would fork it
      // into two conventions: a project.json beside the package.json every other package is defined by. So it is
      // asked the same question every house generator asks: how does THIS workspace define a project at that root?
      const { libraryGenerator } = await import('@nx/js');
      const callback =
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
          tags: withPlatform(csvTags(options.tags), options.platform).join(','),
          useProjectJson: projectDefinitionFile(tree, options.directory).kind === 'project.json',
        } as Parameters<typeof libraryGenerator>[1])) ?? noop;
      // Under `paths` @nx/js's own alias IS the link; under `workspaces` the port completes what @nx/js began
      // (idempotent where @nx/js already wrote it). Same rule as the Angular adapter's.
      const linking = workspaceLinking(tree);
      if (linking.kind !== 'paths') linking.link(tree, { importPath: options.importPath, libRoot: options.directory.replace(/\/+$/, '') });
      return callback;
    },

    /**
     * WHERE THE PACKAGE IS PUBLISHED FROM — @nx/js decides it by model, and records it only in one of them:
     *   - classic (`paths`): the build emits a complete package to `dist/<root>`, and @nx/js writes that as the
     *     `nx-release-publish` packageRoot itself;
     *   - TS-solution (`workspaces`): the library's OWN package.json is the artifact (its `exports` point into
     *     `./dist`, built in place), so the right root is the project root — the publish executor's default,
     *     which is why @nx/js records nothing.
     * That silence is made explicit here, so the house release baseline (publishable-lib), which defaults an
     * unrecorded packageRoot to `dist/{projectRoot}`, cannot mistake "the default" for "not decided".
     */
    normalizePackaging(tree, projectRoot) {
      const found = [...getProjects(tree)].find(([, project]) => project.root === projectRoot);
      if (!found) return;
      const [name, project] = found;
      const publish = project.targets?.['nx-release-publish'];
      if (publish?.options?.packageRoot) return;
      project.targets = { ...project.targets, 'nx-release-publish': { ...publish, options: { ...publish?.options, packageRoot: '{projectRoot}' } } };
      updateProjectConfigurationInPlace(tree, name, project);
    },
  },
};

/** Does nx.json register `@nx/js/typescript` — the plugin that infers a TS project's build and typecheck? */
function infersTypescript(tree: Tree): boolean {
  return (readNxJson(tree)?.plugins ?? []).some((plugin) => (typeof plugin === 'string' ? plugin : plugin.plugin) === '@nx/js/typescript');
}
