// 0.35.0 — tag the navigation kernel's library `type:navigation`, so the `navigation` layer keeps finding it.
//
// WHAT CHANGED. The `navigation` layer was detected by a hard-coded project NAME (`navigation-core`). From 0.35.0
// it is detected by the `type:navigation` TAG — the idiom the design system already uses — because a name breaks
// on the first rename or a second kernel library, and the tag travels with the project. The `navigation-core`
// generator now creates a tagged library. Projects made before it carry no tag, so without this rung the layer
// would silently vanish from their stamp and HOUSE.md lose the typed-navigation conventions.
//
// WHAT IT TAGS — evidence, never a guess:
//   1. a project NAMED `navigation-core` (exactly what the old detector recognised);
//   2. the project that OWNS a directory carrying the vendored kernel (`<dir>/lib/navigation-x.providers.ts`,
//      the file the old generator always wrote) — the kernel under any project name.
// Tags are added in the project's own definition file (project.json, or package.json's `nx` block), merged —
// never replacing the project's other tags.
//
// WHAT IT REPORTS. The old generator wrote the kernel as LOOSE FILES (default `libs/navigation-core/src`) with no
// project at all. Nx cannot see such a folder, so there is nothing to tag, and inventing a project for it would be
// a guess about how the workspace builds it. Each such kernel is named in the log, with the fix.
//
// Walks with the shared `findAppRoots` (skips dot-directories — other worktrees — build output and nested repos).
import { type Tree, type ProjectConfiguration, getProjects, updateJson, logger } from '@nx/devkit';
import { findAppRoots } from '../../generators/_utils/app-roots';

const TAG = 'type:navigation';
const LEGACY_NAME = 'navigation-core';
const KERNEL_MARKER = 'lib/navigation-x.providers.ts';

export default async function tagNavigationLibrary(tree: Tree): Promise<void> {
  if (!tree.exists('nx.json')) return;
  let projects: Map<string, ProjectConfiguration>;
  try {
    projects = getProjects(tree);
  } catch {
    return;
  }

  const toTag = new Set<string>();
  if (projects.has(LEGACY_NAME)) toTag.add(LEGACY_NAME);

  for (const kernelDir of findAppRoots(tree, (dir) => tree.exists(`${dir}/${KERNEL_MARKER}`))) {
    const owner = owningProject(projects, kernelDir);
    if (owner) toTag.add(owner);
    else {
      logger.warn(
        `[0.35.0/tag-navigation-library] Found the navigation kernel at \`${kernelDir}\`, but no Nx project owns it ` +
          `(earlier toolkits wrote it as loose files), so the \`navigation\` layer cannot detect it. Give it a ` +
          `project tagged \`${TAG}\` — or move the code into a library created by \`nx g @bespunky/nx-tools:navigation-core\`.`,
      );
    }
  }

  for (const name of toTag) {
    const project = projects.get(name)!;
    if (project.tags?.includes(TAG)) continue;
    const file = tree.exists(`${project.root}/project.json`)
      ? `${project.root}/project.json`
      : tree.exists(`${project.root}/package.json`)
        ? `${project.root}/package.json`
        : null;
    if (!file) {
      logger.warn(`[0.35.0/tag-navigation-library] \`${name}\` has no project.json or package.json to tag — add \`${TAG}\` by hand.`);
      continue;
    }
    updateJson(tree, file, (json) => {
      const container = file.endsWith('package.json') ? (json.nx ??= {}) : json;
      container.tags = [...new Set([...(container.tags ?? []), TAG])];
      return json;
    });
    logger.info(`[0.35.0/tag-navigation-library] Tagged \`${name}\` (${file}) \`${TAG}\` — the navigation layer now detects it by tag.`);
  }
}

/** The project whose root is the longest prefix of `dir` (the workspace root `.` owns nothing by prefix). */
function owningProject(projects: Map<string, ProjectConfiguration>, dir: string): string | null {
  let best: { name: string; length: number } | null = null;
  for (const [name, project] of projects) {
    const root = project.root.replace(/\/+$/, '');
    const owns = root === '.' || root === '' ? false : dir === root || dir.startsWith(`${root}/`);
    if (owns && (!best || root.length > best.length)) best = { name, length: root.length };
  }
  return best?.name ?? null;
}
