// 0.54.3 — a seeded Supabase `project_id` of `source` becomes the workspace's identity.
//
// WHY A RUNG. 0.54.2's generator named the project after the root package with its scope removed, and create-nx-workspace
// names that package `@<workspace>/source`, so every node-host project was called `source`. config.toml is seeded once and
// never rewritten, so the generator's fix cannot reach them. Only that exact value under that exact package name moves: any
// other id was chosen by someone. A stack's data is keyed by project root, branch and stack name, so nothing local is lost.
import { type Tree, logger } from '@nx/devkit';
import { workspaceIdentity } from '../../generators/_utils/workspace-identity';

const CONFIG = 'supabase/config.toml';
const SEEDED = /^project_id = "source"$/m;

export default async function projectIdFromIdentity(tree: Tree): Promise<void> {
  const text = tree.read(CONFIG, 'utf8');
  if (!text || !SEEDED.test(text) || !tree.exists('package.json')) return;
  let name: unknown;
  try {
    name = (JSON.parse(tree.read('package.json', 'utf8') ?? '{}') as { name?: unknown }).name;
  } catch {
    return;
  }
  if (typeof name !== 'string' || !/^@[^/]+\/source$/.test(name)) return;
  const id = workspaceIdentity(tree).replace(/[^\w.-]/g, '-');
  if (!id) return;
  tree.write(CONFIG, text.replace(SEEDED, `project_id = "${id}"`));
  logger.info(`[0.54.3 project-id-from-identity] ${CONFIG}: project_id "source" -> "${id}", the name this project goes by. Local data is not affected.`);
}
