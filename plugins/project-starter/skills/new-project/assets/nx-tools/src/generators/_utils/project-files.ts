// WHICH FILE DEFINES A PROJECT — and how a new one is created — in a workspace that may define projects either way.
//
// Nx reads a project from `project.json` where one exists, else from a `package.json` (its `nx` block plus what
// it infers). Integrated (`paths`-linked) workspaces use the first; TS-solution (`workspaces`-linked) workspaces
// the second — there a project IS a package. Generators that wrote `<root>/project.json` by hand, or created
// projects through `addProjectConfiguration` (which always writes project.json), silently forked a TS-solution
// workspace into two conventions. The answer now lives here, once:
//
//   - devkit's `readProjectConfiguration` / `updateProjectConfiguration` already work on both kinds (update
//     merges into the package.json `nx` block) — prefer them to touching either file;
//   - when a generator genuinely needs the FILE (to edit it with comments preserved, to report it, to know
//     whether a write lands in an `nx` block), `projectDefinitionFile` names it;
//   - `createProject` creates a project the way this workspace defines them.
import { type Tree, type ProjectConfiguration, addProjectConfiguration, getProjects, updateProjectConfiguration, writeJson } from '@nx/devkit';
import { detectLinking, ensureWorkspaceMember } from './linking';

export type ProjectFileKind = 'project.json' | 'package.json';

export interface ProjectFile {
  /** Workspace-relative path of the file. */
  path: string;
  kind: ProjectFileKind;
}

/**
 * The file that defines (or, for a root with neither yet, WOULD define) the project at `root`. Nx's precedence:
 * `project.json` wherever it exists, else `package.json`. A root with neither gets the file this workspace's
 * convention would create there (`createProject`).
 */
export function projectDefinitionFile(tree: Tree, root: string): ProjectFile {
  const at = (file: ProjectFileKind): ProjectFile => ({ path: root === '.' ? file : `${root}/${file}`, kind: file });
  if (tree.exists(at('project.json').path)) return at('project.json');
  if (tree.exists(at('package.json').path)) return at('package.json');
  return at(detectLinking(tree) === 'workspaces' ? 'package.json' : 'project.json');
}

/**
 * Create project `name` the way this workspace defines projects:
 *   - `paths` linking — `addProjectConfiguration` (a project.json), exactly as before;
 *   - `workspaces` linking — a package.json: made a workspace member first (Nx's devkit only discovers a
 *     package.json project a workspaces glob covers), then written with `manifest` as its seed, and the
 *     configuration merged into its `nx` block through devkit (which drops what Nx would infer anyway).
 *
 * `manifest` seeds a package.json this call CREATES (never rewrites one that exists); its `name` defaults to the
 * project name. It is ignored under `paths` — a library that ships a package.json there writes its own.
 * Throws, like `addProjectConfiguration`, when the project already exists.
 */
export function createProject(
  tree: Tree,
  name: string,
  config: Omit<ProjectConfiguration, 'name'>,
  manifest: Record<string, unknown> = {},
): void {
  if (detectLinking(tree) !== 'workspaces') {
    addProjectConfiguration(tree, name, config);
    return;
  }
  const existing = [...getProjects(tree)].find(([other, project]) => other === name || project.root === config.root);
  if (existing) throw new Error(`Cannot create project "${name}" at ${config.root}: project "${existing[0]}" already exists at ${existing[1].root}.`);
  const file = projectDefinitionFile(tree, config.root);
  ensureWorkspaceMember(tree, config.root);
  if (!tree.exists(file.path)) writeJson(tree, file.path, { name, ...manifest });
  updateProjectConfiguration(tree, name, { ...config, name });
}
