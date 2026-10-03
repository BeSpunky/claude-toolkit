// The THEME EMISSION — the one and only place in the workspace that emits CSS custom properties.
//
// Everything else in this sass layer is ZERO-OUTPUT: `@use`-ing the design system must emit no CSS at
// all. `theme()` is the single deliberate exception, and it is called EXACTLY ONCE, from the app's
// global stylesheet:
//
//     @use 'design-system/styles' as ds;   // (in-repo)
//     @include ds.theme();
//
// Calling it a second time (e.g. from a component's SCSS) duplicates the whole :root block into that
// component's stylesheet. Don't.
@use 'sass:list';
@use 'sass:map';
@use 'sass:string';
@use 'tokens';
@use 'functions' as fn;

/// Emit a token map as custom properties in the CURRENT scope. The primitive `theme()` is built from,
/// and the public tool for re-binding tokens on a SCOPE (see `scope-mode()`).
@mixin declare($map) {
  @each $key, $value in $map {
    #{fn.var-name($key)}: #{$value};
  }
}

/// The `color-scheme` keyword a mode maps to, so native UI (form controls, scrollbars, the caret)
/// follows the theme. Only the two OS-preference names map; a brand (or any other mode) has no OS
/// correspondence and contributes no hint. Returns null when there is none.
@function -color-scheme-for($mode) {
  @if $mode == 'light' { @return light; }
  @if $mode == 'dark' { @return dark; }
  @return null;
}

/// THE theme emission. Emits, in order:
///
///   :root                              base tokens + the default mode's tokens + its color-scheme
///   [data-{{tokenPrefix}}-mode='<mode>']             one explicit-opt-in block per mode, each pinning its own color-scheme
///                                      (the TS DsTheme signal writes this attribute)
///   @media (prefers-color-scheme: X)   :root:not([data-{{tokenPrefix}}-mode]) — the OS preference, per OS-named mode,
///                                      but ONLY while the user has not pinned a mode
///
/// The `:not()` is the resolution chain in one selector: OS preference by default, an explicit user
/// choice overrides it, and clearing the choice hands control back to the OS. Works for ANY
/// `$default-mode` — call `theme('dark')` and OS-light users still correctly get light.
@mixin theme($default-mode: 'light') {
  // BIDIRECTIONAL COMPILE-TIME PARITY GUARD. Every mode must declare EXACTLY the default's key set — a
  // token in one mode and not another is a broken theme, and that must be a BUILD failure, not invisible
  // text at 11pm. We check both directions: a mode missing a default key, AND a mode with an extra key
  // the default lacks (which the one-directional check used to let ship, then `ds.color()` would reject
  // the very token you'd just declared).
  $reference: map.get(tokens.$modes, $default-mode);
  @each $mode, $values in tokens.$modes {
    @each $key, $_v in $reference {
      @if not map.has-key($values, $key) {
        @error 'Mode `#{$mode}` is missing the token `#{$key}` (declared in `#{$default-mode}`). ' +
               'Every mode must declare an identical key set.';
      }
    }
    @each $key, $_v in $values {
      @if not map.has-key($reference, $key) {
        @error 'Mode `#{$mode}` declares `#{$key}`, which the default mode `#{$default-mode}` does not. ' +
               'Every mode must declare an identical key set — add it to every mode (a colour must exist ' +
               'in light AND dark).';
      }
    }
  }

  :root {
    @include declare(tokens.$base);
    @include declare(map.get(tokens.$modes, $default-mode));
    $cs: -color-scheme-for($default-mode);
    @if $cs != null {
      color-scheme: $cs;
    }
  }

  // The explicit user choice. `DsTheme` writes `data-{{tokenPrefix}}-mode` onto <html>; this is what it binds to.
  // Each block pins its OWN color-scheme — otherwise pinning light on an OS-dark machine would leave the
  // native UI (inputs, scrollbars, caret) resolving dark under the tokens' light surface.
  @each $mode, $values in tokens.$modes {
    [data-#{tokens.$prefix}-mode='#{$mode}'] {
      @include declare($values);
      $cs: -color-scheme-for($mode);
      @if $cs != null {
        color-scheme: $cs;
      }
    }
  }

  // The OS preference — one block per OS-named mode, gated on `:root:not([data-…-mode])` so an explicit
  // choice always wins. Emitting a block for EVERY OS-named mode (not just "dark") is what makes a
  // non-light `$default-mode` correct.
  @each $mode, $values in tokens.$modes {
    $cs: -color-scheme-for($mode);
    @if $cs != null {
      @media (prefers-color-scheme: #{$cs}) {
        :root:not([data-#{tokens.$prefix}-mode]) {
          @include declare($values);
          color-scheme: $cs;
        }
      }
    }
  }

  // Honor prefers-reduced-motion GLOBALLY by collapsing the duration tokens to ~0. Because
  // `ds.transition()` (the sanctioned way to write a transition) READS these tokens, every transition in
  // the app reduces from THIS ONE PLACE — which is the whole promise of the motion language being a
  // system. (Not 0ms: a hair of duration keeps `transitionend` listeners firing.)
  @media (prefers-reduced-motion: reduce) {
    :root {
      @each $key, $_v in tokens.$base {
        @if string.slice($key, 1, 9) == 'duration-' {
          #{fn.var-name($key)}: 0.01ms;
        }
      }
    }
  }
}

/// Emit a THEME FILE — a standalone stylesheet of token overrides, compiled to its own `.css` and
/// swapped at runtime with a `<link>`. This is THE way to ship a brand / tenant / user-selectable theme.
///
///     // packages/design-system/themes/acme.theme.scss
///     @use '../styles' as ds;
///     @include ds.theme-overrides(
///       $base:  ('radius-md': 10px),
///       $light: ('color-primary': #c0392b, 'color-on-primary': #ffffff),
///       $dark:  ('color-primary': #ff8a7a, 'color-on-primary': #1c1c20),
///     );
///
/// Why a FILE and not JavaScript: a `<link>` in <head> is applied BEFORE first paint, so the brand never
/// flashes in after boot; the browser caches, revalidates and CDN-serves it for free; and — the real prize
/// — because the theme is authored HERE, in SASS, it keeps the design system's COMPILE-TIME guarantees.
/// An unknown token name is a build error, not a value that silently does nothing at 2am.
///
/// It emits the same three-part structure `theme()` does, which is what makes an override survive a mode
/// switch AND the 'system' (no-attribute) case — the two things a hand-rolled theme always gets wrong:
///   :root                                                    <- $base
///   [data-{{tokenPrefix}}-mode='light' | 'dark']                           <- $light / $dark, when the user PINNED a mode
///   @media (prefers-color-scheme: …) :root:not([data-…])     <- $light / $dark, when they're on 'system'
@mixin theme-overrides($base: (), $light: (), $dark: ()) {
  @include -assert-known($base, '$base');
  @include -assert-known($light, '$light');
  @include -assert-known($dark, '$dark');

  // A token overridden in one mode but not the other keeps the BUILT-IN value in that other mode — so a
  // brand's primary would render brand-red in light and the stock grey in dark. That's almost always a
  // mistake, but it is not fatal (the fallback is a designed value, not invisible text), so: warn, don't
  // fail. Contrast with theme()'s parity guard, which DOES fail — there, a missing token means nothing
  // renders at all.
  @each $key, $_v in $light {
    @if not map.has-key($dark, $key) {
      @warn 'Theme overrides `#{$key}` in $light but not in $dark — dark mode will keep the built-in value.';
    }
  }
  @each $key, $_v in $dark {
    @if not map.has-key($light, $key) {
      @warn 'Theme overrides `#{$key}` in $dark but not in $light — light mode will keep the built-in value.';
    }
  }

  @if list.length($base) > 0 {
    :root {
      @include declare($base);
    }
  }

  @each $mode, $values in ('light': $light, 'dark': $dark) {
    @if list.length($values) > 0 {
      [data-#{tokens.$prefix}-mode='#{$mode}'] {
        @include declare($values);
      }
      // Without this block the theme silently does nothing for every user on 'system' — which is the
      // DEFAULT, i.e. most of them. This is the single most-missed line in runtime theming.
      @media (prefers-color-scheme: #{$mode}) {
        :root:not([data-#{tokens.$prefix}-mode]) {
          @include declare($values);
        }
      }
    }
  }
}

/// Compile-time guard for a theme's override map: every key must be a token the design system actually
/// DECLARES. A theme can only RE-BIND tokens — it cannot invent them, because nothing would be reading a
/// name no component uses. Catching that here is the whole reason a theme is authored in SASS rather than
/// shipped as an unvalidated JSON blob.
@mixin -assert-known($tokens, $label) {
  @each $key, $_value in $tokens {
    @if not list.index(tokens.$all-keys, $key) {
      @error 'Unknown design token `#{$key}` in #{$label}. A theme can only re-bind tokens the design ' +
             'system declares (styles/_core/_tokens.scss) — it cannot introduce new ones, because no ' +
             'component reads them.';
    }
  }
}

/// Re-bind a whole mode's tokens onto a SCOPE — the supported way to make a section render as another
/// mode (an inverted hero, a dark sidebar in a light app) without a component knowing about it:
///
///   .hero--inverted { @include ds.scope-mode('dark'); }
///
/// This is the public replacement for reaching into the (private) `$modes` map with `declare()`.
@mixin scope-mode($mode) {
  @if not map.has-key(tokens.$modes, $mode) {
    @error 'Unknown mode `#{$mode}`. Declare it in the design system (styles/_core/_tokens.scss `$modes`).';
  }
  @include declare(map.get(tokens.$modes, $mode));
  $cs: -color-scheme-for($mode);
  @if $cs != null {
    color-scheme: $cs;
  }
}

/// Scope a block to an EXPLICITLY-PINNED mode — for the RARE element that must differ STRUCTURALLY, not
/// merely in colour (a logo that swaps its mark, an image that needs a different overlay):
///
///   :host { .logo { @include ds.mode('dark') { background-image: url('logo-dark.svg'); } } }
///
/// Uses `:host-context()` so it works inside an Angular component's (Emulated) styles — a bare
/// `[data-…-mode] &` would be rewritten by Angular's style shim into a selector that can never match
/// <html>. NOTE it fires only when the mode is PINNED (an explicit choice); a `'system'` user whose OS
/// drives the mode has no attribute to match — for that case pair it with `@media (prefers-color-scheme)`.
/// And if you're reaching for this to change a COLOUR, stop: that's a missing semantic token.
@mixin mode($name) {
  :host-context([data-#{tokens.$prefix}-mode='#{$name}']) & {
    @content;
  }
}
