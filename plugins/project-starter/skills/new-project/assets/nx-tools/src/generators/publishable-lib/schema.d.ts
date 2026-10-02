// Typed options for the `publishable-lib` generator. Mirrors schema.json one-to-one.
// (The baseline generators inline their option interface; this generator factors it into a
//  `schema.d.ts` because the same shape is consumed by the delegated @nx generators and the
//  post-processing helpers — keeping a single named type avoids drift between them.)
export interface PublishableLibGeneratorSchema {
  /** Library name (also seeds the `@<workspace-scope>/<name>` and `<libs-dir>/<name>` defaults). */
  name: string;
  /** npm import path. Default `@<workspace-scope>/<name>`. */
  importPath?: string;
  /** Workspace-relative directory for the library. Default `<detected libs dir>/<name>`. */
  directory?: string;
  /** The stack (adapter id) to create it with: `angular`, `js`. Default: the workspace's most specific. */
  stack?: string;
  /** Component/selector prefix. Default `bs`. Used by stacks with components. */
  prefix?: string;
  /** Component style language. Default `scss`. Used by stacks with components. */
  style?: 'scss' | 'css' | 'none';
  /** @deprecated Use `stack: 'js'`. */
  nonAngular?: boolean;
  /** Comma-separated Nx tags applied to the library. */
  tags?: string;
  /**
   * Sibling package names (short names take the workspace's scope) to declare as cross-lib deps on this lib's own package.json.
   * Linked the workspace's way: under `paths` linking a real caret range (`"<scope>/<dep>": "^<sibling version>"`, the
   * published-consumer contract — in-repo resolution is the path alias); under `workspaces` linking a sibling in the
   * workspace is declared the way the package manager links it (`workspace:*` / `*`), others by caret range.
   */
  workspaceDeps?: string[];
  /** Skip running formatFiles at the end. Default false. */
  skipFormat?: boolean;
}
