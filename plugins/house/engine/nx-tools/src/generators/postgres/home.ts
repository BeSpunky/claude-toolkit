// Which project is this layer's: the one that carries its tag. A path cannot say: a library named `postgres`, or a project of the
// repo's own that happens to live at `postgres/`, would read as the layer, and a plain upgrade would start wearing it.
import { type ProjectConfiguration, type Tree, getProjects } from '@nx/devkit';
import type { HouseProjectHome } from '../_utils/project-files';

export const POSTGRES_ROOT = 'postgres';
export const POSTGRES_TAG = 'type:postgres';

const projectsOf = (tree: Tree): [string, ProjectConfiguration][] => (tree.exists('nx.json') ? [...getProjects(tree)] : []);

/** The layer's project, or undefined: it has not been created here. */
export function postgresHome(tree: Tree): HouseProjectHome | undefined {
  const found = projectsOf(tree).find(([, project]) => project.tags?.includes(POSTGRES_TAG));
  if (!found) return undefined;
  const [name, { root }] = found;
  return { name, root, exists: true, canonical: { name: POSTGRES_ROOT, root: POSTGRES_ROOT } };
}

/** Throw when something that is not this layer's holds the name or the folder its project needs, saying how to free them. */
export function refuseForeignHolder(tree: Tree): void {
  const holder = projectsOf(tree).find(([name, { root }]) => name === POSTGRES_ROOT || root === POSTGRES_ROOT);
  const file = [`${POSTGRES_ROOT}/project.json`, `${POSTGRES_ROOT}/package.json`].find((path) => tree.exists(path));
  if (!holder && !file) return;
  const what = holder ? `project "${holder[0]}" at ${holder[1].root}/` : file;
  throw new Error(
    `[postgres] ${what} already holds what this layer's project needs: the name "${POSTGRES_ROOT}" and the folder ${POSTGRES_ROOT}/. Nothing was written.\n` +
      `  Rename or move it and run this again. If it is meant to be this layer's project, give it the tag ${POSTGRES_TAG} and run this again: the targets join it.`,
  );
}
