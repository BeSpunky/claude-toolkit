// The token ACCESSORS — the author-time half of the two-layer model.
//
// Every accessor returns a `var()` REFERENCE, never a static value. That is precisely what makes the
// theme runtime-switchable: flipping to dark mode is ONE attribute on <html>, not a recompile and not
// a swapped stylesheet. If these returned the raw hex from _tokens.scss, the theme would be baked into
// the bundle at build time and dark mode would be impossible without shipping a second stylesheet.
//
// Unknown keys @error at COMPILE time, so a typo (`color-primry`) is a build failure — not a silently
// empty var() that renders as transparent text and ships to production.
@use 'sass:list';
@use 'tokens';

/// The custom-property NAME for a token key: `color-primary` -> `--{{tokenPrefix}}-color-primary`.
@function var-name($key) {
  @return --#{tokens.$prefix}-#{$key};
}

/// THE accessor. Every other function here is a facade over it.
///
///   color: ds.token('color-on-surface');
///   gap:   ds.token('space-3');
///
/// `$fallback` emits `var(--x, <fallback>)` — use it ONLY at a genuine system boundary (e.g. styling
/// into a third-party widget that may render outside the themed scope). Inside the app, a missing token
/// should FAIL, not silently degrade.
@function token($key, $fallback: null) {
  @if not list.index(tokens.$all-keys, $key) {
    @error 'Unknown design token `#{$key}`. Declare it in the design system (styles/_core/_tokens.scss) ' +
           'before using it. A value the system never named is not a token — and hardcoding it here ' +
           'instead is exactly the patch the design-system-first discipline forbids.';
  }
  // Deliberately @if, not the deprecated sass if() function (which warns on every consuming stylesheet).
  @if $fallback == null {
    @return var(#{var-name($key)});
  }
  @return var(#{var-name($key)}, #{$fallback});
}

// ---------------------------------------------------------------------------------------------
// Typed facades. `ds.color('primary')` reads better than `ds.token('color-primary')` and keeps the
// key-namespacing convention enforceable — you cannot ask for a colour that isn't in the colour tier.
// ---------------------------------------------------------------------------------------------

@function color($name, $fallback: null) { @return token('color-#{$name}', $fallback); }
@function space($step)                  { @return token('space-#{$step}'); }
@function radius($name)                 { @return token('radius-#{$name}'); }
@function font($name)                   { @return token('font-#{$name}'); }
@function border($name)                 { @return token('border-#{$name}'); }
@function duration($name)               { @return token('duration-#{$name}'); }
@function easing($name)                 { @return token('easing-#{$name}'); }
@function elevation($level)             { @return token('elevation-#{$level}'); }
@function z($layer)                     { @return token('z-#{$layer}'); }
