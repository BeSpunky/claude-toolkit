// House generator: give a project a `serve-worktree` target.
//
// The per-app sibling of serve-options. Wires the `@bespunky/nx-tools:serve-worktree`
// executor onto the project so a developer can serve an in-flight git worktree without
// merging it back — `yarn nx run <project>:serve-worktree` (arrow-key picker of every
// worktree, or `--worktree=<branch|path>` to skip the prompt).
//
// Why per-app (not a workspace-level one-off): the target must exist on EVERY app —
// the scaffolder's first app and every later `nx g @bespunky/nx-tools:app` — so it is
// applied here, on the same code path serve-options runs on, and can't drift as apps
// are added. It is deploy- and framework-agnostic: the executor delegates to whatever
// the project's own `serve` target is (a plain Angular dev-server, or the Firebase
// emulators + dev-server orchestrator), so this generator runs for ALL projects, not
// just Firebase ones.
//
// Idempotent: re-running (e.g. `scaffold.sh --repair`) re-asserts the same target, so
// it is safe on a fresh project and on one that already has it.
import {
  type Tree,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
} from '@nx/devkit';

interface WorktreeServeSchema {
  project: string;
  // The target the executor runs inside the chosen worktree. House default: `serve`.
  serveTarget?: string;
}

export default async function worktreeServeGenerator(
  tree: Tree,
  options: WorktreeServeSchema
): Promise<void> {
  const serveTarget = options.serveTarget ?? 'serve';

  const project = readProjectConfiguration(tree, options.project);
  project.targets ??= {};

  project.targets['serve-worktree'] = {
    executor: '@bespunky/nx-tools:serve-worktree',
    options: { serveTarget },
  };

  updateProjectConfiguration(tree, options.project, project);
  await formatFiles(tree);
}
