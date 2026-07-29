// MIGRATION 0.24.5 — move a design system that landed in `tools/` to where libraries actually live.
//
// HOW IT GOT THERE. `resolveLibsDir` infers the workspace's library directory by counting the top-level
// segment of every existing library project. On a fresh scaffold the only libraries in existence at
// design-system time were `tools/shared-browser` and `tools/worktree-domains` — both `projectType: library`,
// both written moments earlier by the same run — so the inference returned `tools`, and the workspace's
// publishable product library was created at `tools/design-system`. Fixed at 0.18.0 by excluding `tools`
// from the count; projects scaffolded at 0.10.0–0.14.x still have theirs there.
//
// WHY IT IS WORTH MOVING RATHER THAN JUST DOCUMENTING. Nothing is broken at build time — the generators find
// the design system by its `type:design-system` TAG, never by path, and go on maintaining it wherever it
// sits. The damage is orientation: `HOUSE.md` is the file whose entire job is telling a reader where things
// are, and an agent that reads it, looks in the documented directory and finds nothing does not stop — it
// creates a SECOND design system there. Two sources of visual truth is the one outcome the design-system
// discipline exists to prevent. (`house-doc` now renders the real root as well, so the document is honest
// either way; this migration is what puts the library where the rest of the workspace expects it.)
//
// WHY THE MOVE IS NARROWER THAN IT SOUNDS. Consumers import the design system through the
// `tsconfig.base.json` PATH ALIAS the base library generator wrote — not through relative paths. So no
// source file changes: only the alias target, the project's own root, and the sass include path (which is
// the DS's PARENT directory) have to follow it. `ng-package.json`'s `styleIncludePaths` is `'..'`, relative,
// so it moves with the file and needs nothing.
//
// SELF-CONTAINED by the migration contract: the tag, the lookup and the libs-dir rule below are copies, not
// imports from ../../generators/**.
import {
  type Tree,
  getProjects,
  joinPathFragments,
  logger,
  moveFilesToNewDirectory,
  readProjectConfiguration,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';

const DESIGN_SYSTEM_TAG = 'type:design-system';
const TOOLS = 'tools';
/** Where libraries live when the workspace offers no evidence of its own. */
const DEFAULT_LIBS_DIR = 'packages';

export default function relocateDesignSystemOutOfTools(tree: Tree): void {
  const found = findDesignSystem(tree);
  if (!found) return;

  // Only the `tools/<name>` shape is the bug. A design system anywhere else is either already right or was
  // deliberately placed with `--directory`, and neither is ours to second-guess.
  const segments = found.root.split('/');
  if (segments.length !== 2 || segments[0] !== TOOLS) return;

  const target = joinPathFragments(resolveLibsDir(tree), segments[1]);
  if (target === found.root) return;

  // REFUSE RATHER THAN MERGE. Something already occupying the destination is either a second design system
  // somebody created by hand (exactly the confusion this repairs) or an unrelated library that happens to
  // share the name. Moving onto either one destroys work, and no automatic choice between them is defensible.
  if (tree.exists(target)) {
    logger.warn(
      `[migrate 0.24.5] \`${found.root}\` should live at \`${target}\`, but something is already there — ` +
        `nothing was moved. Merge or rename by hand, then re-run the sync.`
    );
    return;
  }

  const oldRoot = found.root;
  const oldParent = segments[0];
  const newParent = target.split('/')[0];

  moveFilesToNewDirectory(tree, oldRoot, target);

  // The project's own configuration. Read it BEFORE rewriting roots so the paths inside it are still the ones
  // getProjects knows about.
  const config = readProjectConfiguration(tree, found.name);
  config.root = target;
  if (config.sourceRoot?.startsWith(`${oldRoot}/`)) config.sourceRoot = config.sourceRoot.replace(oldRoot, target);
  updateProjectConfiguration(tree, found.name, config);

  // The tsconfig path alias is the in-repo import channel — the one thing that would break every consumer if
  // it were left pointing into a directory that no longer exists.
  retargetPathAliases(tree, oldRoot, target);

  // Sass reaches the design system through an include path that names its PARENT directory, so the move
  // changes it. Add the new one; drop the old only when it is exactly the directory we just moved out of,
  // and only when nothing else the include path was serving is left behind there.
  retargetSassIncludePaths(tree, oldParent, newParent);

  logger.info(
    `[migrate 0.24.5] Moved the design system from \`${oldRoot}\` to \`${target}\` — a pre-0.18.0 scaffold ` +
      `put it under \`${TOOLS}/\`, where the generated docs never expected to find it. Imports are unchanged ` +
      `(they resolve through the tsconfig path alias, which was retargeted with it).`
  );
}

/** The design system, by tag first and by the conventional name second — the same order the generators use. */
function findDesignSystem(tree: Tree): { name: string; root: string } | null {
  const projects = getProjects(tree);
  for (const [name, project] of projects) {
    if (project.tags?.includes(DESIGN_SYSTEM_TAG)) return { name, root: project.root };
  }
  const byName = projects.get('design-system');
  return byName && byName.projectType === 'library' ? { name: 'design-system', root: byName.root } : null;
}

/**
 * Where this workspace keeps libraries, decided by majority of what is already there — with `tools` excluded,
 * because `tools/` is Nx's home for workspace TOOLING and counting it is the bug this migration repairs.
 */
function resolveLibsDir(tree: Tree): string {
  const counts = new Map<string, number>();
  for (const [, project] of getProjects(tree)) {
    if (project.projectType !== 'library') continue;
    const top = project.root.split('/')[0];
    if (top && top !== TOOLS) counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  let best = DEFAULT_LIBS_DIR;
  let bestCount = 0;
  for (const [dir, count] of counts) {
    if (count > bestCount) {
      best = dir;
      bestCount = count;
    }
  }
  return best;
}

/** Re-point every `tsconfig.base.json` path alias that referenced the old root. */
function retargetPathAliases(tree: Tree, oldRoot: string, newRoot: string): void {
  for (const file of ['tsconfig.base.json', 'tsconfig.json']) {
    if (!tree.exists(file)) continue;
    try {
      updateJson(tree, file, (json: Record<string, any>) => {
        const paths = json?.compilerOptions?.paths as Record<string, string[]> | undefined;
        if (!paths) return json;
        for (const [alias, targets] of Object.entries(paths)) {
          if (!Array.isArray(targets)) continue;
          paths[alias] = targets.map((t) => (t.startsWith(`${oldRoot}/`) || t === oldRoot ? t.replace(oldRoot, newRoot) : t));
        }
        return json;
      });
    } catch {
      // An unparseable tsconfig is not something a migration can repair, and replacing it would lose more
      // than it fixes. The move still happened; say so rather than failing the whole ladder.
      logger.warn(
        `[migrate 0.24.5] Could not update \`${file}\` — check its \`compilerOptions.paths\` for entries ` +
          `still pointing at \`${oldRoot}\`.`
      );
    }
  }
}

/** Swap the design system's parent directory in every app's sass include path. */
function retargetSassIncludePaths(tree: Tree, oldParent: string, newParent: string): void {
  for (const [name, project] of getProjects(tree)) {
    const options = (project.targets?.['build']?.options ?? {}) as Record<string, any>;
    const include = options?.stylePreprocessorOptions?.includePaths;
    if (!Array.isArray(include)) continue;

    const next = include.filter((p: string) => p !== oldParent);
    if (!next.includes(newParent)) next.push(newParent);
    if (next.length === include.length && next.every((p, i) => p === include[i])) continue;

    options.stylePreprocessorOptions.includePaths = next;
    updateProjectConfiguration(tree, name, project);
    logger.info(`[migrate 0.24.5] \`${name}\`: sass include path \`${oldParent}\` -> \`${newParent}\`.`);
  }
}
