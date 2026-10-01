# Angular adapter — component styling & encapsulation

The framework-neutral contract is in `reference/component-styling-and-encapsulation.md` — read that first. This
file is its **Angular spelling**: the same rules (keep the scoping, tokens in / parts out, no reach-ins, variants
as data), mapped onto `ViewEncapsulation`, `:host`, `::ng-deep` and signal inputs. It applies when the project
wears Angular (a house project's `HOUSE.md` stamp lists `angular` in `layers=`).

## `ViewEncapsulation` — keep the default

| Mode | What it does | Verdict |
| --- | --- | --- |
| **`Emulated`** (default) | Angular rewrites your selectors with a per-component attribute, so a component's styles can't leak out | **Keep it.** This is the boundary. (The core's *scoped by rewrite*.) |
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

`::ng-deep` is Angular's reach-in, and everything the core says about reach-ins applies. Two Angular-specific
aggravations:

1. **It is deprecated**, and has been for years. You are building on a plank marked *do not stand here*.
2. **It escapes upward.** `::ng-deep` without a `:host` prefix leaks **globally** — you meant to style one
   dialog and you styled every dialog in the app.

The finding it hides is the core's: the child's styling contract is incomplete — it needs a **token**, a
**part**, a **variant**, or **content projection**. Fix *that*.

## Tokens in, parts out — on Angular

**Tokens in** is the same everywhere; on Angular the component's root rule is `:host`:

```scss
// in the component
:host { padding: var(--bs-button-padding, #{ds.space(2)} #{ds.space(4)}); }

// in the consumer — no piercing, no !important, no coupling to internal DOM
bs-button.hero { --bs-button-padding: #{ds.space(4)} #{ds.space(6)}; }
```

Tokens work under the default `Emulated` encapsulation, need no shadow DOM, and cover the large majority of "let
me adjust this component" needs.

**Parts out.** `::part()` only crosses a shadow boundary, so it **does nothing under `Emulated`** — a consumer's
`bs-button::part(label)` silently matches nothing. It is real only for a component you have *deliberately* set
to `ViewEncapsulation.ShadowDom`. On Emulated, if a token won't reach far enough, the answer is *another token*,
not a part.

**Structure in.** A consumer who wants different *content* gets content projection (`<ng-content>`, with
`select` for named slots) — not styling.

## Variants as signal inputs bound to host attributes

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

For the rest of a component's input/output API, see `bespunky-angular:angular-architecture` → component API
ergonomics.

## `!important` on Angular

The usual Angular causes of a specificity fight: a `ViewEncapsulation.None` somewhere, or a `::ng-deep` from a
parent. Find it, and the `!important` becomes unnecessary.

## Pitfalls

- **A component with no `:host { display: … }`** — inline by default; your padding does nothing and you spend
  an hour on it.
- **`::ng-deep` without `:host`** — leaks globally. You styled every dialog in the app.
- **`ViewEncapsulation.None` "just for this one"** — it is never one.
- **`::part()` on an Emulated component** — matches nothing, silently.
- **A `@Input()` boolean bag** — undesigned combinations, rendered anyway.

> **Related.** `reference/component-styling-and-encapsulation.md` (the neutral contract this adapts) ·
> `reference/adapters/angular-ds-library.md` (the Angular/ng-packagr shape of the DS library) ·
> `bespunky-angular:angular-architecture` (component API ergonomics).
