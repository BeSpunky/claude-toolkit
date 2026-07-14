---
name: design-tokens-and-theming
description: Design tokens, theming, and the styling architecture of a design-system library - the styling-layer expression of the architect mindset. Use when you must decide HOW a visual value is defined, named, layered, themed, encapsulated, or consumed: designing or extending a token set (colour, space, radius, type, elevation, border, motion); naming and TIERING tokens (primitive -> semantic -> component); choosing between a CSS custom property and a SASS variable; writing or SUMMONING a design system's SASS API (functions, mixins, placeholders, @use/@forward); adding light/dark/brand modes and deciding where a mode LIVES, how it is detected, overridden, and persisted without a flash; styling across a component boundary (:host, :host-context, ::part, ViewEncapsulation, host classes and data attributes - and why ::ng-deep is banned); keeping contrast honest in EVERY mode; or laying out the design-system library itself - its public vs internal surfaces and its secondary entry points (one component = one entry point, generated with `nx g @bespunky/nx-tools:ds-component <name>`). The core move - TWO LAYERS, ONE TRUTH: CSS custom properties are the RUNTIME layer (live, cascading, themeable - a mode is a RE-BINDING of tokens on a scope, never a swapped stylesheet and never a rebuild), and the SASS API is the AUTHOR-TIME layer (zero-output functions/mixins/placeholders that emit nothing until called, summoned per-file with @use, never a global side-effect); a component reads SEMANTIC tokens and nothing else, so re-theming, rebranding, or adding a mode never touches a component file. This skill is a ROUTER - it indexes technique clusters and points to a reference file for each; read only the cluster you need. It is the HOW; the DISCIPLINE that says you MUST (go to the design system first, never hardcode a value, promote a pattern on its second occurrence, model the missing concept instead of overriding locally) is `bespunky-design-system:design-system-first`. Assumes SASS + modern Angular in an Nx workspace with the house-scaffolded publishable design-system library. It does NOT invent the look: the visual system it encodes (palette, type, composition, motion language) comes from `bespunky-product-ux:stage-the-vision`, and the moments that consume it are engineered in `bespunky-product-ux:realize-the-vision`. For library boundaries and entry points in general, see `bespunky-engineering:nx-monorepo-and-dx`; for a component's input/output API, `bespunky-engineering:angular-architecture`; for where a user's chosen mode persists, `bespunky-engineering:resumable-state`.
---

# Design Tokens & Theming

`bespunky-engineering:architect-mentality` is the *why*. `bespunky-design-system:design-system-first` is the
*discipline* — that every visual value comes from the design system, that you never hardcode, that the second
occurrence is a promotion. **This skill is the *how*, in CSS and SASS.**

Two mentality principles dominate everything below:

- **Everything is a black box with deliberate connections** → a component's *styleable surface* is a
  **published contract** (tokens in, parts out), not a DOM tree you are free to reach into. This is why
  `::ng-deep` is banned rather than merely discouraged.
- **Place every element on purpose** → every value lives at its **tier**, exactly once. A component reading a
  primitive swatch instead of a semantic name is a value placed where it merely *fits*.

## The two layers — the spine of everything here

**The runtime layer: CSS custom properties.** What actually ships. They **cascade**, which is the whole
mechanism: a theme is a **re-binding of tokens on a scope**, live — no rebuild, no swapped stylesheet, no
flash, and no component aware it happened. This is why a SASS variable can *never* be the theming layer: it
is compiled away before the browser ever sees it.

**The author-time layer: SASS.** Functions, mixins, placeholders — a **zero-output** API. `@use`-ing it must
emit **no CSS at all**. It is *summoned* per-file (`@use '<ds>/styles' as ds;`) by the app and by the design
system's own components alike, through the very same entry point a published consumer gets — so the library
dogfoods its own contract and finds out it's wrong before a consumer does.

**And exactly one stylesheet emits.** One place calls the theme mixin, emitting `:root`. Everything else is
zero-output. If two things emit, you have two truths.

The boundary between the layers is not a matter of taste, and it is testable: **if a consumer or a mode must
change it at runtime, it is a custom property. Full stop.** (The one honest exception — a media-query
breakpoint, because a media *condition* is evaluated before the cascade exists and cannot read a custom
property — is exactly the kind of material weakness you absorb deliberately, and name.)

## How to use this skill

1. From the decision in front of you, identify which **cluster** applies.
2. **Read that `reference/<file>.md`** — the techniques, how to choose, the caveats, the footguns, the house
   (Angular/Nx/ng-packagr) specifics, and when *not* to reach for it.
3. Read only the cluster(s) you need. Don't load them all.

## Technique clusters

| Cluster | Reference | Covers | Serves (architect-mentality) |
| --- | --- | --- | --- |
| **Token taxonomy & naming** | `reference/token-taxonomy-and-naming.md` | The three tiers — **primitive → semantic → component** — and the hard rule that a component reads **semantic only**; the naming grammar; the scales (space, type, radius, elevation, duration, easing) and why a value not *on* a scale is a design bug rather than a missing token; fluid steps (`clamp()` produces the value, the token owns the **name**); contrast as a property of the *palette*, not an afterthought; when a token should **not** exist | Model the missing concept · Place everything on purpose · Names carry intent |
| **CSS custom properties — the runtime layer** | `reference/css-custom-properties-the-runtime-layer.md` | Where `:root` is emitted (exactly once) and why; the **cascade as the theming mechanism** — scope a re-binding to `[data-theme]`, `:host`, a section; fallbacks (`var(--x, …)`) and what a missing token *should* do (fail loudly, not silently white); `@property` for typed, animatable custom properties; the performance model (what a custom-property change actually invalidates); and the cases where a **SASS variable is still correct** | Everything is a black box · Absorb your materials' weaknesses |
| **The SASS API layer & how it's summoned** | `reference/the-sass-api-layer.md` | The **zero-output rule** (an `@use` must emit no CSS) and how to hold it; `@use`/`@forward` and the module system (never `@import`); **public vs private** — the `@forward … show` barrel as the contract, the implementation in `_`-prefixed folders named for *what they are* (`_core`, `_utils`) rather than a bucket called `internal`, and the `-`-prefixed file-private member; the single façade the app summons and **how it resolves in-repo** (the load-path channel, because SASS cannot read tsconfig paths) versus published (`exports`); token accessors that `@error` on an unknown key, so a typo is a build failure and not a blank cell | Concentrate complexity · Design for the consumer · Abstractions must stay honest |
| **Theming & modes** | `reference/theming-and-modes.md` | A mode is a **re-binding of semantic tokens**, never a second stylesheet and never a branch inside a component; where the mode **lives** (an attribute on `<html>`, plus `color-scheme` so native UI follows); the resolution chain — `prefers-color-scheme` → an explicit user choice → a per-scope override — and how the choice **persists and restores without a flash**; multi-brand as a second binding of the same semantic names; per-scope theming (an inverted hero is a scoped re-binding, not an `.is-dark` class on forty elements); **contrast must hold in EVERY mode — the pair, not the colour, is the unit you verify** | Model the missing concept · Refuse false tradeoffs · Design for the consumer |
| **Component styling & encapsulation** | `reference/component-styling-and-encapsulation.md` | `ViewEncapsulation` (Emulated is the default and stays the default; `None` is a global leak; ShadowDom's real trade-offs); `:host`, `:host()` for state, `:host-context()` and its narrow legitimate use; **why `::ng-deep` is banned** — it is *"reach into another module's internals"* in CSS, it is deprecated, and it breaks silently on refactor; the **published styling contract** instead — **tokens in, parts out**, content projection for structure, host attributes for state; **variants as data, not booleans**; why `!important` is always a design failure; `@layer` for a predictable cascade | Everything is a black box · Design for the consumer · Abstractions must never trap |
| **The DS library — structure & entry points** | `reference/ds-library-structure-and-entrypoints.md` | The shape of a publishable design system: the SASS entry point (a public barrel over `_`-prefixed private folders), the primary TS entry point, and **one component = one secondary entry point**; **zero components at scaffold time, on purpose**; adding one is a **generator** call (`nx g @bespunky/nx-tools:ds-component <name>`), never a hand-made folder — the entry-point config *is* the boundary, so a hand-made one resolves in the editor and vanishes on publish; what the app may import from where; keeping the library publishable (no reach-back into an app); the tree-shaking payoff | Everything is a black box · Automate every repeated process · Place everything on purpose |

## Ask yourself

- Is this value a **token**, and is it at the **right tier** — am I reading a *primitive* from a component
  when what I mean is a *meaning*?
- Does this value need to change **at runtime** or **per mode**? Then it is a custom property, not a SASS
  variable. No exceptions, no "it's only for now".
- Does my `@use` of the design system emit **any** CSS? It must emit none.
- Would adding a **new brand** or a **new mode** touch any *component* file? If yes, the semantic tier is
  incomplete — and you've just found where.
- Am I about to **pierce a component's boundary**? What is the real finding — a missing token, or a missing
  part?
- Does every foreground/background **pair** still pass contrast **in dark mode**, or did I only ever look at
  light?
- Is this component **earning** a secondary entry point — and did I **generate** it, or hand-make the folder?
- If the brand colour changed tomorrow, how many files would I touch? Say the number out loud.

## Red flags

- **A raw colour outside the primitive/token file** — the system has already forked; it just doesn't know yet.
- **A component reading `--gray-100`** where it means `--surface-raised`. It is reading a *swatch*, and a
  swatch cannot survive a re-theme.
- **A SASS variable used for anything a theme must change** — compiled away, unreachable, and the reason
  someone will later propose "a second stylesheet for dark mode".
- **An `@use` that emits CSS** — now importing the API has a side effect, and it duplicates for every file
  that imports it.
- **A second stylesheet per theme** (or a rebuild per brand). The cascade already does this, for free.
- **`::ng-deep` / `!important` / `ViewEncapsulation.None`** used as a *styling strategy*. Each is a boundary
  violation with a different accent.
- **A theme that flashes on first paint** — the mode was restored after render, so the user watched the app
  change its mind.
- **Dark mode shipped with unreadable text** — contrast was checked in light and assumed in dark. It doesn't
  transfer; it has to be verified per mode, per pair.
- **A `variant` boolean bag** — `isCompact` + `isDanger` + `isBig` is eight states, of which three were
  designed.
- **A design-system component hand-made** instead of generated — it resolves in the editor and disappears on
  publish.
- **The design system importing from an app.** It is publishable; a reach-back makes that a lie.

> **Origin.** The technique layer beneath `bespunky-design-system:design-system-first`. That skill says the
> visual truth lives in one place; this one says *how* to build a place worth putting it in.

> **Related.** `bespunky-design-system:design-system-first` (the discipline — the *must*) ·
> `bespunky-engineering:architect-mentality` (the mindset) · `bespunky-engineering:architecture-first` (the
> same no-patch rule, in logic) · `bespunky-product-ux:stage-the-vision` (produces the **visual system** these
> tokens encode) · `bespunky-product-ux:realize-the-vision` (builds the moments that consume them) ·
> `bespunky-engineering:nx-monorepo-and-dx` (library boundaries and secondary entry points, in general) ·
> `bespunky-engineering:angular-architecture` (component API ergonomics — variants as data, the styling
> contract) · `bespunky-engineering:resumable-state` (where the user's chosen mode *lives*, so it survives a
> refresh) · `bespunky-product-ux:astonishing-to-use` (contrast, focus, reduced motion are use-quality, not
> decoration).
