// `design-system` — the workspace's single source of visual truth.
//
// A CAPABILITY on the Nx floor (phase 4). The id stays `design-system` — not `design-tokens` — for continuity:
// it is stamped in every existing project's HOUSE.md, keys its migrations and doc sections, and the thing a
// project wears is still "a design system", whatever binds it. What changed is what it REQUIRES: the core —
// tokens as CSS custom properties + the SASS API — is framework-neutral, so it needs only `nx`. The framework
// half (Angular: a publishable ng-packagr library, DsTheme/provideDesignSystem, `ds-component`) comes from the
// workspace's stack adapter when it has a `designSystem` port, and a workspace without one gets the core with a
// plain-DOM `setMode()` runtime. Each app attaches through ITS stack's `styles` port.
//
// Detected by the `type:design-system` TAG, through the shared `findDesignSystem` util (tag, or a library named
// `design-system`) — one detection rule for the DS across the whole plugin.
import type { LayerDescriptor } from './descriptor';
import { projectExists } from './evidence';
import { findDesignSystem } from '../generators/_utils/design-system';

export const designSystem: LayerDescriptor = {
  id: 'design-system',
  title: 'Design system',
  requires: ['nx'],
  evidence: { tags: ['type:design-system'] },
  detect: (tree) => findDesignSystem(tree) !== null,
  ensurable: { new: true, upgrade: false },
  ensureHint: '`nx g @bespunky/nx-tools:design-system --scope=<scope>`',
  brings: "the design-system config, STRUCTURE.md, and every app's sass/provider wiring",
  generators: {
    // What an app gets from the design system: its sass channel and the binding's provider. The `app` generator
    // runs this for a new app; on a sync the workspace step below already covers every app, so this is a no-op
    // re-assertion there.
    app: [
      {
        generator: 'design-system-styles',
        args: (ctx) => [`--project=${ctx.app}`, ...(ctx.ensured.has('design-system') ? ['--wireProviders'] : [])],
        skip: (ctx) => (projectExists(ctx.tree, ctx.app) ? null : { reason: `design-system: no project named '${ctx.app}' — every app is still wired by the workspace step.`, partial: false }),
      },
    ],
    // Runs AFTER the app exists so it can open the sass channel on it. --scope is load-bearing: the npm scope of
    // the DS's import path. Idempotent on a sync — the token file is seeded, never overwritten.
    workspace: [
      {
        generator: 'design-system',
        args: (ctx) => [`--scope=${ctx.project}`, ...(ctx.ensured.has('design-system') ? ['--wireProviders'] : [])],
      },
    ],
  },
  docSections: ['design-system', 'ui'],
  claudePlugins: ['bespunky-design-system@claude-toolkit'],
};
