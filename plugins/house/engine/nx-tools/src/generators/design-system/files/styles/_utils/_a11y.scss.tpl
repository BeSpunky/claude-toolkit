// ACCESSIBILITY MECHANISMS — the patterns every app needs and nobody should hand-write twice.
//
// Mechanisms, not looks: the hiding is geometry, and everything a sighted user sees comes from tokens, so
// replacing _tokens.scss re-tunes these with the rest of the system.
//
// Zero-output: `@use`-ing this file emits no CSS. A mixin emits only where you call it.
@use '../_core/functions' as fn;
@use 'mixins';

// The hiding itself — private to this file (the leading `-`).
@mixin -hidden {
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

/// Visually hidden, still announced by a screen reader — the correct way to label an icon-only control
/// (`display: none` and `visibility: hidden` remove it from the accessibility tree too).
///
/// `$focusable: true` hides it only UNTIL it, or something inside it, takes focus — the shape of every
/// "reveal on keyboard focus" control (a skip link, a "jump to filters" link). A mixin rather than the
/// `%visually-hidden` placeholder because `@extend` cannot cross a component stylesheet.
///
///   .sr-only { @include ds.visually-hidden(); }
@mixin visually-hidden($focusable: false) {
  @if $focusable {
    &:not(:focus):not(:focus-within) {
      @include -hidden;
    }
  } @else {
    @include -hidden;
  }
}

/// The SKIP LINK: the first focusable element of the app shell, pointing at the `<main>` landmark, so a keyboard or
/// switch user is not made to tab through the whole header and navigation on every page (WCAG 2.4.1, Bypass
/// Blocks). Hidden until focused; focused, it lands over the top-left corner of the page, above everything the
/// page stacks, on the surface colours and with the house focus ring.
///
///   <a class="skip-link" href="#main">Skip to main content</a>   …   <main id="main" tabindex="-1">
///   .skip-link { @include ds.skip-link(); }
@mixin skip-link {
  @include visually-hidden($focusable: true);
  position: fixed;
  inset-block-start: #{fn.space(2)};
  inset-inline-start: #{fn.space(2)};
  z-index: #{fn.z('modal')};
  padding: #{fn.space(2)} #{fn.space(3)};
  color: #{fn.color('on-surface')};
  background: #{fn.color('surface')};
  border-radius: #{fn.radius('md')};
  @include mixins.focus-ring();
}
