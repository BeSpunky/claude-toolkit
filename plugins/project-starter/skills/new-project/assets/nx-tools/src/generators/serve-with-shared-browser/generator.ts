// House generator: give a project a `serve-with-shared-browser` target.
//
// The per-app sibling of worktree-serve. It wires an nx:run-commands ORCHESTRATOR that runs the
// project's own `serve` in parallel with the shared co-driven browser navigating to it — one command,
// `nx run <project>:serve-with-shared-browser`, that brings up the dev server AND points the always-on
// shared browser (noVNC on :6080) at it, so a human and an agent watch the change in the same browser.
//
// Why per-app (not workspace-level): the target must exist on EVERY app — the scaffolder's first app
// and every later `nx g @bespunky/nx-tools:app` — so it is applied here, on the same code path as
// serve-options/worktree-serve, and re-asserted by `scaffold.sh --repair`. The workspace-level
// `shared-browser` generator owns the shared browser itself (the CLI, helpers, and its lifecycle
// project); THIS generator only wires the per-app serve orchestration that consumes it.
//
// Idempotent: re-running (e.g. `scaffold.sh --repair`) re-asserts the same target, so it is safe on a
// fresh project and on one that already has it.
import {
  type Tree,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
} from '@nx/devkit';

interface ServeWithSharedBrowserSchema {
  project: string;
}

export default async function serveWithSharedBrowserGenerator(
  tree: Tree,
  options: ServeWithSharedBrowserSchema
): Promise<void> {
  const project = readProjectConfiguration(tree, options.project);
  project.targets ??= {};

  project.targets['serve-with-shared-browser'] = {
    executor: 'nx:run-commands',
    continuous: true,
    options: {
      parallel: true,
      // The app dev-server port follows PORT_OFFSET (set by `<app>:serve-worktree --portOffset`), so an
      // isolated serve is navigated to on its shifted port; `${…:-0}` keeps a normal serve on the base
      // 4200. run-commands runs each command through a shell, so the `$((…))` arithmetic evaluates there
      // (same intentional shell-arithmetic as the firebase-emulators serve orchestrator).
      commands: [
        `nx run ${options.project}:serve`,
        'bash tools/shared-browser/shared-browser navigate --url=http://localhost:$((4200 + ${PORT_OFFSET:-0})) --wait',
      ],
    },
  };

  updateProjectConfiguration(tree, options.project, project);
  await formatFiles(tree);
}
