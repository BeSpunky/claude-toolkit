# Component styling & encapsulation

A component's **styleable surface is a published contract** — as much as its inputs and outputs. Everything in
this file is one idea applied repeatedly: *a component is a black box; you connect to it through the seams it
published, and if the seam you need doesn't exist, the finding is a missing seam — not a licence to drill.*

That idea is framework-neutral, and so is this file. Each stack spells the mechanics differently — how styles
are scoped, what the component's own box is called, how a selector pierces a boundary — so the spellings live in
**adapters** (see the end of this file). Read the core here; read your stack's adapter for its syntax and its
specific footguns.

## Encapsulation — keep the scoping, whatever your stack calls it

Every component stack lands on one of three encapsulation models:

| Model | What it does | Verdict |
| --- | --- | --- |
| **Scoped by rewrite** (emulated) | The toolchain rewrites your selectors with a per-component marker (an attribute, a hashed class), so a component's styles can't leak out | **Keep it.** This is the boundary, and it is the sensible default almost everywhere. |
| **None / global** | The styles are dumped **global**, unscoped, for the whole app | A global leak with a component-shaped name. The rule you wrote for *your* `.title` now hits everyone's. |
| **Real shadow DOM** | Real browser encapsulation | Genuinely strong — but global styles (including your `:root` tokens) do **not** cross into it except via inherited custom properties, which is fine for tokens and painful for everything else. Real trade-off; choose it on purpose or not at all. |

Switching a component to *none/global* is almost always someone trying to style a child component from a parent
and reaching for the biggest hammer. That's the reach-in problem wearing a different hat — see below.

## The component's own box, its state, and its ancestors

Three things a component legitimately styles about *itself*:

- **Its own box** — the component's root/host element. Give it an explicit `display`: a custom element (and the
  host element many frameworks render) is `display: inline` by default, which is the cause of an astonishing
  number of "why is my padding doing nothing" afternoons. Set it.
- **Its state, as data** — a data attribute (or a class) on that root, which the stylesheet selects on
  (`[data-variant='danger']`). See *Variants are data*, below.
- **Something about an ANCESTOR** — a themed section, an RTL document. Reacting to an ancestor is legitimate
  because it reads *up* — the component adapting to its environment — which is the opposite of reaching *down*
  into someone else's internals. Prefer doing it through **inherited custom properties** (the ancestor re-binds
  a token; the component never has to know why); reach for an ancestor-selector (`:host-context()`, a
  `[dir='rtl'] &` descendant rule) sparingly. A component that needs to know a lot about its ancestors isn't
  very reusable.

## Why a style reach-in is banned

A **reach-in** is any selector written to land inside *another* component's internals across its boundary:
Angular's `::ng-deep`, CSS Modules' `:global(…)`, Vue's `:deep()` / `>>>` / `/deep/`, a global stylesheet
targeting a child's internal class names, or switching encapsulation off so a parent's rules fall through.
Different spellings; one move.

Not discouraged. **Banned.**

1. **It is a boundary violation.** A reach-in pierces a child component's encapsulation and styles its
   *internals* — the exact thing `bespunky-engineering:architect-mentality` means by *never reach across a
   boundary into another box's internals*. It is `architecture-first`'s cardinal sin, in CSS.
2. **It breaks silently.** You are selecting on the child's internal DOM structure, which is not a contract.
   The child renames a class in a patch release, your styling evaporates — no error, no failed test, no type
   error. Just a component that looks wrong in one place, discovered by a user.
3. **It escapes upward.** Most piercing syntaxes leak **globally** when they aren't anchored to the component's
   own scope — you meant to style one dialog and you styled every dialog in the app.
4. **The platforms are walking away from it.** The piercing combinators have been deprecated or removed from
   the web platform, and the framework spellings that remain are marked as escape hatches. You are building on
   a plank marked *do not stand here*.

**The finding it hides.** When you want to reach into a component, you have learned something real: *that
component's styling contract is incomplete.* Say that out loud, and then fix **that**:

- It needs a **token** — the consumer should re-bind a custom property on the component's root.
- It needs a **part** — a named seam the consumer may style.
- It needs a **variant** — the difference you want is a legitimate state of the component.
- It needs **projected/slotted content** — you're trying to change its *structure*, not its style.

Every one of those is a five-minute change to the component, and it fixes the problem for everyone, forever. The
reach-in fixes it for you, here, until the next refactor.

## The published styling contract: tokens in, parts out

**Tokens in.** The component reads custom properties; a consumer re-binds them on the component's root. This is
the primary seam, and it costs nothing:

```scss
// in the component (its root/host rule)
.bs-button { padding: var(--bs-button-padding, #{ds.space(2)} #{ds.space(4)}); }

// in the consumer — no piercing, no !important, no coupling to internal DOM
.hero bs-button { --bs-button-padding: #{ds.space(4)} #{ds.space(6)}; }
```

The consumer never learns the component's internals; the component is free to restructure them entirely. Both
sides win, which is the sign of a real seam rather than a compromise. **Tokens are the primary seam** — custom
properties inherit through *every* encapsulation model, including real shadow DOM, need no special syntax, and
cover the large majority of "let me adjust this component" needs. Reach for them first.

**Parts out — but mind the encapsulation.** `::part()` exposes a genuinely nested element as an *opt-in*,
*named* seam whose name is a **promise** while the rest of the DOM stays yours. The catch: **`::part()` only
crosses a real shadow boundary, so it does nothing under scoped-by-rewrite encapsulation** — a consumer's
`bs-button::part(label)` silently matches nothing. It is real only for a component that *deliberately* renders
into shadow DOM (accepting that global styles and `:root` tokens then reach it only through inherited custom
properties). So the honest hierarchy is: **tokens in (always); parts out only when the component lives in shadow
DOM on purpose.** If you're on scoped styles and a token won't reach far enough, the answer is *another token*,
not a part.

**Structure in.** If a consumer wants different *content*, that is content projection / slots (`<slot>`,
`<ng-content>`, `children`, Vue slots), not styling. Reaching for CSS to change structure is the wrong tool at
the wrong boundary.

## Variants are data, not booleans

```ts
// ✗ Three booleans. Eight states. You designed three.
isCompact = false;
isDanger  = false;
isBig     = false;

// ✓ A union. Illegal states are unrepresentable, and the stylesheet selects on it.
type Variant = 'primary' | 'secondary' | 'danger';
type Size    = 'sm' | 'md' | 'lg';
// …rendered onto the component's root as  data-variant="danger"  data-size="md"
```

```scss
.bs-button[data-variant='danger'] { background: ds.color('danger'); color: ds.color('on-danger'); }
```

Two orthogonal *dimensions*, each closed, each named. The boolean bag, by contrast, lets a caller write
`isDanger isBig isCompact` — a combination nobody designed, nobody tested, and CSS will happily render as a
mess. *Make illegal states unrepresentable* (`bespunky-engineering:advanced-typescript`) is a styling rule too.
Whatever the input mechanism — an Angular input, a React/Vue prop, a web-component attribute — the shape is the
same: a closed union in, a data attribute on the root out.

Use a **data attribute** rather than a class for this: it can't be clobbered by a consumer's class list, and it
reads as *state* rather than *decoration*.

## `!important` is always a design failure

It says: *I am losing a specificity fight I did not design.* It never resolves the fight — it escalates it, and
the next person needs two.

The real cause is almost always one of: a global style that shouldn't be global; a component with its
encapsulation switched off somewhere; a reach-in from a parent; or an over-specific selector inside the
component. Find *that* and the `!important` becomes unnecessary. (The single defensible use is overriding a
third-party library that shipped its own `!important` — a foreign weakness you absorb, at one clearly-commented
site.)

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

- **A component root with no explicit `display`** — inline by default; your padding does nothing and you spend
  an hour on it.
- **A reach-in not anchored to the component's own scope** — leaks globally. You styled every dialog in the app.
- **Encapsulation switched off "just for this one"** — it is never one.
- **Styling a child by its internal class names** — coupling to a non-contract; it breaks on their patch release.
- **A `variant` boolean bag** — undesigned combinations, rendered anyway.
- **Global styles that aren't a reset** — if it isn't a reset or the token block, it probably belongs in a
  component.
- **`!important` in a component** — you are fighting a boundary violation that exists somewhere else. Go find it.

## Adapters — your stack's spelling of the above

The core above is the contract; an adapter maps it onto one stack's syntax and footguns. Read the one your
project wears (a house project lists its active layers in its `HOUSE.md` header stamp, `layers=…`).

| Stack | Adapter | In one line |
| --- | --- | --- |
| **Angular** (house layer `angular`) | `reference/adapters/angular-encapsulation.md` | `ViewEncapsulation` (Emulated / None / ShadowDom), the `:host` family, why `::ng-deep` specifically is banned, `<ng-content>`, variants as signal inputs bound to host attributes |
| **Web components** | *(no house adapter — the core is native here)* | Shadow DOM is the default, so `:host`, `:host()`, `::slotted()` and **`::part()` all work as written**; tokens inherit across the shadow root; `<slot>` is structure-in |
| **CSS Modules** (React et al.) | *(no house adapter)* | Scoped by hashed class names; `:global(…)` is the reach-in to refuse; the component's root class is its "host"; variants as a `data-*` attribute on the root element; children/slots for structure |
| **Vue scoped styles** | *(no house adapter)* | Scoped by attribute rewrite; `:deep()` (and the legacy `>>>` / `/deep/`) is the reach-in to refuse; `:slotted()` styles slot content from inside the component |

A stack without a house adapter is not unsupported — apply the core directly; it was written for exactly that.
When the house adds an adapter for another stack, it lands as a sibling file under `reference/adapters/`.

**Mentality anchors:** *Everything is a black box* (style through published seams, never through someone's DOM) ·
*Design for the consumer* (give them a token and a part, and they'll never need to drill) · *Abstractions must
never trap* (the moment a consumer *must* reach in, your abstraction has trapped them — that's your bug, not
theirs).
