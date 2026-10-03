// Option types for the `wiki-summary` generator.
// Kept as a hand-written declaration (mirroring the house style of the sibling generators) so the
// generator's options are typed without re-deriving them from schema.json at build time.
export interface WikiSummaryGeneratorSchema {
  /**
   * Workspace-relative path to the wiki folder to summarise.
   * House shape: `packages/<lib>/wiki` (co-located with the library).
   * `summary.json` is (re)written at `<wikiFolder>/summary.json`.
   */
  wikiFolder: string;
  /** Skip running formatFiles at the end. Default false. */
  skipFormat?: boolean;
}
