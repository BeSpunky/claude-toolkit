// PLACEHOLDER SELECTORS — shared rule bodies you `@extend`, for the handful of patterns that are pure
// mechanism and carry no design.
//
// Zero-output: a placeholder emits nothing until something extends it.
//
// CAVEAT (why this file stays small): `@extend` merges selectors across the whole stylesheet it runs in,
// so it does NOT cross a component-stylesheet boundary and it can produce surprising selector explosions
// when extended from many places. For anything parameterized, reach for a MIXIN instead. A placeholder is
// only correct for a fixed, argument-less rule body.
@use '../_core/functions' as fn;

/// Visually hidden, but still announced by a screen reader. The correct way to label an icon-only
/// control — `display: none` and `visibility: hidden` remove it from the accessibility tree too.
%visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/// Strip the browser's default button chrome, keeping the SEMANTICS. Reach for this whenever you are
/// tempted to make a `<div>` clickable: a real `<button>` gives you keyboard activation, focus, and the
/// right role for free, and this makes it look like nothing.
%reset-button {
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: 0;
}

/// Truncate a single line with an ellipsis.
%truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/// A full-bleed, non-interactive overlay surface (dialog scrims, drawers). Owns only the STACKING and
/// the geometry — the colour is the consumer's, from a token.
%overlay-surface {
  position: fixed;
  inset: 0;
  z-index: #{fn.z('overlay')};
}
