// Typed options for the `serve` executor (mirrors schema.json). Options not listed are forwarded to the app's
// primary process as `--<key>=<value>`.
export interface ServeExecutorSchema {
  /** Project (declared app) to serve. Defaults to the project this target is attached to. */
  project?: string;
  /** Which git worktree to serve. Omitted → the current tree; a value matches by branch|slug|path; empty in a TTY prompts. */
  worktree?: string;
  /** 'auto' | a non-negative integer | '0'. Nx coerces a numeric value to a number. */
  portOffset?: string | number;
  /** Declared process ids not to run. */
  skip?: string | string[];
  /** Historic alias: false → skip the `emulators` process. */
  emulators?: boolean;
  /** Bring up and navigate the shared co-driven browser. Default true. */
  sharedBrowser?: boolean;
  /** Run the declaration's install step when the tree needs it. Default true. */
  install?: boolean;
  /** Print the plan without serving. */
  dryRun?: boolean;
  /** Ignored (warned) — the port is the declaration's. */
  port?: number;
  /** Forwarded to the primary process (the Angular dev-server's options, typically). */
  buildTarget?: string;
  host?: string;
  proxyConfig?: string;
  ssl?: boolean;
  sslCert?: string;
  sslKey?: string;
  open?: boolean;
  liveReload?: boolean;
  hmr?: boolean;
  poll?: number;
}
