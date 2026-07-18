# Theming & modes

A mode is **not** a second stylesheet, **not** a rebuild, and **not** a branch inside a component. It is a
**re-binding of the semantic tokens on a scope**. Everything in this file follows from that one sentence — and
every failure in this file comes from someone not believing it.

## The mechanism, in full

```scss
:root                     { color-scheme: light dark; /* base + default mode tokens */ }
[data-ds-mode='light']    { /* the light bindings */ }
[data-ds-mode='dark']     { /* the dark bindings */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-ds-mode]) { /* the dark bindings */ }
}
```

That is the entire resolution chain, and it is expressed **in selectors**, not in code:

1. **No attribute** → the OS preference decides (`prefers-color-scheme`).
2. **An explicit attribute** → the user's choice wins, because `:root:not([data-ds-mode])` stops matching the
   moment it is set.
3. **Removing the attribute** → control returns to the OS.

The `:not()` is doing real work. Without it, an OS-dark user who explicitly chose *light* would get dark
anyway, because the media query would still match `:root`.

**`color-scheme: light dark` is not optional.** Without it, native UI — form controls, scrollbars, the text
caret, the autofill background — stays stubbornly light while your app goes dark, and the seams are the first
thing anyone notices.

## Where the mode LIVES

Three questions, and they have different answers:

**The DOM home** — an attribute on `<html>`. Not a class (classes are a shared namespace and get clobbered);
not a class on `<body>` (too late for anything painted above it). One attribute, written by one owner.

**The runtime owner** — **one** service, in the design system. Something must write that attribute, and if the
design system doesn't own it, every app hand-rolls its own copy and the two drift. The house `DsTheme` holds a
`mode` signal (`'light' | 'dark' | 'system'`) and an `effect` that sets or **removes** the attribute.

`'system'` maps to **removing** the attribute, not to setting `data-ds-mode="system"` — because "follow the OS"
is the *absence* of a choice, and the selector chain above is built on that absence. Setting a third value
would match nothing and silently pin light.

**The persistence home** — **a deliberate decision, and NOT the design system's to make.** Where a user's chosen
mode lives is a product question with a real trade-off:

| Home | Survives | Costs |
| --- | --- | --- |
| `localStorage` | Refresh, tab close, logout | Per-device; not shared across their phone and laptop |
| The user's server-side profile | Everything, everywhere | Needs auth; unavailable before login; a round-trip before you know it |
| Nothing (session only) | Nothing | Honest for a kiosk; infuriating anywhere else |

Choose it explicitly — that is exactly what `bespunky-engineering:resumable-state` is for. The design system
exposes the signal; the app decides where it lives.

## Restoring without a flash

If you restore the mode **after** Angular boots, the user watches the app load light and then snap to dark.
Everyone sees it, nobody can reproduce it on demand, and it reads as *cheap*.

The fix is unglamorous and it is the only one that works: **set the attribute before first paint**, from a tiny
synchronous inline script in `index.html`'s `<head>` — before the stylesheet, before the bundle:

```html
<script>
  // Runs before first paint. Reads the persisted choice; absence means "follow the OS", which the CSS
  // already handles, so we do nothing rather than guess.
  var m = localStorage.getItem('ds-mode');
  if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-ds-mode', m);
</script>
```

Then let `DsTheme` hydrate from the same key. Yes, this is a blocking inline script; it is a handful of bytes,
and it is the price of not flashing. (On SSR, render the attribute into the served HTML — same idea, no script.)

## Multi-brand is the same mechanism

A brand is another binding of the same semantic names — and it is a **separate axis from mode**, on its own
attribute. Do **not** add a brand as another map in `$modes`: `$modes` is the light/dark axis, `theme()`
emits a `[data-ds-mode='<key>']` block for every entry, and its parity guard requires every entry to share
one key set — so a brand dropped into `$modes` would collide with mode on one attribute and fight the guard.

Brand is its own map set and its own emission (a `$brands` map + a small `brands()` mixin alongside
`theme()`, or, if you only re-bind a handful of tokens, a hand-written block):

```scss
[data-ds-brand='acme']   { --ds-color-primary: …; }
[data-ds-brand='globex'] { --ds-color-primary: …; }
```

Brand and mode then compose **because they're both just the cascade** — `<html data-ds-brand='acme'
data-ds-mode='dark'>` needs no new machinery, the two attributes are independent, and a component reads the
same semantic names under any combination. If adding a brand makes you want to touch a component file, **the
semantic tier is incomplete**, and you have just found exactly where.

## Themes — and why a theme is a FILE, not JavaScript

A brand, a white-label palette per tenant, a skin the user picks from a list. This works **for free**, and
it is the runtime layer's biggest payoff: because every component reads `var(--ds-…)` and never a literal,
**re-binding a custom property re-themes the whole app live**.

The instinct is to reach for JavaScript — fetch a JSON blob of tokens and apply it with a service. **Don't.**
A theme should be a **CSS file of token overrides**, authored in SASS, compiled to its own stylesheet, and
applied with a `<link>`:

```scss
// themes/acme.theme.scss  ->  builds to theme-acme.css
@use '../styles' as ds;
@include ds.theme-overrides(
  $light: ('color-primary': #c0392b, 'color-on-primary': #ffffff),
  $dark:  ('color-primary': #ff8a7a, 'color-on-primary': #1c1c20)
);
```

```html
<link id="ds-theme" rel="stylesheet" href="theme-acme.css">
```

Swapping is then one line (`link.href = 'theme-globex.css'`). The file wins on every axis that matters:

- **No flash — and this is the decisive one.** A `<link>` in `<head>` is applied *before the first paint*.
  Anything JavaScript applies necessarily lands *after* the bundle boots, so the user watches the default
  theme paint and then snap to the brand. **No service can fix that**; it is inherent to running after
  parse. A design system that flashes its own brand in is not finished.
- **The compile-time guard survives.** Because the theme is authored in SASS *inside* the design system, an
  unknown token name is a **build error** — the same protection component SCSS gets. Ship the theme as an
  unvalidated JSON blob and you have thrown that away: a typo'd key resolves to nothing, silently, and you
  will spend an afternoon on it. This is the argument people miss, and it inverts the usual assumption that
  "runtime = more dynamic = better".
- **The browser does the work** — fetch, cache, revalidate, CDN. No string-building, no `<style>` injection,
  no CSP exception.

**Emit the same three-part structure the theme itself uses**, or the override will half-apply: `:root` for
mode-independent tokens, `[data-ds-mode='<mode>']` for a pinned mode, **and** the
`@media (prefers-color-scheme: …) :root:not([data-ds-mode])` block for the OS-driven case. Miss that last
one and the theme silently does nothing for every user on `'system'` — which is the default, i.e. **most of
them**. (Equally: never apply a theme as *inline styles* on `<html>`. An inline value cannot be conditional
on the mode attribute, so it overrides both modes with one value and the theme freezes the moment the user
switches.)

**The one case that genuinely needs JavaScript** is a value that does not exist until runtime — a colour
dragged out of a picker, a hex stored per-tenant in a database. You cannot pre-build a stylesheet for a
colour nobody has chosen yet. Keep that path small and know what you gave up: there is no compiler on it.

And the hard boundary either way: a theme can only **re-bind** tokens the design system already declares. It
cannot introduce new ones — nothing is reading them. Theming is a *values* mechanism, not an escape from the
token vocabulary.

## Per-scope theming

An inverted hero, a dark sidebar, a themed preview pane — these are **scoped re-bindings**, not classes you
sprinkle:

```scss
.hero--inverted { @include ds.scope-mode('dark'); }   // the public, one-line way to re-bind a whole mode on a scope
```

`scope-mode()` is what you reach for here — **not** `declare(map.get($modes, 'dark'))`, because the `$modes`
map is (correctly) private: a consumer who could read it could bake a hex at compile time and silently
break theming. `scope-mode('dark')` re-binds every dark token (and pins `color-scheme: dark`) on the scope,
sourced from inside the system where the values live.

Every component inside is now dark, and none of them know. Compare with the alternative — an `.is-dark`
modifier threaded through forty descendants, each of which now branches on it — and the difference is the
difference between a system and a habit.

## Contrast must hold in EVERY mode

**The pair is the unit you verify, not the colour.** A colour is not accessible on its own; `--color-on-surface`
against `--color-surface` is.

And contrast **does not transfer between modes**. A palette that passes in light routinely fails in dark, because
dark mode is not "light mode inverted" — perceived contrast at low luminance behaves differently, and pure white
on pure black is *too much* contrast (it haloes and fatigues). Getting light right tells you nothing about dark.

So: check **every `--color-X` / `--color-on-X` pair, in every mode**, when you define the tokens — not when a
component uses them. A failing pair is a **token bug**, and it fails identically in all forty components that
read it, which is the good news: fix it once.

## Testing modes

Whatever you do, **look at both**. A mode nobody ever opened is a mode that is broken.

- Drive it in a real browser and assert the *computed* value actually changes when the mode flips — that is the
  only proof the runtime layer is genuinely re-binding rather than merely appearing to
  (`bespunky-browser-automation:playwright` / `shared-browser`).
- Screenshot both modes for any visual review. "It looks fine" from someone who only ever ran light is not a
  review.

## Pitfalls

- **A second stylesheet per theme** — you have re-invented the cascade, badly, and now you own a loading order.
- **Branching on the mode inside a component** (`@if $dark { color: … }`) — the component now knows about
  theming, which is precisely what tokens exist to prevent. If you're doing this to change a **colour**, you have
  a missing semantic token. (A *structural* difference — a logo that swaps its mark — is the rare legitimate case,
  and that's what a `mode()` mixin is for.)
- **Setting `data-mode="system"`** — matches nothing, silently pins the default, and the OS preference never
  applies again.
- **Restoring the mode after boot** — the flash.
- **Forgetting `color-scheme`** — native UI stays light and gives the game away.
- **A token declared in light but not dark** — make it a **build failure**. The house theme mixin `@error`s on
  mode-key divergence, because the alternative is a user discovering invisible text.
- **Checking contrast only in light** — see above. It does not transfer.

**Mentality anchors:** *Model the missing concept* (a mode is a concept — give it a home and one owner, don't
scatter it) · *Refuse false tradeoffs* (you do not have to choose between "themeable" and "no flash" — you can
have both, for a few bytes) · *Design for the consumer* (the person using your app at 1am in bed is the consumer).
