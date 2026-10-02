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
//                  project (`projectDefinitionFile`); anything the project added itself is left alone. Removing a
//                  target the house no longer ships is a migration's job, never a generator's (project state).
//
// A house project created as a PACKAGE is named under the workspace's npm scope (`@acme/firebase`) while its Nx
// name stays the bare one (`firebase`, kept in the `nx` block): a workspace member named `firebase` would shadow
// the Firebase SDK itself in node_modules, and a bare tooling name can shadow any registry package the same way.
import { type Tree, type ProjectConfiguration, getProjects, updateJson, logger } from '@nx/devkit';
import { createProject, projectDefinitionFile } from './project-files';
import { resolveWorkspaceScope } from './workspace-layout';

/** Where a house project lives — or, when `exists` is false, where it is about to be created. */
export interface HouseProjectHome {
  /** Its Nx project name. */
  name: string;
  /** Its workspace-relative root. */
  root: string;
  exists: boolean;
}

/** What the house owns in a house project: its targets and tags (plus what a NEW project is created with). */
export type HouseProjectConfig = Omit<ProjectConfiguration, 'name' | 'root'> & { tags: string[] };

/**
 * Where house project `name` lives (see WHERE IS IT? above). `getProjects` throws on a workspace it cannot read;
 * that must not take a generator down, so an unreadable graph degrades to "whatever defines the canonical root".
 *
 * @param who the generator asking — for the one line said when the project is found somewhere unexpected.
 */
export function houseProjectHome(tree: Tree, name: string, canonicalRoot: string, who: string): HouseProjectHome {
  let projects: Map<string, ProjectConfiguration>;
  try {
    projects = getProjects(tree);
  } catch {
    return { name, root: canonicalRoot, exists: tree.exists(projectDefinitionFile(tree, canonicalRoot).path) };
  }
  const atRoot = [...projects].find(([, project]) => project.root === canonicalRoot);
  const named = projects.get(name);
  const [foundName, found] = atRoot ?? (named ? [name, named] : [undefined, undefined]);
  if (!foundName || !found) return { name, root: canonicalRoot, exists: false };
  if (found.root !== canonicalRoot || foundName !== name) {
    logger.info(
      `[${who}] The house's "${name}" project is "${foundName}" at ${found.root}, so its house targets go there ` +
        `instead of into a new project at ${canonicalRoot} — two projects under one name break every \`nx\` command.`,
    );
  }
  return { name: foundName, root: found.root, exists: true };
}

/**
 * Create the house project at `home`, or re-assert the house's targets and tags on the one that exists (see WHAT
 * IS OURS? above). `manifest` seeds the package.json of a project CREATED as a package (ignored otherwise); its
 * `name` is always the scoped one, and it is `private` unless the manifest says otherwise.
 */
export function ensureHouseProject(
  tree: Tree,
  home: HouseProjectHome,
  owned: HouseProjectConfig,
  manifest: Record<string, unknown> = {},
): void {
  if (!home.exists) {
    createProject(tree, home.name, { root: home.root, ...owned }, {
      private: true,
      ...manifest,
      name: `@${resolveWorkspaceScope(tree)}/${home.name}`,
    });
    return;
  }
  const file = projectDefinitionFile(tree, home.root);
  updateJson(tree, file.path, (json) => {
    // A package.json-defined project keeps its Nx configuration under `nx`; a project.json at the top level.
    const config = file.kind === 'package.json' ? (json.nx ??= {}) : json;
    config.tags = [...new Set([...(config.tags ?? []), ...owned.tags])];
    config.targets = { ...(config.targets ?? {}), ...owned.targets };
    return json;
  });
}
