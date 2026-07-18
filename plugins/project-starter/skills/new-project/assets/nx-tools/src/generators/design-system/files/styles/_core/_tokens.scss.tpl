// ============================================================================================
//  ⚠️   PLACEHOLDER TOKENS — THIS IS NOT A DESIGN.   ⚠️
//
//  These values exist for exactly ONE reason: so the library compiles and the app runs on day
//  zero. They carry ZERO visual intent. Do NOT build a look on top of them, and do NOT "tweak"
//  them into a design.
//
//  This file is REPLACED WHOLESALE by the design phase:
//      bespunky-product-ux:envision-the-experience  (the feeling)
//   -> bespunky-product-ux:stage-the-vision         (the visual system: palette, type, scales, motion)
//   -> bespunky-product-ux:realize-the-vision       (which lands that visual system HERE, as tokens)
//
//  The MECHANISM below is what's real: the key sets, the light/dark parity, the accessors in
//  _functions.scss, the emission in _theme.scss. The VALUES are scaffolding.
//
//  THE ONE RULE: this is the ONLY file in the workspace allowed to contain a literal colour, a
//  literal dimension, or a literal duration. Everywhere else, you read a token.
// ============================================================================================
@use 'sass:list';
@use 'sass:map';

/// The custom-property namespace. `color-surface` -> `--{{tokenPrefix}}-color-surface`.
$prefix: '{{tokenPrefix}}' !default;

/// Mode-INDEPENDENT tokens — identical in every mode. A space step, a radius, a duration: none of them
/// change in the dark.
///
/// NOTE what is deliberately NOT here: ELEVATION. A shadow is not mode-independent — a black shadow is
/// nearly invisible on a dark surface, so a "one shadow for both modes" system ships flat cards in dark
/// mode by construction. Elevation therefore lives in `$modes` below, where each mode can express depth
/// its own way.
$base: (
  // -- Space scale. A value not on this scale is a design bug, not a missing token.
  'space-0': 0,
  'space-1': 0.25rem,
  'space-2': 0.5rem,
  'space-3': 1rem,
  'space-4': 1.5rem,
  'space-5': 2rem,
  'space-6': 3rem,

  // -- Radius scale.
  'radius-sm': 2px,
  'radius-md': 4px,
  'radius-lg': 8px,
  'radius-full': 9999px,

  // -- Type scale.
  'font-family-base': (system-ui, -apple-system, sans-serif),
  'font-family-mono': (ui-monospace, monospace),
  'font-size-sm': 0.875rem,
  'font-size-md': 1rem,
  'font-size-lg': 1.25rem,
  'font-size-xl': 1.75rem,
  'font-weight-regular': 400,
  'font-weight-bold': 700,
  'line-height-tight': 1.2,
  'line-height-base': 1.5,

  // -- Border.
  'border-width-thin': 1px,

  // -- Focus ring. Its WIDTH and OFFSET are tokens too, so replacing _tokens.scss re-tunes the ring
  //    with everything else — the `focus-ring()` mixin reads these, it does not hardcode a px.
  'focus-ring-width': 2px,
  'focus-ring-offset': 2px,

  // -- Motion. Durations and easings are tokens: the motion language is a SYSTEM, not a
  //    per-component mood. A hand-typed `200ms ease` is a magic value.
  'duration-fast': 120ms,
  'duration-base': 200ms,
  'duration-slow': 320ms,
  'easing-standard': cubic-bezier(0.2, 0, 0, 1),
  'easing-decelerate': cubic-bezier(0, 0, 0, 1),

  // -- Stacking order. Named layers, so nobody ever types `z-index: 9999`. (Mode-independent: which
  //    thing sits on top of which does not change in the dark. This is the z-index, NOT the shadow —
  //    the shadow is `elevation-*`, and it lives in `$modes`.)
  'z-dropdown': 100,
  'z-overlay': 500,
  'z-modal': 1000,
);

/// Mode-DEPENDENT tokens. One map per mode.
///
/// The key sets MUST be identical across every mode — `_theme.scss` @errors at COMPILE time if they
/// diverge. A token that exists in light but not in dark is a broken theme, and that must be a BUILD
/// failure, not a runtime surprise a user discovers as invisible text.
///
/// These are SEMANTIC names (`color-surface`, `color-on-surface`) on purpose, not primitives
/// (`gray-100`). A component reads MEANING, never a swatch — that is what lets a re-theme be a change
/// to this file instead of a change to a thousand component files.
$modes: (
  'light': (
    'color-surface': #ffffff,
    'color-surface-raised': #f7f7f8,
    'color-on-surface': #16161a,
    'color-on-surface-muted': #5c5c66,
    'color-primary': #4a4a55,
    'color-on-primary': #ffffff,
    // Border passes WCAG 1.4.11 non-text contrast (>= 3:1) against the surface, so a control outlined
    // only by its border is still perceivable. A softer divider colour would be a SEPARATE token.
    'color-border': #8a8a94,
    'color-danger': #b3261e,
    'color-on-danger': #ffffff,
    // The focus ring is distinct from primary on purpose: at offset 0 (a clipping ancestor) a ring the
    // same colour as a primary fill would vanish. This blue reads against both surface and primary.
    'color-focus-ring': #1a63d6,

    // Elevation — the SHADOW (the z-index is `z-*` in $base). On a LIGHT surface a soft black shadow is
    // exactly right: the page is bright, so a darker edge reads as "lifted".
    'elevation-0': none,
    'elevation-1': 0 1px 2px rgb(0 0 0 / 12%),
    'elevation-2': 0 4px 12px rgb(0 0 0 / 16%),
  ),
  'dark': (
    'color-surface': #121214,
    'color-surface-raised': #1c1c20,
    'color-on-surface': #f2f2f5,
    'color-on-surface-muted': #a0a0ab,
    'color-primary': #c8c8d2,
    'color-on-primary': #1c1c20,
    'color-border': #6a6a74,
    'color-danger': #f2b8b5,
    'color-on-danger': #1c1c20,
    'color-focus-ring': #7db0ff,

    // Elevation in the DARK is a different problem, and this is the whole reason elevation is a
    // mode-dependent token. A black shadow on a near-black surface is invisible — you cannot get darker
    // than dark. So depth here is carried by TWO things working together:
    //   1. a LIGHTER surface — use `color-surface-raised` for a lifted element (this is the primary
    //      depth cue in dark mode, the same trick Material uses); and
    //   2. a deeper, wider shadow, which still separates the element's EDGE from what's behind it.
    // Deepened alpha (vs light's 12%/16%) so the shadow does real work instead of vanishing.
    'elevation-0': none,
    'elevation-1': 0 1px 3px rgb(0 0 0 / 55%),
    'elevation-2': 0 6px 16px rgb(0 0 0 / 65%),
  ),
);

/// Every declared token key, in either tier. Used by `_functions.scss` to reject a typo at compile time.
/// Derived from the ACTUAL modes (not a hardcoded `'light'`) so renaming/adding modes can't desync it —
/// `nth($modes, 1)` is the first mode's map, and every mode declares an identical key set (theme() @errors
/// otherwise), so any one mode's keys are the full set.
$all-keys: map.keys($base);
@each $key in map.keys(list.nth(map.values($modes), 1)) {
  $all-keys: list.append($all-keys, $key);
}
