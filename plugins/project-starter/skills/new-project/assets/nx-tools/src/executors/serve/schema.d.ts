// Typed options for the `serve` executor (mirrors schema.json).
export interface ServeExecutorSchema {
  /** Project whose dev-server to run. Defaults to the project this target is attached to. */
  project?: string;
  /** Run the Firebase emulator suite alongside the app (no-op when the tree has no firebase.json). Default true. */
  emulators?: boolean;
  /** Bring up the shared co-driven browser and navigate it to the app. Default true. */
  sharedBrowser?: boolean;
  /** Dev-server build configuration, forwarded as `--configuration`. Default `development`. */
  configuration?: string;
  /** Which git worktree to serve. Omitted → the current cwd's tree; a value matches by branch|slug|path; empty in a TTY prompts. */
  worktree?: string;
  /** Port isolation: 'auto' (main tree → 0; worktree → a stable, verified-free block), a pinned integer, or '0'/undefined for the base stack. Default 'auto'. */
  portOffset?: string;
  /** Run `yarn install` in the chosen worktree when it has no node_modules (worktrees start empty). Default true. */
  install?: boolean;
  /** Print the resolved tree, offset, ports, slug, layers, and URLs without serving. Default false. */
  dryRun?: boolean;
}
