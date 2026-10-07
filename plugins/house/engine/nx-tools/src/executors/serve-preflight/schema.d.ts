// Typed options for the `serve-preflight` executor (mirrors schema.json). Every other option `nx serve` forwards is ignored.
export interface ServePreflightSchema {
  project?: string;
  portOffset?: string | number;
  worktree?: string;
}
