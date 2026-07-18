# Token taxonomy & naming

A token is not "a variable for a colour". It is a **named decision**. The name is the product; the value is
an implementation detail that will change. Get the names right and a rebrand is a diff to one file; get them
wrong and you have `--blue-500` on a button that is now green.

## The three tiers

| Tier | What it is | Example | Who may read it |
| --- | --- | --- | --- |
| **Primitive** | The raw palette and scales. Names the **value**. | `--blue-500`, `--space-3`, `--font-size-lg` | The **semantic** tier only |
| **Semantic** | The **role** a value plays. Names the **meaning**. | `--color-surface`, `--color-on-surface`, `--color-danger`, `--color-focus-ring` | **Components** — this is their only tier |
| **Component** | A role *specific to one component*, when it genuinely needs its own knob. | `--button-padding-inline`, `--card-elevation` | That component, and consumers who want to re-bind it |

**The hard rule: a component reads SEMANTIC tokens and nothing else.** The moment a component reads
`--gray-100`, it has bound itself to a *swatch* — and a swatch cannot survive a re-theme. `--surface-raised`
can be grey today and near-black in dark mode and warm ivory after the rebrand, and every component that read
it is *already correct*. That is the entire point of the tier.

The house-scaffolded design system deliberately starts with **semantic names only** in its mode maps, because
a two-tier system you never needed beats a three-tier system you cargo-culted. Introduce a primitive tier the
moment you have a genuine palette — several semantic names drawing from the same underlying ramp — and not
before.

## The naming grammar

```
--<prefix>-<category>-<role>[-<variant>][-<state>]
   ds        color      surface   raised
   ds        space      3
   ds        duration   fast
```

- **Prefix** — namespaces the system, so a token can never collide with a third-party widget's own custom
  properties. One prefix per design system, forever.
- **Category** — the *kind* of thing (`color`, `space`, `radius`, `font`, `border`, `duration`, `easing`,
  `elevation`, `z`). It is what makes typed accessors (`ds.color('surface')`, `ds.space(3)`) possible and
  enforceable.
- **Role** — the meaning. This is the word you will argue about, and the argument is the work.
- **The `on-` convention** — `--color-on-surface` is "the foreground that belongs *on* `--color-surface`".
  Pairing the foreground with its background **in the name** is what makes contrast a property of the system
  rather than a thing you rediscover per component. If you add a background token without its `on-` partner,
  you have shipped half a decision.

## The scales — and the sharpest rule in this file

Space, type, radius, elevation, duration, and easing are **scales**: a small, closed set of steps.

> **A value that is not on a scale is not a missing token. It is a design bug.**

When you want `20px` and the scale goes `16 → 24`, you are looking at exactly one of two findings, and they
have different fixes:

1. **The scale is wrong** — the design genuinely needs that step, and it will need it again. Add it to the
   scale (and then it exists for everyone).
2. **Your design is off-system** — you nudged a value until it looked right in one place. Snap to the scale.

What you must *not* do is split the difference by typing `20px` into a component. That is not a compromise
between the two findings; it is a refusal to make either one, and it is invisible forever after.

The same applies to durations. `180ms` because `200ms` "felt slightly slow" *here* is how an app ends up with
eleven motion languages.

**Which scales are mode-dependent?** Most are not — a space step does not change in the dark. **Elevation
does**, and it is the one people get wrong. A shadow is a *depth cue*, and depth is cued differently on a dark
surface: **you cannot get darker than dark**, so a black shadow that reads beautifully on white is nearly
invisible on near-black. A system that declares elevation *once*, mode-independently, therefore ships flat
cards in dark mode **by construction** — and no amount of tuning the value fixes it, because the value isn't
the problem, the tier is. Put elevation in the mode-dependent tier, where dark mode can pair a deeper shadow
with a **lighter surface** (in the dark, the surface lift — not the shadow — is the primary depth cue). The
general lesson: **if a "scale" behaves differently per mode, it is in the wrong tier.**

## Fluid steps: `clamp()` produces the value; the token owns the name

Fluid type and space are a *technique*, not an escape hatch:

```scss
// in the token layer — the STEP is named; how its value is computed is nobody else's business
'font-size-lg': clamp(1.25rem, 1rem + 1.2vw, 1.75rem),
```

A component asks for `ds.font('size-lg')` and neither knows nor cares that the value is fluid. A component
that inlines its own `clamp()` has just invented an unnamed, unreusable, un-re-themeable step.

## Contrast is a property of the palette

Contrast is not a checklist item you run at the end. It is a **constraint on the token set**, and the `on-`
pairing is what makes it checkable: every `--color-X` / `--color-on-X` pair must pass its contrast target **in
every mode**. Verify the *pair*, not the colour — a colour is not accessible or inaccessible on its own.

Do this **when you define the tokens**, not when a component uses them. A pair that fails is a token bug, and
it will fail identically in all forty components that read it.

## When a token should NOT exist

- **A value used exactly once, that no other screen could ever want.** A hero's one-off bespoke gradient from
  a `stage-the-vision` Staging is *art direction*, not a token. Naming it pretends to a generality it doesn't
  have, and clutters the vocabulary everyone else has to learn.
- **A value that is really a layout decision.** `grid-template-columns: 1fr 320px` is not a token; the `320px`
  might be, but the layout isn't.
- **A component-tier token nobody will ever re-bind.** If no consumer will change it, it's just a value; put
  it in the component and move on. (You'll know when you're wrong: someone will ask to change it.)

Tokens are a **vocabulary**. A vocabulary with a word for everything is not a vocabulary, it's a dictionary —
and nobody learns a dictionary.

## Pitfalls

- **Naming a token after its value** (`--color-blue`, `--space-16`) — the name is now a lie the day it changes.
  (`--space-3` as a *scale index* is fine; `--space-16px` is not.)
- **Skipping the semantic tier "for now"** — components bind to primitives, and "for now" is how long the
  design system lasts.
- **A token that exists in one mode and not another** — a broken theme. Make it a **build failure** (the house
  theme mixin `@error`s on mode-key divergence); a runtime surprise here is invisible text at 11pm.
- **Aliasing a token to another token in a component** (`--my-thing: var(--color-primary)`) — that's a
  component-tier token; declare it as one, in the system, or just read the semantic token.
- **Growing the scale by one step every sprint** — a scale of nineteen space values is not a scale, it's a
  ruler. Push back on the design, or accept that the constraint is gone.

**Mentality anchors:** *Model the missing concept* (a value with no name is a concept you refused to model) ·
*Place everything on purpose* (each value at its tier, once) · *Names carry intent* (the name is the product;
the value is a detail).
