// Evaluate a layer's declarative EVIDENCE exactly, on a Tree.
//
// The shell projection (cli.ts `shell`) evaluates the same evidence approximately, by grep, for the
// SessionStart hook. The two must mean the same thing — so each kind is implemented here once, and the
// projection maps each kind to one grep. Adding a kind means adding it in both places, and in descriptor.ts.
import { type Tree, type ProjectConfiguration, getProjects, readJson } from '@nx/devkit';
import type { LayerEvidence } from './descriptor';

export function matchesEvidence(tree: Tree, evidence: LayerEvidence): boolean {
  if (evidence.files?.some((path) => tree.exists(path))) return true;
  if (evidence.dependencies?.some((pkg) => hasDependency(tree, pkg))) return true;

  const needsProjects = evidence.targets || evidence.tags || evidence.projects || evidence.executors;
  if (!needsProjects) return false;

  for (const [name, project] of projectsOf(tree)) {
    if (evidence.projects?.includes(name)) return true;
    if (evidence.tags?.some((tag) => project.tags?.includes(tag))) return true;
    const targets = project.targets ?? {};
    if (evidence.targets?.some((target) => Boolean(targets[target]))) return true;
    if (
      evidence.executors?.some((prefix) =>
        Object.values(targets).some((target) => (target.executor ?? '').startsWith(prefix)),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Is `pkg` declared in the root package.json (either dependency block)? */
export function hasDependency(tree: Tree, pkg: string): boolean {
  if (!tree.exists('package.json')) return false;
  const json = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    tree,
    'package.json',
  );
  return Boolean(json.dependencies?.[pkg] ?? json.devDependencies?.[pkg]);
}

/** Does a project by this name exist? (False, not a throw, when there is no Nx workspace yet.) */
export function projectExists(tree: Tree, name: string): boolean {
  return projectsOf(tree).has(name);
}

/**
 * The workspace's projects — or none when there is no Nx workspace to ask. `getProjects` on a tree without
 * nx.json (the floor not yet laid) is not an error worth a stack trace; it simply has no projects.
 */
function projectsOf(tree: Tree): Map<string, ProjectConfiguration> {
  if (!tree.exists('nx.json')) return new Map();
  return getProjects(tree);
}
