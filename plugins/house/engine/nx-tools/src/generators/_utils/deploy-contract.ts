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
// or a GLOB. A bare directory matches nothing beneath it, and nothing says so: write `supabase/migrations/**/*`.
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
import type { TargetConfiguration, TargetDependencyConfig } from '@nx/devkit';
import type { TargetContract } from './house-targets';

/** A task a deploy runs after: a target of this project, or one elsewhere (`{ projects, target }`). */
type DeployDependency = string | TargetDependencyConfig;

export interface DeploySpec {
  /** What ships it. Runs from the workspace root, through a shell; extra arguments are appended to it. */
  command: string;
  /** The project's own inputs (`default`, `^default`, a named input) — what covers the files inside its root. */
  inputs: readonly string[];
  /** Workspace-relative files or globs (never a bare directory, see the header) that change what ships. */
  watches: readonly string[];
  /** What must run first, every time: part of the contract. */
  requires?: readonly DeployDependency[];
  /** What should run first, unless the project says otherwise (a lint). */
  gates?: readonly DeployDependency[];
}

/**
 * `watches` as `{workspaceRoot}/…` inputs: what is inside the project's own root is dropped, because `default` covers
 * it and its own files already mark it affected. A project at the workspace root owns nothing by path this way, so
 * everything is kept.
 */
export function watchedInputs(projectRoot: string, watches: readonly string[]): string[] {
  const inside = (path: string) => projectRoot !== '.' && (path === projectRoot || path.startsWith(`${projectRoot}/`));
  return [...new Set(watches.map((path) => path.replace(/^\.\//, '')))]
    .filter((path) => !inside(path))
    .map((path) => `{workspaceRoot}/${path}`);
}

/**
 * The `deploy` target of a project at `projectRoot`, and the contract that holds it. Pass both to `ensureHouseProject`:
 * `contract: { deploy: contract }` and `targets: { deploy: target }`.
 */
export function deployTarget(
  projectRoot: string,
  spec: DeploySpec,
): { target: TargetConfiguration; contract: TargetContract[string] } {
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
