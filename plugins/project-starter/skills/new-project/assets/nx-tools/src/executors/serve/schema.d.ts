// Typed options for the `serve` executor (mirrors schema.json).
export interface ServeExecutorSchema {
  /** Project whose dev-server to run. Defaults to the project this target is attached to. */
  project?: string;
  /** Run the Firebase emulator suite alongside the app (no-op when the tree has no firebase.json). Default true. */
  emulators?: boolean;
  /** Bring up the shared co-driven browser and navigate it to the app. Default true. */
  sharedBrowser?: boolean;
  /**
   * The app build target the dev-server compiles. Set by serve's `development`/`production`
   * configurations (→ `<app>:build:<config>`) and forwarded to the `dev-server` leaf.
   */
  buildTarget?: string;
  /** Dev-server host, forwarded to the `dev-server` leaf. */
  host?: string;
  /** Proxy config path, forwarded to the `dev-server` leaf. */
  proxyConfig?: string;
  /** Serve over HTTPS (forwarded to the dev-server). */
  ssl?: boolean;
  /** SSL certificate path (forwarded to the dev-server). */
  sslCert?: string;
  /** SSL key path (forwarded to the dev-server). */
  sslKey?: string;
  /** Open the app in a browser on start (forwarded to the dev-server). */
  open?: boolean;
  /** Toggle live-reload (forwarded to the dev-server). */
  liveReload?: boolean;
  /** Toggle HMR (forwarded to the dev-server). */
  hmr?: boolean;
  /** File-watch poll interval in ms (forwarded to the dev-server). */
  poll?: number;
  /** Which git worktree to serve. Omitted → the current cwd's tree; a value matches by branch|slug|path; empty in a TTY prompts. */
  worktree?: string;
  /** Port isolation: 'auto' (main tree → 0; worktree → a stable, verified-free block), a pinned integer, or '0'/undefined for the base stack. Default 'auto'. Accepts a number too (the Nx CLI coerces `--portOffset=12000` to a number). */
  portOffset?: string | number;
  /** Run `yarn install` in the chosen worktree when it has no node_modules (worktrees start empty). Default true. */
  install?: boolean;
  /** Print the resolved tree, offset, ports, slug, layers, and URLs without serving. Default false. */
  dryRun?: boolean;
}
