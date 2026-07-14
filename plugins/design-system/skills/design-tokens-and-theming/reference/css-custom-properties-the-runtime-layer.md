# CSS custom properties — the runtime layer

This is the layer that actually ships to the browser, and the only one that can be **themed**. Everything a
design system promises — dark mode without a rebuild, a rebrand without touching components, a scoped
inverted section — is a consequence of one property of custom properties: **they cascade, and they are
resolved at use time, in the browser.**

A SASS variable is resolved at *compile* time and then it is gone. That is the whole difference, and it is
why the theming layer can never be SASS.

## Emit `:root` exactly once

One stylesheet — the app's global one — calls the theme mixin. That call emits the token block:

```scss
// styles.scss — the ONE side-effectful stylesheet in the app
@use 'design-system/styles' as ds;
@include ds.theme();
```

Everything else in the system is **zero-output**. If a component's SCSS also calls `theme()`, the entire
`:root` block is duplicated into that component's stylesheet — and it will keep duplicating, once per
component, silently inflating the bundle.

Custom properties declared on `:root` **inherit** to every element, which is exactly what you want: a
component nested anywhere reads `var(--ds-color-surface)` and it resolves, with no plumbing.

## The cascade IS the theming mechanism

This is the move. A theme is not a stylesheet you swap; it is a **re-binding of the same names on a scope**:

```css
:root                    { --ds-color-surface: #fff;    --ds-color-on-surface: #111; }
[data-ds-mode='dark']    { --ds-color-surface: #121214; --ds-color-on-surface: #f2f2f5; }
```

Put `data-ds-mode="dark"` on `<html>` and **every** component re-renders in dark — not because any component
knows about dark mode, but because the value it was already reading now resolves differently. No rebuild, no
second stylesheet, no flash, no component change. That is the whole feature, in two rules.

And because it's the cascade, it composes **at any scope**:

```scss
.inverted-hero { @include ds.scope-mode('dark'); }   // a dark island in a light page — re-binds every dark token here
```

An inverted section is a re-binding on that section — **not** an `.is-dark` class you add to forty
descendants.

## Fallbacks — and what a missing token should do

`var(--x, <fallback>)` is real, and it is mostly a trap.

**Inside the app, a missing token should FAIL, loudly and early** — which is why the house token accessor
`@error`s at *compile time* on an unknown key. A typo that survives to runtime renders as `color: ;` — an
invalid declaration the browser silently drops, giving you black text on black, or nothing at all, with no
error anywhere. That is the single worst failure mode in this entire layer, and it is why the compile-time
check exists.

Use a fallback only at a **genuine system boundary**: styling into a third-party widget that may render
outside your themed scope, or a web component that could be used standalone. There, degrading is honest.
Everywhere else, a fallback hides the bug that the token was never declared.

## `@property` — typed and animatable custom properties

By default a custom property is an untyped token stream, which means it **cannot be interpolated** — a
transition on `--gradient-angle` will jump, not sweep. `@property` gives it a type, an initial value, and
inheritance behaviour:

```css
@property --ds-gradient-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
```

Now it animates. Reach for this when a custom property is itself the thing being animated (a gradient sweep,
a conic progress ring, a hue shift). Don't reach for it reflexively — most tokens are never animated, and the
declaration is noise.

## What actually costs you

- **Custom properties inherit**, so a value declared on `:root` is available everywhere at essentially no
  cost. Declaring hundreds on `:root` is fine; that is the intended use.
- **Changing** a custom property on an element invalidates style for that element **and its subtree** —
  because anything below might be reading it. Flipping the mode on `<html>` therefore invalidates the page,
  which is correct and happens once per user action.
- What you should *not* do is write a custom property on every animation frame from JS on a high-fanout
  element and expect compositor-only performance — you've re-entered style recalculation. (For 60fps motion,
  animate `transform`/`opacity` — see `bespunky-product-ux:realize-the-vision` → performance & budgets.)

## When a SASS variable is STILL correct

The boundary is honest and it is testable: **if a consumer or a mode must change it at runtime, it is a
custom property.** Otherwise SASS is fine — and in one case, mandatory:

- **Media-query breakpoints.** `@media (min-width: var(--bp-md))` **does not work**, and never will: a media
  *condition* is evaluated before the cascade exists, so there is no element to resolve the variable against.
  Breakpoints are therefore legitimately compile-time. This is not an exception to the rule; it is a weakness
  of the material, which you absorb deliberately, in one place (the design system's `$breakpoints` map), and
  name — rather than discovering it per-component.
- **Compile-time maths** over values that are fixed at build (`math.div`, building a scale programmatically).
- **Selector/property-name construction** (`#{$prefix}-mode`) — string interpolation is a SASS job.

## Pitfalls

- **Emitting `:root` from more than one place** — two truths, and the last one loaded wins, which depends on
  bundling order. Enjoy debugging that.
- **`var()` in a `@media` condition** — silently does nothing.
- **Reading a token in a component's `@keyframes` and expecting it to interpolate** — untyped custom
  properties don't; that's what `@property` is for.
- **Relying on a fallback to paper over a token you never declared** — the bug is now permanent and invisible.
- **Setting `color-scheme` and forgetting it** — without it, native UI (form controls, scrollbars, the text
  caret) stays stubbornly light while your app goes dark, and the seams show.

**Mentality anchors:** *Everything is a black box* (a component reads a name, not a value; the binding is
somebody else's job) · *Absorb your materials' weaknesses* (the breakpoint exception is named once, in the
system, not rediscovered per file) · *Refuse false tradeoffs* (you do not have to choose between themeable and
fast — the cascade gives you both).
