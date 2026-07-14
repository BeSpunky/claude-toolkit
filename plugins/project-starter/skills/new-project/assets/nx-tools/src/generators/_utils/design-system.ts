// Shared generator util: find the workspace's design system, and decide which projects consume it.
//
// Used by the `design-system` generator (to wire every existing app) and by `design-system-styles`
// (which the `app` generator composes, so a LATER app is wired with no flag) — the same self-detecting
// idiom firebase-emulators uses with `tree.exists('firebase.json')`.
import { type Tree, getProjects, readProjectConfiguration } from '@nx/devkit';

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
 * the DS lib exists, and a project scaffolded by an older toolkit has no DS until it's repaired. Every
 * caller must no-op cleanly on `null`.
 *
 * Falls back to a LIBRARY literally named `design-system` so a hand-made (or pre-tag) library is still
 * found and can be healed by a --repair. The `projectType === 'library'` gate is load-bearing: without
 * it, an `apps/design-system` (a docs/demo/storybook app — a very natural name) would be silently
 * hijacked — tagged, seeded with styles, and have its package.json rewritten — the moment anyone ran the
 * generator or a `--repair`.
 */
export function findDesignSystem(tree: Tree): DesignSystemProject | null {
  const projects = getProjects(tree);

  for (const [name, project] of projects) {
    if (project.tags?.includes(DESIGN_SYSTEM_TAG)) return { name, root: project.root };
  }

  const byName = projects.get('design-system');
  return byName && byName.projectType === 'library' ? { name: 'design-system', root: byName.root } : null;
}

/**
 * Is this project an Angular APPLICATION — i.e. something that should consume the design system's sass?
 *
 * Both halves of the test are load-bearing. `projectType === 'application'` alone is not enough: a
 * Firebase workspace's `apps/functions` is an application too, and it is a Node bundle with no
 * stylesheet, no `stylePreprocessorOptions`, and no business consuming a browser design system. So we
 * also require an Angular browser builder.
 */
export function isAngularApp(tree: Tree, projectName: string): boolean {
  const project = readProjectConfiguration(tree, projectName);
  if (project.projectType !== 'application') return false;

  const executor = project.targets?.build?.executor ?? '';
  return executor.startsWith('@angular/build:') || executor.startsWith('@angular-devkit/build-angular:');
}
