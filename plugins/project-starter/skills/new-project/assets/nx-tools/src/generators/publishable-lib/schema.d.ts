// Typed options for the `publishable-lib` generator. Mirrors schema.json one-to-one.
// (The baseline generators inline their option interface; this generator factors it into a
//  `schema.d.ts` because the same shape is consumed by the delegated @nx generators and the
//  post-processing helpers — keeping a single named type avoids drift between them.)
export interface PublishableLibGeneratorSchema {
  /** Library name (also the @bespunky/<name> default and the packages/<name> default). */
  name: string;
  /** npm import path. Default `@bespunky/<name>`. */
  importPath?: string;
  /** Workspace-relative directory for the library. Default `packages/<name>`. */
  directory?: string;
  /** Component/selector prefix. Default `bs`. Ignored when `nonAngular`. */
  prefix?: string;
  /** Component style language. Default `scss`. Ignored when `nonAngular`. */
  style?: 'scss' | 'css' | 'none';
  /** Plain-TS library (delegates to @nx/js, bundler `tsc`, no ng-package.json). Default false. */
  nonAngular?: boolean;
  /** Comma-separated Nx tags applied to the library. */
  tags?: string;
  /**
   * Sibling @bespunky package names to declare as cross-lib deps on this lib's own package.json,
   * as real caret ranges (`"@bespunky/<dep>": "^<sibling version>"`). The published-consumer
   * contract only — in-repo resolution is the tsconfig.base.json path alias; never `workspace:*`.
   */
  workspaceDeps?: string[];
  /** Skip running formatFiles at the end. Default false. */
  skipFormat?: boolean;
}
