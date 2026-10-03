// Option types for the `secondary-entrypoint` generator.
// Kept as a hand-written declaration (mirroring the donor's `./schema` import) so the
// generator's options are typed without re-deriving them from schema.json at build time.
export interface SecondaryEntrypointGeneratorSchema {
  /** The secondary entry-point name (the subpath), e.g. `testing` or `router-x`. */
  name: string;
  /** The parent library project this entry-point is added to. */
  library: string;
  /**
   * Whether to scaffold a component inside the new entry-point.
   *   'standalone' — generate a standalone component and re-export it from src/index.ts.
   *   'none'       — leave src/index.ts empty (the consumer fills it). Default.
   * (No 'scam' — the suite is standalone-only.)
   */
  component?: 'standalone' | 'none';
  /** Skip running Prettier over the touched files. */
  skipFormat?: boolean;
}
