// THE PUBLIC API of the design system's runtime (`{{importPath}}`).
//
// Deliberately tiny. The design system's main surface is NOT code — it is the SASS layer
// (`{{importPath}}/styles`). What lives here is only the part of theming that cannot be expressed in CSS: the
// thing that writes the mode attribute. What you export, you must support.
//
// THE HOUSE REGION below holds the house's exports: an upgrade rewrites it, and nothing else in this file. Publish your
// own below its end marker and they stay yours.
// @bespunky/design-system-api:start — the house's runtime exports, rewritten by every house upgrade. Yours go below the end marker.
export { setMode, getMode, resolvedMode, MODE_ATTRIBUTE, type DsMode } from './lib/ds-mode';
// @bespunky/design-system-api:end
