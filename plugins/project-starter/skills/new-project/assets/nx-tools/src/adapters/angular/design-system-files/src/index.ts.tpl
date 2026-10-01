// THE PUBLIC API of the design system's primary entry point (`{{importPath}}`).
//
// This file IS the contract. What it exports, the design system must support; everything under `lib/` is
// implementation, free to change. Adding a file does not publish it — publishing is a deliberate act,
// performed here. Keep this list short: what you export, you must support.
//
// Deliberately tiny. The design system's main surface is NOT TypeScript — it is the SASS layer
// (`{{importPath}}/styles`) and, as they are promoted, one COMPONENT per secondary entry point
// (`{{importPath}}/button`, `{{importPath}}/card`, …). What lives here is only the part of the theming
// mechanism that cannot be expressed in CSS: the thing that writes the mode attribute.
//
// Resist growing this. An icon registry, a breakpoint service, an overlay manager, component base
// classes — none of those are the design system. Each is its own concern with its own home.
export { provideDesignSystem } from './lib/design-system.providers';

// Mode: light / dark / follow-the-OS. The built-in axis, switchable instantly.
export { DsTheme, type DsMode } from './lib/ds-theme.service';

// Runtime theming: swap the app's theme after load. A theme is a CSS FILE (authored with
// `ds.theme-overrides()` and linked) — `use()` just repoints the <link>. `setTokens()` is the narrow
// exception, for values that don't exist until runtime (a colour picker).
export { DsRuntimeTheme, type DsTokenOverrides } from './lib/ds-runtime-theme.service';
