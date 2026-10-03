// THE PUBLIC API of the design system's runtime (`{{importPath}}`).
//
// Deliberately tiny. The design system's main surface is NOT code — it is the SASS layer
// (`{{importPath}}/styles`). What lives here is only the part of theming that cannot be expressed in CSS: the
// thing that writes the mode attribute. What you export, you must support.
export { setMode, getMode, resolvedMode, MODE_ATTRIBUTE, type DsMode } from './lib/ds-mode';
