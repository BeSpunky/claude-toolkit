// WHICH FILE DEFINES A PROJECT — and how a new one is created — in a workspace that may define projects either way.
//
// Nx reads a project from `project.json` where one exists, else from a `package.json` (its `nx` block plus what
// it infers). Integrated (`paths`-linked) workspaces use the first; TS-solution (`workspaces`-linked) workspaces
// the second — there a project IS a package. Generators that wrote `<root>/project.json` by hand, or created
// projects through `addProjectConfiguration` (which always writes project.json), silently forked a TS-solution
// workspace into two conventions. The answer now lives here, once:
//
//   - devkit's `readProjectConfiguration` reads both kinds; to CHANGE an existing project, prefer
//     `updateProjectConfigInPlace` (below) to devkit's `updateProjectConfiguration`, which re-serializes the whole
//     file and rebuilds the object (an upgrade that reorders keys is a diff nobody asked for);
//   - when a generator genuinely needs the FILE (to edit it with comments preserved, to report it, to know
//     whether a write lands in an `nx` block), `projectDefinitionFile` names it;
//   - `createProject` creates a project the way this workspace defines them;
//   - `houseProjectHome` / `ensureHouseProject` find and keep the projects a house generator OWNS (below).
import { type Tree, type ProjectConfiguration, addProjectConfiguration, getProjects, updateProjectConfiguration, writeJson, logger } from '@nx/devkit';
import { detectLinking, ensureWorkspaceMember, referenceFromSolution } from './linking';
import { workspacePath } from './linking/shared';
import { resolveWorkspaceScope } from './workspace-layout';
import { describeOverride, mergeHouseTargets, recordHouseTargets, recordedHouseTargets } from './house-targets';
import { updateJsonInPlace } from './json-edits';

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
 * Change the configuration of the project at `root` IN PLACE: `update` edits a copy, and only the members that
 * differ are written (./json-edits.ts) — in project.json, or in package.json's `nx` block. Returns whether it wrote.
 */
export function updateProjectConfigInPlace(tree: Tree, root: string, update: (config: ProjectConfiguration) => void): boolean {
  const file = projectDefinitionFile(tree, root);
  return updateJsonInPlace<ProjectConfiguration>(tree, file.path, update, file.kind === 'package.json' ? ['nx'] : []);
}

/**
 * Create project `name` the way this workspace defines projects:
 *   - `paths` linking — `addProjectConfiguration` (a project.json), exactly as before;
 *   - `workspaces` linking — a PACKAGE, with everything that makes one a member of a TS-solution workspace:
 *       membership   a workspaces glob covers it (Nx's devkit only discovers a package.json project a glob covers,
 *                    and the package manager only links members);
 *       identity     its package.json, seeded from `manifest`, is named under the workspace's npm scope
 *                    (`@acme/<name>`) unless the manifest names it — a member called `firebase` would shadow the
 *                    Firebase SDK in node_modules, and any bare name can shadow a registry package the same way.
 *                    Its Nx name stays `name`, kept in the `nx` block;
 *       reference    the solution tsconfig.json references it when it has a tsconfig.json — what
 *                    `@nx/js:typescript-sync` would add, so `nx sync --check` passes in CI. Write the project's
 *                    tsconfig BEFORE creating it, or reference it yourself (`referenceFromSolution`).
 *     The configuration is merged into the `nx` block through devkit (which drops what Nx would infer anyway).
 *
 * `manifest` seeds a package.json this call CREATES (never rewrites one that exists). It is ignored under `paths`
 * — a library that ships a package.json there writes its own. Throws, like `addProjectConfiguration`, when the
 * project already exists.
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
  if (!tree.exists(file.path)) writeJson(tree, file.path, { name: `@${resolveWorkspaceScope(tree)}/${name}`, ...manifest });
  updateProjectConfiguration(tree, name, { ...config, name });
  if (tree.exists(`${config.root}/tsconfig.json`)) referenceFromSolution(tree, config.root);
}

/**
 * A project some OTHER generator just created (a framework's application generator, say) joins this workspace
 * on the workspace's terms: under `workspaces` linking, a project that ships a package.json must be a workspace
 * member — or devkit cannot see it as a package.json project and the package manager never links it (an app
 * created in `apps/` of a workspace whose globs say `packages/*` is exactly that). A project.json-only island
 * needs no membership; under `paths` nothing applies. Returns the glob it added, if any.
 */
export function joinWorkspace(tree: Tree, root: string): string | null {
  const at = workspacePath(root);
  if (detectLinking(tree) !== 'workspaces' || !tree.exists(`${at}/package.json`)) return null;
  return ensureWorkspaceMember(tree, at);
}

// HOUSE PROJECTS — the Nx projects a house generator creates and then keeps: Cloud Functions, the emulator suite,
// the workspace tooling (shared-browser, worktree-domains). Three questions, answered once for all of them:
//
//   WHERE IS IT?   By the project, not by a path. `tree.exists('<dir>/project.json')` answers "is the canonical
//                  file free?" — a different question from "does this project exist?", and answering the second
//                  with the first is how a workspace gets two projects under one name, which makes EVERY `nx`
//                  command fail with "defined in multiple locations". So: the project already at the canonical
//                  root (whatever it is called), else one already carrying the name (wherever it sits), else
//                  none yet. The 0.24.1 migration resolves the emulator home the same way, so a sync never undoes
//                  what a migration just decided.
//   HOW IS IT MADE? The way THIS workspace defines projects (`createProject`): a project.json where projects are
//                  linked by `paths`, a package.json workspace member where they are `workspaces`-linked. Writing
//                  `<root>/project.json` by hand forked a TS-solution workspace into two conventions.
//   WHAT IS OURS?  The house's targets and tags — re-asserted on every run, into whichever file defines the
//                  project (`projectDefinitionFile`). Re-asserted by a THREE-WAY MERGE against a record of what the
//                  house last wrote (_utils/house-targets.ts): the project's own targets, and its own edits and
//                  additions INSIDE a house target (an input, an option, a configuration), survive an upgrade unless
//                  the house changed the same key — and then the upgrade says what it replaced. Removing a target
//                  the house no longer ships is a migration's job, never a generator's (project state).
//
// A house project created as a PACKAGE is named under the workspace's npm scope (`@acme/firebase`) while its Nx
// name stays the bare one — `createProject`'s rule, which every creator gets.

/** Where a house project lives — or, when `exists` is false, where it is about to be created. */
export interface HouseProjectHome {
  /** Its Nx project name. */
  name: string;
  /** Its workspace-relative root. */
  root: string;
  exists: boolean;
  /** What the house would have called it and where it would have put it — differs from the above when found elsewhere. */
  canonical: { name: string; root: string };
}

/** What the house owns in a house project: its targets and tags (plus what a NEW project is created with). */
export type HouseProjectConfig = Omit<ProjectConfiguration, 'name' | 'root'> & { tags: string[] };

/**
 * Where house project `name` lives (see WHERE IS IT? above) — a pure LOOKUP: it reads, never writes, and says
 * nothing, so a caller that only needs to describe the project (house-doc) can ask too. Saying where the house's
 * targets are going is the writer's business (`ensureHouseProject`). `getProjects` throws on a workspace it cannot
 * read; that must not take a generator down, so an unreadable graph degrades to "whatever defines the canonical
 * root".
 */
export function houseProjectHome(tree: Tree, name: string, canonicalRoot: string): HouseProjectHome {
  const canonical = { name, root: canonicalRoot };
  let projects: Map<string, ProjectConfiguration>;
  try {
    projects = getProjects(tree);
  } catch {
    return { name, root: canonicalRoot, exists: tree.exists(projectDefinitionFile(tree, canonicalRoot).path), canonical };
  }
  const atRoot = [...projects].find(([, project]) => project.root === canonicalRoot);
  const named = projects.get(name);
  const [foundName, found] = atRoot ?? (named ? [name, named] : [undefined, undefined]);
  if (!foundName || !found) return { name, root: canonicalRoot, exists: false, canonical };
  return { name: foundName, root: found.root, exists: true, canonical };
}

/**
 * Create the house project at `home`, or re-assert the house's targets and tags on the one that exists (see WHAT
 * IS OURS? above). `manifest` seeds the package.json of a project CREATED as a package (ignored otherwise); its
 * package name is always `createProject`'s scoped one, and it is `private` unless the manifest says otherwise.
 * When the project was found somewhere other than the house's canonical home, the targets follow it — and that is
 * said once, here, by the one call that writes them.
 *
 * @param who the generator writing — for that one line.
 */
export function ensureHouseProject(
  tree: Tree,
  who: string,
  home: HouseProjectHome,
  owned: HouseProjectConfig,
  manifest: Record<string, unknown> = {},
): void {
  const ownedTargets = owned.targets ?? {};
  if (!home.exists) {
    // The package's name is never the seed's: a house project is always named the way `createProject` scopes
    // one (a template manifest's bare `"name": "functions"` is exactly the shadowing that rule prevents).
    const { name: _seedName, ...seed } = manifest;
    createProject(tree, home.name, { root: home.root, ...owned }, { private: true, ...seed });
    recordHouseTargets(tree, home.name, ownedTargets);
    return;
  }
  if (home.root !== home.canonical.root || home.name !== home.canonical.name) {
    logger.info(
      `[${who}] The house's "${home.canonical.name}" project is "${home.name}" at ${home.root}, so its house targets go ` +
        `there instead of into a new project at ${home.canonical.root} — two projects under one name break every \`nx\` command.`,
    );
  }
  const recorded = recordedHouseTargets(tree, home.name);
  // In place: only what the merge changed is written — the project's formatting and key order stay.
  updateProjectConfigInPlace(tree, home.root, (config) => {
    config.tags = [...new Set([...(config.tags ?? []), ...owned.tags])];
    const { targets, overrides } = mergeHouseTargets(config.targets, ownedTargets, recorded);
    config.targets = targets;
    for (const override of overrides) logger.warn(`[${who}] ${describeOverride(home.name, override)}`);
  });
  recordHouseTargets(tree, home.name, ownedTargets);
}
