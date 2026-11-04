// THE DEPLOY CONTRACT — what `nx affected -t deploy` (by hand, or the `ci` layer) relies on in every deployable house
// project, whatever it ships to. A target named exactly `deploy` that:
//   - is never cached: a cached deploy is a skipped deploy;
//   - never runs beside another task (`parallelism: false`): two deploys at once race one target;
//   - runs what it must first (`requires`): a deploy that does not build first ships yesterday's bundle;
//   - declares what it ships as inputs (`watches`), so `affected` sees a change to it.
//
// HOW `affected` SEES A FILE. A file inside the project's root marks the project affected anyway, and `default` covers
// its hash. A file OUTSIDE it marks the project affected only as a `{workspaceRoot}/…` input of one of its targets:
// Nx matches each changed file against that path with minimatch (`getImplicitlyTouchedProjects`), so the path is a FILE
// or a GLOB. A bare directory matches nothing beneath it, and nothing says so at run time, so it is refused here, when the
// target is declared, naming the glob to write.
// Never the deploy RUNNERS: a toolkit release that only rewrites them ships nothing new, so it must not mark a deploy
// affected.
//
// `requires` and `cache`/`parallelism` are the CONTRACT in the house-targets sense (./house-targets): re-asserted on
// every upgrade, and a project value that differed is reported. `gates` are quality checks the project may drop, so
// they are written once and merged like any other member of `dependsOn`.
//
// What this does not hold: whether a file is watched at DEPLOY time. A deploy whose shipping set is known when the
// generator runs (a schema folder) is fully stated here. One that reads it at run time (Firebase's rules, from
// firebase.json) needs its own check that the two have not drifted: firebase-deploy-rules.mjs.tpl.
import type { TargetConfiguration, TargetDependencyConfig, Tree } from '@nx/devkit';
import type { TargetContract } from './house-targets';

/** A task a deploy runs after: a target of this project, or one elsewhere (`{ projects, target }`). */
type DeployDependency = string | TargetDependencyConfig;

export interface DeploySpec {
  /** What ships it. Runs from the workspace root, through a shell; extra arguments are appended to it. */
  command: string;
  /** The project's own inputs (`default`, `^default`, a named input) — what covers the files inside its root. */
  inputs: readonly string[];
  /** Workspace-relative files or globs that change what ships. A bare directory is refused (see the header). */
  watches: readonly string[];
  /**
   * What must run first, every time: part of the contract. Never another project's `deploy`: the order between deploys
   * is the workflow's (`CiDeployProvider.deployStage`), and each stage holds only its own credentials.
   */
  requires?: readonly DeployDependency[];
  /** What should run first, unless the project says otherwise (a lint). */
  gates?: readonly DeployDependency[];
}

const stripDotSlash = (path: string) => path.replace(/^\.\//, '');

const isDirectoryPath = (tree: Tree, path: string) => path === '' || path === '.' || path.endsWith('/') || tree.exists(path);

/** Can this watched path match a file? For a path the project's own config names: a house declaration just goes to `deployTarget`, which refuses. */
export function canMatchAFile(tree: Tree, watched: string): boolean {
  const path = stripDotSlash(watched);
  if (/[*?[\]{}()!]/.test(path) || tree.isFile(path)) return true;
  return !isDirectoryPath(tree, path) && /\.[^/]*$/.test(path);
}

/**
 * Throw unless every watched path can match a file. A glob can. A path that is a file can, and so can one that will be,
 * if its name says file. A directory cannot, and neither can a missing path with no extension: it is a directory the
 * generator has not seeded yet, or a file the name cannot vouch for (seed that file first, and it passes as a file).
 */
function refuseBareDirectories(tree: Tree, projectRoot: string, watches: readonly string[]): void {
  for (const watched of watches) {
    if (canMatchAFile(tree, watched)) continue;
    const path = stripDotSlash(watched);
    const directory = isDirectoryPath(tree, path);
    const glob = `${path.replace(/\/$/, '') || '.'}/**/*`;
    throw new Error(
      `The deploy target of ${projectRoot} watches '${watched}', which ${directory ? 'is a directory' : 'does not exist and has no extension, so it reads as a directory'}. ` +
        `Nx matches a changed file against a watched path as a file or a glob, so nothing beneath a bare directory marks the deploy affected, and nothing would say so. ` +
        `Watch '${glob}' instead${directory ? '' : ' (or, if it is a file, seed it before declaring the deploy)'}.`,
    );
  }
}

/**
 * `watches` as `{workspaceRoot}/…` inputs: what is inside the project's own root is dropped, because `default` covers
 * it and its own files already mark it affected. A project at the workspace root owns nothing by path this way, so
 * everything is kept.
 */
export function watchedInputs(projectRoot: string, watches: readonly string[]): string[] {
  const inside = (path: string) => projectRoot !== '.' && (path === projectRoot || path.startsWith(`${projectRoot}/`));
  return [...new Set(watches.map(stripDotSlash))]
    .filter((path) => !inside(path))
    .map((path) => `{workspaceRoot}/${path}`);
}

/**
 * The `deploy` target of a project at `projectRoot`, and the contract that holds it. Pass both to `ensureHouseProject`:
 * `contract: { deploy: contract }` and `targets: { deploy: target }`.
 */
export function deployTarget(
  tree: Tree,
  projectRoot: string,
  spec: DeploySpec,
): { target: TargetConfiguration; contract: TargetContract[string] } {
  refuseBareDirectories(tree, projectRoot, spec.watches);
  const never = { cache: false, parallelism: false };
  const requires = [...(spec.requires ?? [])];
  const dependsOn = [...requires, ...(spec.gates ?? [])];
  return {
    target: {
      executor: 'nx:run-commands',
      ...(dependsOn.length ? { dependsOn } : {}),
      inputs: [...spec.inputs, ...watchedInputs(projectRoot, spec.watches)],
      ...never,
      options: { command: spec.command, cwd: '{workspaceRoot}' },
    },
    contract: { ...never, ...(requires.length ? { dependsOn: requires } : {}) },
  };
}
