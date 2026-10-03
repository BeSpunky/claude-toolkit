// Shared generator util: find the workspace's design system. (Which projects CONSUME it is no longer decided
// here: an app consumes it when its stack has a `styles` port — see src/adapters.)
//
// Used by the `design-system` generator (to wire every existing app) and by `design-system-styles`
// (which the `app` generator composes, so a LATER app is wired with no flag) — the same self-detecting
// idiom firebase-emulators uses with `tree.exists('firebase.json')`.
import { type Tree, getProjects } from '@nx/devkit';
import { projectRole } from '../../adapters/registry';

/**
 * The Nx tag that marks the design system. This — not a path, not a marker file — is the detection key.
 *
 * NOT a path convention (`packages/design-system`), because the DS's `directory` is an overridable
 * option and a path check would silently stop finding it the moment someone passes `--directory`.
 * NOT a marker file, because that invents a second source of truth to keep in sync with the tag.
 * The tag travels with the project through any rename or move, and the `design-system` generator
 * re-asserts it on every run.
 */
export const DESIGN_SYSTEM_TAG = 'type:design-system';

export interface DesignSystemProject {
  name: string;
  /** Workspace-relative project root, e.g. `packages/design-system`. */
  root: string;
}

/**
 * The workspace's design-system project, or `null` when there isn't one.
 *
 * `null` is a legitimate, expected answer — not an error: the scaffolder creates the first app BEFORE
 * the DS lib exists, and a project scaffolded by an older toolkit has no DS until it's synced. Every
 * caller must no-op cleanly on `null`.
 *
 * Falls back to a LIBRARY literally named `design-system` so a hand-made (or pre-tag) library is still
 * found and can be healed by an upgrade. The LIBRARY gate is load-bearing: without it, an `apps/design-system` (a docs/demo/storybook app — a very natural name) would be silently
 * hijacked — tagged, seeded with styles, and have its package.json rewritten — the moment anyone ran the
 * generator or an upgrade. It asks `projectRole`, not the declared `projectType`: a package.json-defined
 * project in a TS-solution workspace declares none, and would otherwise never be found by name at all.
 */
export function findDesignSystem(tree: Tree): DesignSystemProject | null {
  const projects = getProjects(tree);

  for (const [name, project] of projects) {
    if (project.tags?.includes(DESIGN_SYSTEM_TAG)) return { name, root: project.root };
  }

  const byName = projects.get('design-system');
  return byName && projectRole(tree, 'design-system') === 'library' ? { name: 'design-system', root: byName.root } : null;
}
