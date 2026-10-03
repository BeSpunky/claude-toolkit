// House generator: DECLARE where this workspace keeps its projects — the scaffold's half of the layout model.
//
// A workspace's layout (`WorkspaceLayout { appsDir, libsDir }`) is otherwise DETECTED (`resolveWorkspaceLayout`:
// nx.json → existing projects → the house default). An empty workspace has no projects to infer from, so a
// scaffold that was ASKED for a layout (`house.sh --layout=<id>`) must record the choice before the first
// project exists, or the first generator to ask would infer the default instead. It records it in Nx's own field,
// nx.json `workspaceLayout`, so Nx's generators land projects in the same place ours do.
//
// Scaffold-only by design: a sync never chooses a layout (it detects one), which is why this is not a layer step
// the planner emits. Running it on an existing workspace is the user's explicit decision to re-declare its layout;
// it moves nothing that already exists.
import type { Tree } from '@nx/devkit';
import { LAYOUTS, writeWorkspaceLayout, type LayoutId } from '../_utils/workspace-layout';

interface WorkspaceLayoutSchema {
  /** A key of LAYOUTS. */
  layout: string;
}

export default async function workspaceLayoutGenerator(tree: Tree, options: WorkspaceLayoutSchema): Promise<void> {
  if (!isLayoutId(options.layout)) {
    throw new Error(`Unknown workspace layout "${options.layout}". Known layouts: ${Object.keys(LAYOUTS).join(', ')}.`);
  }
  writeWorkspaceLayout(tree, LAYOUTS[options.layout]);
}

function isLayoutId(id: string): id is LayoutId {
  return Object.prototype.hasOwnProperty.call(LAYOUTS, id);
}
