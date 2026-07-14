# Component styling & encapsulation

A component's **styleable surface is a published contract** — as much as its inputs and outputs. Everything in
this file is one idea applied repeatedly: *a component is a black box; you connect to it through the seams it
published, and if the seam you need doesn't exist, the finding is a missing seam — not a licence to drill.*

## `ViewEncapsulation` — keep the default

| Mode | What it does | Verdict |
| --- | --- | --- |
| **`Emulated`** (default) | Angular rewrites your selectors with a per-component attribute, so a component's styles can't leak out | **Keep it.** This is the boundary. |
| **`None`** | The styles are dumped **global**, unscoped, for the whole app | A global leak with a component-shaped name. The rule you wrote for *your* `.title` now hits everyone's. |
| **`ShadowDom`** | Real browser encapsulation | Genuinely strong — but global styles (including your `:root` tokens) do **not** cross into it except via inherited custom properties, which is fine for tokens and painful for everything else. Real trade-off; choose it on purpose or not at all. |

`ViewEncapsulation.None` is almost always someone trying to style a child component from a parent and reaching
for the biggest hammer. That's the `::ng-deep` problem wearing a different hat — see below.

## The `:host` family

```scss
:host                              { display: block; }        // the component's own element
:host([data-variant='danger'])     { … }                       // its state, as data
:host(.is-open)                    { … }                       // its state, as a class
:host-context([data-ds-mode='dark']) { … }                     // something about an ANCESTOR
```

`:host` is where a component's own box lives — and note the first line: an Angular component's host element is
`display: inline` by default, which is the cause of an astonishing number of "why is my padding doing nothing"
afternoons. Set it.

`:host-context()` is the narrow, legitimate way to react to an **ancestor's** state (a themed section, an RTL
document). It is legitimate because it reads *up* — the component adapting to its environment — which is the
opposite of reaching *down* into someone else's internals. Use it sparingly; a component that needs to know a
lot about its ancestors isn't very reusable.

## Why `::ng-deep` is banned

Not discouraged. **Banned.**

1. **It is a boundary violation.** `::ng-deep` pierces a child component's encapsulation and styles its
   *internals* — the exact thing `bespunky-engineering:architect-mentality` means by *never reach across a
   boundary into another box's internals*. It is `architecture-first`'s cardinal sin, in CSS.
2. **It breaks silently.** You are selecting on the child's internal DOM structure, which is not a contract.
   The child renames a class in a patch release, your styling evaporates — no error, no failed test, no type
   error. Just a component that looks wrong in one place, discovered by a user.
3. **It is deprecated**, and has been for years. You are building on a plank marked *do not stand here*.
4. **It escapes upward.** `::ng-deep` without a `:host` prefix leaks **globally** — you meant to style one
   dialog and you styled every dialog in the app.

**The finding it hides.** When you want to `::ng-deep` into a component, you have learned something real: *that
component's styling contract is incomplete.* Say that out loud, and then fix **that**:

- It needs a **token** — the consumer should re-bind a custom property on the host.
- It needs a **part** — a named seam the consumer may style.
- It needs a **variant** — the difference you want is a legitimate state of the component.
- It needs **content projection** — you're trying to change its *structure*, not its style.

Every one of those is a five-minute change to the component, and it fixes the problem for everyone, forever. The
`::ng-deep` fixes it for you, here, until the next refactor.

## The published styling contract: tokens in, parts out

**Tokens in.** The component reads custom properties; a consumer re-binds them on the host. This is the primary
seam, and it costs nothing:

```scss
// in the component
:host { padding: var(--bs-button-padding, #{ds.space(2)} #{ds.space(4)}); }

// in the consumer — no piercing, no !important, no coupling to internal DOM
bs-button.hero { --bs-button-padding: #{ds.space(4)} #{ds.space(6)}; }
```

The consumer never learns the component's internals; the component is free to restructure them entirely. Both
sides win, which is the sign of a real seam rather than a compromise. **Tokens are the primary seam** — they
work under the default `Emulated` encapsulation, need no shadow DOM, and cover the large majority of "let me
adjust this component" needs. Reach for them first.

**Parts out — but mind the encapsulation.** `::part()` exposes a genuinely nested element as an *opt-in*,
*named* seam whose name is a **promise** while the rest of the DOM stays yours. The catch: **`::part()` only
crosses a shadow boundary, so it does nothing under `Emulated`** — a consumer's `bs-button::part(label)`
silently matches nothing. It is real only for a component you have *deliberately* set to
`ViewEncapsulation.ShadowDom` (accepting that global styles and `:root` tokens then reach it only through
inherited custom properties). So the honest hierarchy is: **tokens in (always); parts out only when you've
opted the component into ShadowDom on purpose.** If you're on Emulated and a token won't reach far enough,
the answer is *another token*, not a part.

**Structure in.** If a consumer wants different *content*, that is content projection (`<ng-content>`), not
styling. Reaching for CSS to change structure is the wrong tool at the wrong boundary.

## Variants are data, not booleans

```ts
// ✗ Three booleans. Eight states. You designed three.
@Input() isCompact = false;
@Input() isDanger  = false;
@Input() isBig     = false;

// ✓ A union. Illegal states are unrepresentable, and the SCSS selects on it.
variant = input<'primary' | 'secondary' | 'danger'>('primary');
size    = input<'sm' | 'md' | 'lg'>('md');

host: { '[attr.data-variant]': 'variant()', '[attr.data-size]': 'size()' }
```

```scss
:host([data-variant='danger']) { background: ds.color('danger'); color: ds.color('on-danger'); }
```

Two orthogonal *dimensions*, each closed, each named. The boolean bag, by contrast, lets a caller write
`isDanger isBig isCompact` — a combination nobody designed, nobody tested, and CSS will happily render as a
mess. *Make illegal states unrepresentable* (`bespunky-engineering:advanced-typescript`) is a styling rule too.

Use a **data attribute** rather than a class for this: it can't be clobbered by a consumer's class list, and it
reads as *state* rather than *decoration*.

## `!important` is always a design failure

It says: *I am losing a specificity fight I did not design.* It never resolves the fight — it escalates it, and
the next person needs two.

The real cause is almost always one of: a global style that shouldn't be global; a `ViewEncapsulation.None`
somewhere; a `::ng-deep` from a parent; or an over-specific selector inside the component. Find *that* and the
`!important` becomes unnecessary. (The single defensible use is overriding a third-party library that shipped its
own `!important` — a foreign weakness you absorb, at one clearly-commented site.)

## `@layer` — cascade order you can actually reason about

```css
@layer reset, base, components, utilities;
```

Layers let you declare precedence **explicitly**, so a later, more specific selector can't accidentally beat a
rule you intended to win. That means the reset can't beat the components, and utilities can win *without*
`!important` and without a specificity arms race.

Reach for it when a global stylesheet has grown enough that "why is this rule losing" has become a recurring
question. Don't retrofit it into a small app that isn't asking.

## Pitfalls

- **A component with no `:host { display: … }`** — inline by default; your padding does nothing and you spend
  an hour on it.
- **`::ng-deep` without `:host`** — leaks globally. You styled every dialog in the app.
- **`ViewEncapsulation.None` "just for this one"** — it is never one.
- **Styling a child by its internal class names** — coupling to a non-contract; it breaks on their patch release.
- **A `variant` boolean bag** — undesigned combinations, rendered anyway.
- **Global styles that aren't a reset** — if it isn't a reset or the token block, it probably belongs in a
  component.
- **`!important` in a component** — you are fighting a boundary violation that exists somewhere else. Go find it.

**Mentality anchors:** *Everything is a black box* (style through published seams, never through someone's DOM) ·
*Design for the consumer* (give them a token and a part, and they'll never need to drill) · *Abstractions must
never trap* (the moment a consumer *must* `::ng-deep`, your abstraction has trapped them — that's your bug, not
theirs).
