// `design-system` — the workspace's single source of visual truth.
//
// Detected by the `type:design-system` TAG, through the shared `findDesignSystem` util (tag, or a library
// named `design-system`) — one detection rule for the DS across the whole plugin. Requires `angular` FOR NOW:
// the tokens and the SASS API are framework-neutral, only `src/lib/*.ts` is Angular — phase 4 splits it into a
// neutral core plus a per-framework adapter.
import type { LayerDescriptor } from './descriptor';
import { findDesignSystem } from '../generators/_utils/design-system';

export const designSystem: LayerDescriptor = {
  id: 'design-system',
  title: 'Design system',
  requires: ['angular'],
  evidence: { tags: ['type:design-system'] },
  detect: (tree) => findDesignSystem(tree) !== null,
  ensurable: { scaffold: true, sync: false },
  ensureHint: '`nx g @bespunky/nx-tools:design-system --scope=<scope>`',
  brings: "the design-system config, STRUCTURE.md, and every app's sass/provider wiring",
  generators: {
    // Runs AFTER the app exists so it can open the sass channel on it. --scope is load-bearing: the
    // underlying publishable-lib defaults to the @bespunky npm scope, wrong for every consumer. Idempotent on
    // a sync — the token file is seeded, never overwritten.
    workspace: [
      {
        generator: 'design-system',
        args: (ctx) => [`--scope=${ctx.project}`, ...(ctx.ensured.has('design-system') ? ['--wireProviders'] : [])],
      },
    ],
  },
  docSections: ['design-system'],
};
