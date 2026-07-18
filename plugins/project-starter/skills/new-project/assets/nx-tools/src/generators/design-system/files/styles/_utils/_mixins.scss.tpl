// The MIXIN layer — MECHANISMS, not looks.
//
// Nothing here decides how anything appears. `focus-ring()` composes tokens; it does not pick a colour.
// `elevation()` reads the elevation token; it does not invent a shadow. When the design phase replaces
// _tokens.scss, every one of these changes with it, for free — and that is the entire point.
//
// Zero-output: `@use`-ing this file emits no CSS. A mixin emits only when you call it.
@use 'sass:map';
@use '../_core/functions' as fn;

// ---------------------------------------------------------------------------------------------
// Breakpoints — and why these are SASS variables, not custom properties.
//
// A CSS custom property CANNOT be used in a `@media` condition: `@media (min-width: var(--bp-md))`
// simply does not work, because media conditions are evaluated before the cascade exists. Breakpoints
// are therefore the one part of the system that is legitimately compile-time. This is the honest
// boundary between the two layers, not an exception to the rule.
// ---------------------------------------------------------------------------------------------
$breakpoints: (
  'sm': 480px,
  'md': 768px,
  'lg': 1024px,
  'xl': 1440px,
) !default;

/// Mobile-first media query by breakpoint NAME. Never type a raw px in a media query.
///
///   .grid { grid-template-columns: 1fr; @include ds.media('md') { grid-template-columns: 1fr 1fr; } }
@mixin media($name) {
  @if not map.has-key($breakpoints, $name) {
    @error 'Unknown breakpoint `#{$name}`. Declare it in the design system (styles/_utils/_mixins.scss).';
  }
  @media (min-width: map.get($breakpoints, $name)) {
    @content;
  }
}

/// Container query by breakpoint name — prefer this over `media()` for a COMPONENT that should adapt to
/// the space IT was given rather than to the viewport. (A card in a sidebar does not care how wide the
/// window is.) The consumer must establish `container-type` on the parent.
@mixin container($name) {
  @if not map.has-key($breakpoints, $name) {
    @error 'Unknown breakpoint `#{$name}`. Declare it in the design system (styles/_utils/_mixins.scss).';
  }
  @container (min-width: #{map.get($breakpoints, $name)}) {
    @content;
  }
}

/// The house focus ring. ONE definition, so keyboard focus looks and behaves identically everywhere —
/// and so nobody ever "fixes" an ugly outline by removing it. `:focus-visible` keeps it off mouse clicks.
/// Width, colour AND offset are all tokens (`$offset` defaults to the token but is overridable for the
/// clipping-ancestor case), so replacing `_tokens.scss` re-tunes the ring with the rest of the system —
/// no magic px lives here.
@mixin focus-ring($offset: null) {
  $resolved-offset: $offset;
  @if $offset == null {
    $resolved-offset: fn.token('focus-ring-offset');
  }
  &:focus-visible {
    outline: #{fn.token('focus-ring-width')} solid #{fn.color('focus-ring')};
    outline-offset: #{$resolved-offset};
  }
}

/// Apply an elevation level (the shadow, not the stacking order — `ds.z()` is the stacking order).
///
/// The shadow is a MODE-DEPENDENT token, so this automatically deepens in dark mode. But note that in
/// dark mode a shadow can only do half the job — you cannot get darker than a dark surface. Pair it with
/// a lighter surface for the lifted element:
///
///   .card { background: ds.color('surface-raised'); @include ds.elevation(1); }
@mixin elevation($level) {
  box-shadow: #{fn.elevation($level)};
}

/// A transition on the house motion language. Duration and easing are tokens, so the whole app's motion
/// can be re-tuned (or reduced) from one place.
@mixin transition($properties...) {
  transition-property: $properties;
  transition-duration: #{fn.duration('base')};
  transition-timing-function: #{fn.easing('standard')};
}

/// Respect a user who has asked for less motion. NOT optional, and not a nicety: for some people
/// vestibular motion is physically harmful. Wrap any non-essential animation in this.
@mixin reduced-motion {
  @media (prefers-reduced-motion: reduce) {
    @content;
  }
}
