// Typed options for the serve-worktree executor (mirrors schema.json).
export interface ServeWorktreeExecutorSchema {
  /** Project whose serve target to run. Defaults to the attached project. */
  project?: string;
  /** The target to run inside the chosen worktree. Default `serve`. */
  serveTarget?: string;
  /** Pre-select a worktree by branch name or path, skipping the prompt. */
  worktree?: string;
  /** Run `yarn install` in the chosen worktree when it has no node_modules. Default true. */
  install?: boolean;
  /** Print the resolved worktree + command without installing or serving. Default false. */
  dryRun?: boolean;
}
